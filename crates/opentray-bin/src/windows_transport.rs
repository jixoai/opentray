use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread::{self, JoinHandle};

use crate::frame_error::extract_request_id;
use std::time::Duration;

use opentray_core::BrokerSession;
use opentray_spec::{ClientFrame, RuntimeHostHealth, RuntimeHostSessionHealth, ServerFrame};
use windows_sys::Win32::Foundation::{
    GetLastError, ERROR_BROKEN_PIPE, ERROR_NO_DATA, ERROR_PIPE_CONNECTED, ERROR_PIPE_NOT_CONNECTED,
    INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PeekNamedPipe, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES,
};

use crate::BrokerOptions;

pub type Writer = Arc<OutboundWriter>;
type EventSender = Arc<dyn Fn(TransportEvent) + Send + Sync>;
const PIPE_POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Per-session pump-queue bound, in frames — same policy and magnitude as
/// the Unix outbound queue: frames on this pipe are protocol-shaped JSON
/// (responses, events, envelopes), so 1024 frames bounds worst-case
/// outbound memory to the low single-digit MiB range while converting a
/// client that stops draining into a bounded-time disconnect instead of
/// unbounded queue growth against a dead pipe.
const OUTBOUND_QUEUE_CAPACITY: usize = 1024;

/// Owner-loop write handle: a bounded FIFO drained by the dedicated pipe
/// pump. The owner loop must never park on a full queue (the transport-
/// robustness "never block the native owner loop" law): enqueue is
/// `try_send`, and a full queue means the client stopped draining — a dead
/// session escalated through the disconnect path, never a parked producer
/// and never silent frame loss.
pub struct OutboundWriter {
    id: u64,
    queue: SyncSender<ServerFrame>,
    events: EventSender,
    escalated: AtomicBool,
    /// Frames enqueued but not yet written+flushed by the pipe pump. Lets
    /// the broker's exit path give final frames (the Exit ack) a bounded
    /// delivery window before the process tears the pipe down.
    pending: AtomicUsize,
}

impl OutboundWriter {
    fn new(id: u64, events: EventSender) -> (Writer, Receiver<ServerFrame>) {
        let (queue, outbound) = mpsc::sync_channel(OUTBOUND_QUEUE_CAPACITY);
        (
            Arc::new(Self {
                id,
                queue,
                events,
                escalated: AtomicBool::new(false),
                pending: AtomicUsize::new(0),
            }),
            outbound,
        )
    }

    /// Enqueue one outbound frame. Never blocks and never silently drops:
    /// both non-draining reasons (queue full, pump gone) escalate the
    /// session through the disconnect path.
    pub fn enqueue(&self, frame: ServerFrame) {
        self.pending.fetch_add(1, Ordering::AcqRel);
        match self.queue.try_send(frame) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                self.pending.fetch_sub(1, Ordering::AcqRel);
                self.escalate("outbound queue full: client stopped draining");
            }
            Err(TrySendError::Disconnected(_)) => {
                self.pending.fetch_sub(1, Ordering::AcqRel);
                self.escalate("outbound pipe pump exited: client pipe unusable");
            }
        }
    }

    /// Waits until the pipe pump has written+flushed every enqueued frame,
    /// within `budget`. Used only on the broker-exit path so the Exit ack
    /// keeps its pre-queue delivery guarantee.
    pub fn drain_outbound(&self, budget: Duration) -> bool {
        let deadline = std::time::Instant::now() + budget;
        while self.pending.load(Ordering::Acquire) > 0 {
            if std::time::Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(1));
        }
        true
    }

    /// Escalate to the session-disconnect path — the same
    /// `TransportEvent::Disconnected` the pump emits on pipe errors — so
    /// session cleanup runs through its existing chain and the failure is
    /// observable in broker diagnostics. The flag keeps the first
    /// escalation authoritative; the pump's own error-path escalation may
    /// race it and the duplicate is absorbed by idempotent session removal.
    fn escalate(&self, reason: &str) {
        if self.escalated.swap(true, Ordering::SeqCst) {
            return;
        }
        eprintln!("opentray client session {} outbound escalation: {reason}", self.id);
        (self.events)(TransportEvent::Disconnected { id: self.id });
    }
}

impl std::fmt::Debug for OutboundWriter {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OutboundWriter")
            .field("id", &self.id)
            .field("escalated", &self.escalated.load(Ordering::SeqCst))
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub enum TransportEvent {
    Connected { id: u64, writer: Writer },
    Frame { id: u64, frame: ClientFrame },
    Disconnected { id: u64 },
}

pub struct TransportSession {
    pub writer: Writer,
    pub broker: BrokerSession,
}

impl TransportSession {
    pub fn write_frames(&mut self, frames: Vec<ServerFrame>) {
        for frame in frames {
            self.write_frame(frame);
        }
    }

    /// Owner-loop write point: enqueue only, never blocking pipe IO. The
    /// pump queue is one FIFO per session, so command response frames
    /// enqueued ahead of that dispatch's mirrored event frames stay ahead
    /// on the wire — the EventPort ordering law ("response frames before
    /// mirror-event frames") is preserved by queue order, never by pump
    /// timing.
    pub fn write_frame(&mut self, frame: ServerFrame) {
        self.writer.enqueue(frame);
    }

    /// Bounded final-flush for the broker-exit path (see
    /// [`OutboundWriter::drain_outbound`]).
    pub fn flush_outbound(&mut self, budget: Duration) -> bool {
        self.writer.drain_outbound(budget)
    }
}

/// Bounded wait for the accept thread's exit handshake — the Windows
/// sibling of the Unix H3 hardening. `ConnectNamedPipe` blocks until a
/// client reaches THIS pipe instance, and the shutdown wake-open is
/// satisfied by ANY same-name instance (`PIPE_UNLIMITED_INSTANCES` lets
/// other processes create instances too), so the join must have a budget:
/// on timeout the handle is dropped, detaching the thread, and broker exit
/// is never parked.
const LISTENER_JOIN_BUDGET: Duration = Duration::from_millis(500);

pub struct ListenerHandle {
    shutdown: Arc<AtomicBool>,
    endpoint: String,
    accept_exited: Arc<(Mutex<bool>, Condvar)>,
    thread: Option<JoinHandle<()>>,
}

impl ListenerHandle {
    pub fn shutdown(mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // Wake a blocking ConnectNamedPipe with one client open of the pipe
        // name.
        let _ = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&self.endpoint);
        let accept_exited = {
            let (lock, cvar) = &*self.accept_exited;
            // Lock poisoning means the accept thread panicked before its
            // exit handshake; the bounded wait below still applies.
            let mut exited = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if !*exited {
                let (guard, _) = cvar
                    .wait_timeout_while(exited, LISTENER_JOIN_BUDGET, |exited| !*exited)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                exited = guard;
            }
            *exited
        };
        if let Some(thread) = self.thread.take() {
            if accept_exited {
                let _ = thread.join();
            } else {
                eprintln!(
                    "opentray listener accept thread missed the shutdown budget; detaching it so \
                     broker exit is not parked"
                );
            }
        }
    }
}

pub fn spawn_listener(
    options: BrokerOptions,
    send: impl Fn(TransportEvent) + Send + Sync + 'static,
) -> Result<ListenerHandle, Box<dyn std::error::Error>> {
    let endpoint = options.endpoint.to_string_lossy().to_string();
    let first_pipe = create_pipe(&endpoint)?;
    write_ready_file(&options)?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_thread = shutdown.clone();
    let send: EventSender = Arc::new(send);
    let next_id = Arc::new(AtomicU64::new(1));
    let endpoint_thread = endpoint.clone();
    let accept_exited = Arc::new((Mutex::new(false), Condvar::new()));
    let accept_exited_thread = accept_exited.clone();
    let thread = thread::spawn(move || {
        let mut pending_pipe = Some(first_pipe);
        while !shutdown_thread.load(Ordering::SeqCst) {
            let pipe = match pending_pipe.take() {
                Some(pipe) => pipe,
                None => match create_pipe(&endpoint_thread) {
                    Ok(pipe) => pipe,
                    Err(error) => {
                        if !shutdown_thread.load(Ordering::SeqCst) {
                            eprintln!("failed to create opentray named pipe: {error}");
                        }
                        break;
                    }
                },
            };

            if let Err(error) = connect_pipe(&pipe) {
                if !shutdown_thread.load(Ordering::SeqCst) {
                    eprintln!("opentray named pipe connect error: {error}");
                }
                continue;
            }
            if shutdown_thread.load(Ordering::SeqCst) {
                break;
            }

            let id = next_id.fetch_add(1, Ordering::SeqCst);
            let (writer, outbound) = OutboundWriter::new(id, send.clone());
            send(TransportEvent::Connected {
                id,
                writer: writer.clone(),
            });
            spawn_pipe_pump(id, pipe, outbound, writer, send.clone());
        }
        // Exit handshake for the bounded shutdown join.
        if let Ok(mut exited) = accept_exited_thread.0.lock() {
            *exited = true;
        }
        accept_exited_thread.1.notify_all();
    });

    Ok(ListenerHandle {
        shutdown,
        endpoint,
        accept_exited,
        thread: Some(thread),
    })
}

pub fn build_runtime_host_health(
    options: &BrokerOptions,
    sessions: &HashMap<u64, TransportSession>,
) -> RuntimeHostHealth {
    let app = sessions
        .values()
        .find_map(|session| session.broker.app_identity().cloned())
        .unwrap_or_else(|| opentray_spec::AppIdentity {
            app_id: options.app_id().to_string(),
            app_name: options.app_name().to_string(),
            app_icon: None,
            app_icon_variant: None,
        });
    let mut sessions = sessions
        .iter()
        .map(|(session_id, session)| RuntimeHostSessionHealth {
            session_id: *session_id,
            internal_session_id: session.broker.session_id().map(ToOwned::to_owned),
            initialized: session.broker.session_id().is_some(),
        })
        .collect::<Vec<_>>();
    sessions.sort_by_key(|session| session.session_id);

    RuntimeHostHealth {
        pid: std::process::id(),
        package_version: options.package_version.clone(),
        protocol_version: options.protocol_version,
        endpoint: options.endpoint.to_string_lossy().to_string(),
        app,
        caller_label: options.caller_label().to_string(),
        session_count: sessions.len(),
        sessions,
    }
}

fn spawn_pipe_pump(
    id: u64,
    mut stream: File,
    outbound: Receiver<ServerFrame>,
    writer: Writer,
    send: EventSender,
) {
    thread::spawn(move || {
        // Keep synchronous named-pipe reads and writes on one thread; cloned handles can block
        // each other on Windows while a read is pending.
        let mut inbound = Vec::<u8>::new();
        loop {
            if !drain_outbound(&mut stream, &outbound, &writer) {
                break;
            }

            match available_pipe_bytes(&stream) {
                Ok(0) => match outbound.recv_timeout(PIPE_POLL_INTERVAL) {
                    Ok(frame) => {
                        // The producer's enqueue already counted this frame;
                        // write it here (same thread discipline as
                        // drain_outbound) and settle the count in the helper.
                        if !write_pump_frame(&mut stream, &writer, &frame) {
                            break;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                },
                Ok(available) => {
                    if let Err(error) =
                        read_available_frames(id, &mut stream, available, &mut inbound, &send)
                    {
                        if !is_broken_pipe_error(&error) {
                            eprintln!("opentray client read error: {error}");
                        }
                        break;
                    }
                }
                Err(error) => {
                    if !is_broken_pipe_error(&error) {
                        eprintln!("opentray client peek error: {error}");
                    }
                    break;
                }
            }
        }
        send(TransportEvent::Disconnected { id });
    });
}

/// Writes one queued frame to the pipe and settles its pending count.
/// Returns false on a write failure; the caller breaks and the pump's exit
/// path escalates the session disconnect.
fn write_pump_frame(stream: &mut File, writer: &Writer, frame: &ServerFrame) -> bool {
    let result = write_frame_to_pipe(stream, frame);
    // Settle the count on both outcomes: a failed frame will never be
    // written, so the exit-path drain must not wait on it.
    writer.pending.fetch_sub(1, Ordering::AcqRel);
    match result {
        Ok(()) => true,
        Err(error) => {
            eprintln!("opentray client write error: {error}");
            false
        }
    }
}

fn drain_outbound(
    stream: &mut File,
    outbound: &Receiver<ServerFrame>,
    writer: &Writer,
) -> bool {
    loop {
        match outbound.try_recv() {
            Ok(frame) => {
                if !write_pump_frame(stream, writer, &frame) {
                    return false;
                }
            }
            Err(TryRecvError::Empty) => return true,
            Err(TryRecvError::Disconnected) => return false,
        }
    }
}

fn read_available_frames(
    id: u64,
    stream: &mut File,
    available: u32,
    inbound: &mut Vec<u8>,
    send: &EventSender,
) -> std::io::Result<()> {
    let mut chunk = vec![0; available.min(65_536) as usize];
    let read = stream.read(&mut chunk)?;
    if read == 0 {
        return Err(std::io::Error::new(
            ErrorKind::BrokenPipe,
            "opentray client pipe closed",
        ));
    }

    inbound.extend_from_slice(&chunk[..read]);
    while let Some(newline) = inbound.iter().position(|byte| *byte == b'\n') {
        let mut line = inbound.drain(..=newline).collect::<Vec<_>>();
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let line = match std::str::from_utf8(&line) {
            Ok(line) => line,
            Err(error) => {
                write_frame_to_pipe(
                    stream,
                    &ServerFrame::Error {
                        request_id: None,
                        code: "invalid-frame".to_string(),
                        message: error.to_string(),
                        details: None,
                    },
                )?;
                continue;
            }
        };
        match serde_json::from_str::<ClientFrame>(line) {
            Ok(frame) => {
                send(TransportEvent::Frame { id, frame });
            }
            Err(error) => {
                let request_id = extract_request_id(line);
                write_frame_to_pipe(
                    stream,
                    &ServerFrame::Error {
                        request_id,
                        code: "invalid-frame".to_string(),
                        message: error.to_string(),
                        details: None,
                    },
                )?;
            }
        }
    }

    Ok(())
}

fn write_frame_to_pipe(stream: &mut File, frame: &ServerFrame) -> std::io::Result<()> {
    serde_json::to_writer(&mut *stream, frame)?;
    stream.write_all(b"\n")?;
    stream.flush()
}

fn available_pipe_bytes(pipe: &File) -> std::io::Result<u32> {
    let mut available = 0;
    let ok = unsafe {
        PeekNamedPipe(
            pipe.as_raw_handle() as _,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut available,
            std::ptr::null_mut(),
        )
    };
    if ok != 0 {
        return Ok(available);
    }

    let error = unsafe { GetLastError() };
    Err(std::io::Error::from_raw_os_error(error as i32))
}

fn is_broken_pipe_error(error: &std::io::Error) -> bool {
    matches!(
        error.raw_os_error().map(|error| error as u32),
        Some(ERROR_BROKEN_PIPE | ERROR_NO_DATA | ERROR_PIPE_NOT_CONNECTED)
    ) || error.kind() == ErrorKind::BrokenPipe
}

fn create_pipe(endpoint: &str) -> std::io::Result<File> {
    let name = wide_null(endpoint);
    let handle = unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE,
            PIPE_UNLIMITED_INSTANCES,
            65536,
            65536,
            0,
            std::ptr::null(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_handle(handle as _) })
}

fn connect_pipe(pipe: &File) -> std::io::Result<()> {
    let connected = unsafe { ConnectNamedPipe(pipe.as_raw_handle() as _, std::ptr::null_mut()) };
    if connected != 0 {
        return Ok(());
    }
    let error = unsafe { GetLastError() };
    if error == ERROR_PIPE_CONNECTED {
        return Ok(());
    }
    Err(std::io::Error::from_raw_os_error(error as i32))
}

fn write_ready_file(options: &BrokerOptions) -> std::io::Result<()> {
    if let Some(parent) = options.ready_file.parent() {
        create_dir_all(parent)?;
    }

    let ready = options.ready_metadata();
    let mut file = File::create(&options.ready_file)?;
    serde_json::to_writer_pretty(&mut file, &ready)?;
    file.write_all(b"\n")?;
    Ok(())
}

fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::time::Instant;

    /// Transport-robustness W7 (B4), Windows leg: the bounded pump queue
    /// escalates without parking the producer, keeps response frames ahead
    /// of event frames, and the bounded final drain gives up on a wedged
    /// queue. The full disconnect cleanup chain is the owner loop's existing
    /// handler for the same `TransportEvent::Disconnected` these tests
    /// observe.

    fn collector() -> Arc<Mutex<Vec<TransportEvent>>> {
        Arc::new(Mutex::new(Vec::new()))
    }

    fn collector_events(sink: &Arc<Mutex<Vec<TransportEvent>>>) -> EventSender {
        let sink = sink.clone();
        Arc::new(move |event| sink.lock().expect("collector lock").push(event))
    }

    fn error_frame(sequence: usize, payload: &str) -> ServerFrame {
        ServerFrame::Error {
            request_id: None,
            code: format!("seq-{sequence}"),
            message: payload.to_string(),
            details: None,
        }
    }

    fn has_disconnected(sink: &Arc<Mutex<Vec<TransportEvent>>>, id: u64) -> bool {
        sink.lock()
            .expect("collector lock")
            .iter()
            .any(|event| matches!(event, TransportEvent::Disconnected { id: seen } if *seen == id))
    }

    fn pipe_endpoint(name: &str) -> String {
        format!(
            r"\\.\pipe\opentray-transport-test-{}-{name}",
            std::process::id()
        )
    }

    fn ready_file_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "opentray-transport-test-{}-{name}.ready.json",
            std::process::id()
        ))
    }

    fn test_broker_options(endpoint: &str, ready_file: &Path) -> BrokerOptions {
        let (executable_path, artifact_identity) = crate::resolve_current_broker_artifact(
            "0.0.0-transport-test",
        )
        .expect("current broker artifact");
        let identity = serde_json::to_string(&artifact_identity).expect("artifact identity json");
        let args = [
            "--endpoint",
            endpoint,
            "--ready-file",
            &ready_file.to_string_lossy(),
            "--package-version",
            "0.0.0-transport-test",
            "--protocol-version",
            "2",
            "--broker-executable-path",
            &executable_path.to_string_lossy(),
            "--broker-artifact-identity",
            &identity,
        ]
        .map(ToOwned::to_owned);
        crate::parse_broker_options(args.into_iter()).expect("broker options")
    }

    #[test]
    fn full_outbound_queue_escalates_without_parking_the_producer() {
        let sink = collector();
        // No pump drains: the queue-side model of a client that stopped
        // reading (its pump is parked inside a full pipe buffer, so nothing
        // dequeues).
        let (writer, _never_drained) = OutboundWriter::new(42, collector_events(&sink));
        let started = Instant::now();
        for sequence in 0..OUTBOUND_QUEUE_CAPACITY {
            writer.enqueue(error_frame(sequence, "fill"));
        }
        assert!(
            sink.lock().expect("collector lock").is_empty(),
            "enqueues below the bound must not escalate"
        );
        writer.enqueue(error_frame(OUTBOUND_QUEUE_CAPACITY, "overflow"));
        assert!(
            has_disconnected(&sink, 42),
            "the capacity-overflow enqueue escalates synchronously"
        );
        writer.enqueue(error_frame(OUTBOUND_QUEUE_CAPACITY + 1, "post-escalation"));
        assert_eq!(
            sink.lock()
                .expect("collector lock")
                .iter()
                .filter(|event| matches!(event, TransportEvent::Disconnected { .. }))
                .count(),
            1,
            "escalation is deduped by the one-shot flag"
        );
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "the producer never parks on a full queue"
        );
    }

    #[test]
    fn outbound_queue_is_fifo_response_before_event() {
        let sink = collector();
        let (writer, outbound) = OutboundWriter::new(43, collector_events(&sink));
        // A command response frame enqueued before the same dispatch's
        // mirrored event frame must be written first (EventPort
        // close-ordering law). The pump write path is exercised through the
        // shared `drain_outbound` helper into a regular file, which the
        // byte-oriented writer accepts identically to a pipe handle.
        writer.enqueue(ServerFrame::Ack {
            request_id: "req-1".to_string(),
        });
        writer.enqueue(error_frame(1, "mirrored"));
        let path = std::env::temp_dir().join(format!(
            "opentray-transport-test-fifo-{}.jsonl",
            std::process::id()
        ));
        let mut sink_file = File::create(&path).expect("create fifo sink file");
        assert!(
            drain_outbound(&mut sink_file, &outbound, &writer),
            "the bounded drain writes both frames"
        );
        drop(sink_file);
        let written = std::fs::read_to_string(&path).expect("read fifo sink file");
        let _ = std::fs::remove_file(&path);
        let mut lines = written.lines();
        let response: serde_json::Value =
            serde_json::from_str(lines.next().expect("response frame line").trim())
                .expect("response frame json");
        let event: serde_json::Value =
            serde_json::from_str(lines.next().expect("event frame line").trim())
                .expect("event frame json");
        assert_eq!(response["type"].as_str(), Some("ack"));
        assert_eq!(event["type"].as_str(), Some("error"));
        assert!(
            writer.drain_outbound(Duration::from_millis(50)),
            "the settled queue drains immediately afterwards"
        );
    }

    #[test]
    fn drain_outbound_stays_bounded_when_wedged() {
        // No pump ever drains: the bounded final drain gives up after its
        // budget instead of parking the exit path.
        let wedged_sink = collector();
        let (wedged, _never_drained) = OutboundWriter::new(51, collector_events(&wedged_sink));
        wedged.enqueue(error_frame(0, "wedge"));
        let started = Instant::now();
        assert!(
            !wedged.drain_outbound(Duration::from_millis(50)),
            "a wedged queue must not report a settled drain"
        );
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "the wedged drain is abandoned after its budget"
        );
    }

    #[test]
    fn listener_shutdown_returns_within_budget_without_clients() {
        // No client ever connects; the wake-open satisfies ConnectNamedPipe
        // and the bounded join must return well inside the budget, so broker
        // exit can never park on the accept thread.
        let endpoint = pipe_endpoint("shutdown-budget");
        let ready_file = ready_file_path("shutdown-budget");
        let listener = {
            let sink = collector();
            spawn_listener(
                test_broker_options(&endpoint, &ready_file),
                move |event| {
                    sink.lock().expect("collector lock").push(event);
                },
            )
            .expect("spawn listener")
        };
        let started = Instant::now();
        listener.shutdown();
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(2),
            "shutdown must stay bounded without clients (took {elapsed:?})"
        );
        let _ = std::fs::remove_file(&ready_file);
    }

    #[test]
    fn listener_escalates_a_client_that_stops_draining_within_bounded_time() {
        let endpoint = pipe_endpoint("stopped-drain");
        let ready_file = ready_file_path("stopped-drain");
        let sink = collector();
        let listener = {
            let sink = sink.clone();
            spawn_listener(test_broker_options(&endpoint, &ready_file), move |event| {
                sink.lock().expect("collector lock").push(event);
            })
            .expect("spawn listener")
        };
        // A connected client that never reads: the pipe buffer fills, the
        // pump parks inside its write, and the bounded queue is the only
        // remaining sink for outbound frames.
        let _client = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&endpoint)
            .expect("client open pipe");
        let connected = {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                {
                    let events = sink.lock().expect("collector lock");
                    let connected = events.iter().find_map(|event| match event {
                        TransportEvent::Connected { id, writer } => {
                            Some((*id, writer.clone()))
                        }
                        _ => None,
                    });
                    if let Some(pair) = connected {
                        break pair;
                    }
                }
                if Instant::now() >= deadline {
                    panic!("no Connected event within budget");
                }
                thread::sleep(Duration::from_millis(5));
            }
        };
        let (session, writer) = connected;
        let started = Instant::now();
        let payload = "x".repeat(8192);
        let mut escalated = false;
        // 8 KiB frames: the pipe buffers plus the 1024-frame queue saturate
        // far below this loop bound even with generous buffers.
        for sequence in 0..(OUTBOUND_QUEUE_CAPACITY * 3) {
            writer.enqueue(error_frame(sequence, &payload));
            if has_disconnected(&sink, session) {
                escalated = true;
                break;
            }
        }
        assert!(
            escalated,
            "a stopped-drain client must escalate Disconnected once the queue bound is hit"
        );
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "escalation must stay bounded, took {:?}",
            started.elapsed()
        );
        listener.shutdown();
        let _ = std::fs::remove_file(&ready_file);
    }
}
