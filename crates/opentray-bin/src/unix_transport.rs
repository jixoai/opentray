use std::collections::HashMap;
use std::fs::{create_dir_all, remove_file, File};
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::mpsc::{self, SyncSender, TrySendError};
#[cfg(not(target_os = "macos"))]
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::frame_error::extract_request_id;
#[cfg(not(target_os = "macos"))]
use std::time::Instant;

use opentray_core::BrokerSession;
#[cfg(not(target_os = "macos"))]
use opentray_core::operations::DeferredOperationRegistry;
#[cfg(not(target_os = "macos"))]
use opentray_core::{AppBackend, BrokerKernel};
use opentray_spec::{ClientFrame, RuntimeHostHealth, RuntimeHostSessionHealth, ServerFrame};

#[cfg(not(target_os = "macos"))]
use crate::deferred_port::{drain_deferred_terminals, DeferredPortHub};
#[cfg(not(target_os = "macos"))]
use crate::dynamic_extension::DynamicExtensionLoader;
#[cfg(not(target_os = "macos"))]
use crate::event_hub::{EventHub, RuntimeWake};
#[cfg(not(target_os = "macos"))]
use crate::extension_events::{
    drain_extension_events, ExtensionDispatch, ExtensionEventRouter, LoadedExtension,
};
use crate::BrokerOptions;
#[cfg(not(target_os = "macos"))]
use crate::{broker_disconnect_action, broker_frame_action, BrokerDisconnectAction};

pub type Writer = Arc<OutboundWriter>;
type EventSender = Arc<dyn Fn(TransportEvent) + Send + Sync>;

/// Per-session outbound queue bound, in frames. Frames on this socket are
/// protocol-shaped JSON (responses, events, extension envelopes), not bulk
/// transfers — ordinary frames are well under 1 KiB and the webview channel
/// law caps cumulative port-queue payload at 1 MiB — so 1024 frames bounds
/// worst-case outbound memory to the low single-digit MiB range. That is far
/// above any legitimate burst (a state snapshot replay or an event storm)
/// while converting a client that stops draining into a bounded-time
/// disconnect instead of an owner-loop park or unbounded queue growth.
const OUTBOUND_QUEUE_CAPACITY: usize = 1024;

/// Owner-loop write handle: a bounded FIFO of outbound frames drained by a
/// dedicated writer thread. The native owner loop (winit/AppKit on macOS)
/// must never block on client socket IO — a stopped-drain client used to
/// park `write_all` on the AppKit main thread forever holding the writer
/// mutex (issue #11 H2). Enqueue is therefore `try_send`: a full queue means
/// the client stopped draining, and that is a dead session, not a reason to
/// park the producer or silently drop frames.
pub struct OutboundWriter {
    id: u64,
    queue: SyncSender<ServerFrame>,
    events: EventSender,
    escalated: AtomicBool,
    /// Frames enqueued but not yet written+flushed by the writer thread.
    /// Lets the broker's exit path give final frames (the Exit ack) a
    /// bounded delivery window before the process tears the socket down.
    pending: AtomicUsize,
    /// Cloned socket handle used only by the escalation path: `shutdown`
    /// forces a writer thread parked in `write_all` on a wedged client to
    /// fail and exit, so escalation — not peer closure — bounds the
    /// writer thread's lifetime. Taken (consumed) exactly once.
    shutdown_stream: Mutex<Option<UnixStream>>,
}

impl OutboundWriter {
    fn new(
        id: u64,
        events: EventSender,
        stream: &UnixStream,
    ) -> std::io::Result<(Writer, mpsc::Receiver<ServerFrame>)> {
        let (queue, outbound) = mpsc::sync_channel(OUTBOUND_QUEUE_CAPACITY);
        Ok((
            Arc::new(Self {
                id,
                queue,
                events,
                escalated: AtomicBool::new(false),
                pending: AtomicUsize::new(0),
                shutdown_stream: Mutex::new(Some(stream.try_clone()?)),
            }),
            outbound,
        ))
    }

    /// Enqueue one outbound frame. Never blocks and never silently drops:
    /// both non-draining reasons (queue full, writer gone) escalate the
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
                self.escalate("outbound writer exited: client socket unusable");
            }
        }
    }

    /// Waits until the writer thread has written+flushed every enqueued
    /// frame, within `budget`. Used only on the broker-exit path so the Exit
    /// ack keeps its pre-queue delivery guarantee; a healthy drain completes
    /// in microseconds, a wedged client is abandoned after the budget.
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

    /// Escalate to the session-disconnect path — the exact
    /// `TransportEvent::Disconnected` the reader thread emits — so session
    /// cleanup (event-hub/deferred revocation, extension-host close, purge,
    /// owned-broker exit) runs through its existing chain. Write failures
    /// must never be discarded: the 2026-09-15 wedge showed a broker whose
    /// reopen frames vanished into swallowed EPIPE while it looked healthy.
    /// The flag keeps the first escalation authoritative; later observers
    /// (producer or writer thread) dedupe onto it. Escalation also shuts
    /// the socket down so a writer thread parked in `write_all` on the
    /// wedged client fails and exits: escalation, not peer closure, bounds
    /// the writer thread's lifetime.
    fn escalate(&self, reason: &str) {
        if self.escalated.swap(true, Ordering::SeqCst) {
            return;
        }
        eprintln!("opentray client session {} outbound escalation: {reason}", self.id);
        if let Some(stream) = self
            .shutdown_stream
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
        (self.events)(TransportEvent::Disconnected { id: self.id });
    }
}

impl std::fmt::Debug for OutboundWriter {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The queue sender and event hook are not Debug; the session id and
        // escalation state are what diagnostics need.
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

/// The Linux broker loop's single wake channel: socket transport events, the
/// D19 EventPort drain request, and the deferred-terminal drain request
/// share one blocking mpsc receiver (there is no native GUI loop in this
/// checkout; KSNI is a stub). Wrapping `TransportEvent` is a host adapter,
/// not a C ABI difference.
#[cfg(not(target_os = "macos"))]
#[derive(Debug)]
enum BrokerEvent {
    Transport(TransportEvent),
    ExtensionEventsReady,
    DeferredTerminalsReady,
}

/// mpsc wake adapter for the Linux receive loop.
#[cfg(not(target_os = "macos"))]
struct ChannelWake(std::sync::mpsc::Sender<BrokerEvent>);

#[cfg(not(target_os = "macos"))]
impl RuntimeWake for ChannelWake {
    fn wake(&self) -> bool {
        self.0.send(BrokerEvent::ExtensionEventsReady).is_ok()
    }
}

/// DeferredPort sibling of [`ChannelWake`].
#[cfg(not(target_os = "macos"))]
struct DeferredChannelWake(std::sync::mpsc::Sender<BrokerEvent>);

#[cfg(not(target_os = "macos"))]
impl RuntimeWake for DeferredChannelWake {
    fn wake(&self) -> bool {
        self.0.send(BrokerEvent::DeferredTerminalsReady).is_ok()
    }
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

    /// Owner-loop write point: enqueue only, never socket IO. The queue is
    /// one FIFO per session, so command response frames enqueued ahead of
    /// that dispatch's mirrored event frames stay ahead on the wire — the
    /// EventPort ordering law ("response frames before mirror-event frames")
    /// is preserved by queue order, never by writer-thread timing.
    pub fn write_frame(&mut self, frame: ServerFrame) {
        self.writer.enqueue(frame);
    }

    /// Bounded final-flush for the broker-exit path (see
    /// [`OutboundWriter::drain_outbound`]).
    pub fn flush_outbound(&mut self, budget: Duration) -> bool {
        self.writer.drain_outbound(budget)
    }
}

/// Accept-thread poll tick. The listener socket is nonblocking, so shutdown
/// never depends on waking `accept()` through the endpoint path: a
/// replacement broker's `prepare_endpoint` unlinks this listener's socket
/// and rebinds the same path, and a connect-to-self would then wake the
/// REPLACEMENT's listener while this one stayed parked — the H3
/// loop-exited-but-process-alive wedge.
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(20);

/// Bounded wait for the accept thread's exit handshake. If the budget is
/// missed, the join is abandoned (the handle is dropped, detaching the
/// thread) so broker exit — including `exiting()` on the macOS owner loop —
/// can never park on a stuck accept loop.
const LISTENER_JOIN_BUDGET: Duration = Duration::from_millis(500);

pub struct ListenerHandle {
    shutdown: Arc<AtomicBool>,
    endpoint: String,
    /// `(dev, inode)` of the socket file this listener bound, so shutdown
    /// removes the endpoint only while it still names THIS listener's
    /// socket. After a replacement broker rebinds the path, an
    /// unconditional remove would destroy the replacement's endpoint.
    bound_socket: Option<(u64, u64)>,
    accept_exited: Arc<(Mutex<bool>, Condvar)>,
    thread: Option<JoinHandle<()>>,
}

impl ListenerHandle {
    pub fn shutdown(mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // No connect-to-self wake: the nonblocking accept loop observes the
        // flag on its next poll tick (H3 law above).
        let accept_exited = {
            let (lock, cvar) = &*self.accept_exited;
            // Lock poisoning means the accept thread panicked before its exit
            // handshake; the bounded wait below still applies.
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
        if let (Some(bound), Some(current)) =
            (self.bound_socket, socket_file_identity(Path::new(&self.endpoint)))
        {
            if bound == current {
                let _ = remove_file(&self.endpoint);
            }
        }
    }
}

/// `(dev, inode)` of the socket file at `endpoint`, if it exists.
fn socket_file_identity(endpoint: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::metadata(endpoint).ok()?;
    Some((metadata.dev(), metadata.ino()))
}

pub fn spawn_listener(
    options: BrokerOptions,
    send: impl Fn(TransportEvent) + Send + Sync + 'static,
) -> Result<ListenerHandle, Box<dyn std::error::Error>> {
    prepare_endpoint(&options.endpoint)?;
    let listener = UnixListener::bind(&options.endpoint)?;
    // Nonblocking accept: shutdown becomes a flag poll on a fixed tick
    // instead of depending on a wake through the (possibly rebound)
    // endpoint path — the H3 join-hang root.
    listener.set_nonblocking(true)?;
    let bound_socket = socket_file_identity(&options.endpoint);
    write_ready_file(&options)?;

    let endpoint = options.endpoint.to_string_lossy().to_string();
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_thread = shutdown.clone();
    let send: EventSender = Arc::new(send);
    let next_id = Arc::new(AtomicU64::new(1));
    let accept_exited = Arc::new((Mutex::new(false), Condvar::new()));
    let accept_exited_thread = accept_exited.clone();
    let thread = thread::spawn(move || {
        loop {
            if shutdown_thread.load(Ordering::SeqCst) {
                break;
            }

            match listener.accept() {
                Ok((stream, _)) => {
                    if shutdown_thread.load(Ordering::SeqCst) {
                        break;
                    }
                    // Darwin accept() hands the accepted socket the
                    // listener's O_NONBLOCK; both transport ends (reader and
                    // writer) run blocking IO, so restore blocking mode
                    // explicitly and identically on every platform.
                    let _ = stream.set_nonblocking(false);
                    let id = next_id.fetch_add(1, Ordering::SeqCst);
                    match stream.try_clone() {
                        Ok(outbound_stream) => {
                            match OutboundWriter::new(id, send.clone(), &outbound_stream) {
                                Ok((writer, outbound)) => {
                                    send(TransportEvent::Connected {
                                        id,
                                        writer: writer.clone(),
                                    });
                                    spawn_writer(outbound_stream, outbound, writer.clone());
                                    spawn_reader(id, stream, writer, send.clone());
                                }
                                Err(error) => {
                                    eprintln!("failed to clone opentray client stream: {error}");
                                }
                            }
                        }
                        Err(error) => {
                            eprintln!("failed to clone opentray client stream: {error}");
                        }
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(ACCEPT_POLL_INTERVAL);
                }
                Err(error) => {
                    if !shutdown_thread.load(Ordering::SeqCst) {
                        eprintln!("opentray listener error: {error}");
                    }
                    thread::sleep(ACCEPT_POLL_INTERVAL);
                }
            }
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
        bound_socket,
        accept_exited,
        thread: Some(thread),
    })
}

/// Dedicated per-session socket writer: the only place a client socket is
/// written. Every producer (owner loop dispatch, extension drains, reader
/// error frames) enqueues into the bounded FIFO, so a wedged client socket
/// parks at most this thread — never the native owner loop.
fn spawn_writer(
    mut stream: UnixStream,
    outbound: mpsc::Receiver<ServerFrame>,
    writer: Writer,
) {
    thread::spawn(move || {
        for frame in outbound {
            if let Err(error) = serialize_frame(&mut stream, &frame) {
                eprintln!("opentray client write error: {error}");
                // A failed write/flush is a dead session: escalate through
                // the disconnect path so cleanup runs and the failure lands
                // in broker diagnostics instead of being swallowed.
                writer.escalate("socket write failed");
                writer.pending.fetch_sub(1, Ordering::AcqRel);
                break;
            }
            writer.pending.fetch_sub(1, Ordering::AcqRel);
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn run_blocking_broker<B>(
    options: BrokerOptions,
    backend: B,
) -> Result<(), Box<dyn std::error::Error>>
where
    B: AppBackend + 'static,
{
    let (sender, receiver) = std::sync::mpsc::channel::<BrokerEvent>();
    let event_hub = EventHub::new(Box::new(ChannelWake(sender.clone())));
    // One shared deferred-operation registry connects the kernel with the
    // deferred ports (add-ext-dialog design section 5.1).
    let operations = Arc::new(DeferredOperationRegistry::new());
    let deferred_hub =
        DeferredPortHub::new(Box::new(DeferredChannelWake(sender.clone())), operations.clone());
    let listener = spawn_listener(options.clone(), move |event| {
        let _ = sender.send(BrokerEvent::Transport(event));
    })?;
    let mut broker = BrokerKernel::with_default_app_options_and_operations(
        backend,
        DynamicExtensionLoader::from_env(event_hub.clone(), deferred_hub.clone())?,
        options.default_app_options(),
        options.broker_artifact_identity().clone(),
        operations,
    );
    let mut extension_events = ExtensionEventRouter::new();
    let mut sessions = HashMap::<u64, TransportSession>::new();
    let mut idle_since = Some(Instant::now());

    while let Some(event) = receive_next_event(&receiver, options.idle_timeout, idle_since) {
        match event {
            BrokerEvent::Transport(TransportEvent::Connected { id, writer }) => {
                // A broker is pinned to exactly one caller session. Reject a second
                // connection defensively instead of silently aggregating sessions.
                let already_serving = sessions
                    .values()
                    .any(|session| session.broker.session_id().is_some());
                if already_serving {
                    let mut session = TransportSession {
                        writer,
                        broker: BrokerSession::new(),
                    };
                    session.write_frame(ServerFrame::Error {
                        request_id: None,
                        code: "OPENTRAY_BROKER_SINGLE_SESSION".to_string(),
                        message: "broker already serves one caller session".to_string(),
                        details: None,
                    });
                    continue;
                }
                sessions.insert(
                    id,
                    TransportSession {
                        writer,
                        broker: BrokerSession::new(),
                    },
                );
                idle_since = None;
            }
            BrokerEvent::Transport(TransportEvent::Frame { id, frame }) => {
                if let ClientFrame::Health { request_id } = frame {
                    let health = build_runtime_host_health(&options, &sessions);
                    if let Some(session) = sessions.get_mut(&id) {
                        session.write_frame(ServerFrame::RuntimeHostHealth { request_id, health });
                    }
                    continue;
                }
                let Some(session) = sessions.get_mut(&id) else {
                    continue;
                };
                let kernel_session_id = session.broker.session_id().map(ToOwned::to_owned);
                let exit_action = broker_frame_action(&frame, kernel_session_id.is_some());
                // Lifecycle law: the kernel's Exit dispatch runs session
                // cleanup inline, so revoke the closing session's EventPort
                // sources BEFORE dispatch.
                if matches!(exit_action, BrokerDisconnectAction::ExitOwnedBroker) {
                    if let Some(session_id) = kernel_session_id.as_deref() {
                        event_hub.revoke_session(session_id);
                        // Same lifecycle law for deferred terminals.
                        deferred_hub.revoke_session(session_id);
                    }
                }
                let loaded = LoadedExtension::from_frame(&frame);
                let mut extension_host =
                    extension_events.host(ExtensionDispatch::from_frame(&frame), Some(&event_hub));
                let frames = broker.handle_frame_with_extension_host(
                    &mut session.broker,
                    frame,
                    &options.package_version,
                    &mut extension_host,
                );
                let load_acknowledged = matches!(frames.first(), Some(ServerFrame::Ack { .. }));
                session.write_frames(frames);
                if let (Some(loaded), Some(owner)) = (loaded, kernel_session_id.as_deref()) {
                    if load_acknowledged {
                        extension_events.note_loaded(loaded.clone(), owner.to_string());
                        // Only a successful LoadExt ACK opens the reserved source.
                        event_hub.note_loaded_and_open(&loaded.app_id, &loaded.instance, owner);
                        // Same ACK gate for the deferred submit channel.
                        deferred_hub.open_port(&loaded.app_id, &loaded.instance, owner);
                    }
                }
                if matches!(exit_action, BrokerDisconnectAction::ExitOwnedBroker) {
                    // The kernel already took the closing session's id inside
                    // the Exit dispatch; release its extension ownership before
                    // delivering cleanup pushes so they drop, never leak to a
                    // later session.
                    if let Some(session_id) = kernel_session_id.as_deref() {
                        extension_events.forget_session(session_id);
                    }
                }
                deliver_extension_events(
                    &extension_events,
                    &mut sessions,
                    extension_host.take_events(),
                );
                // Post-response barrier drain for hub-submitted pushes.
                drain_hub_extension_events(&event_hub, &extension_events, &broker, &mut sessions);
                // Close-ordering law (design section 5.7 ruling 7): the
                // closing session's pending operations are purged BEFORE the
                // deferred-terminal drain, so a terminal queued before the
                // Exit settles as a diagnostic drop instead of being written
                // into the closing socket.
                let closing_session = if matches!(exit_action, BrokerDisconnectAction::ExitOwnedBroker)
                {
                    kernel_session_id.as_deref()
                } else {
                    None
                };
                drain_hub_deferred_terminals(&deferred_hub, &broker, closing_session, &mut sessions);
            }
            BrokerEvent::Transport(TransportEvent::Disconnected { id }) => {
                let mut was_initialized = false;
                if let Some(mut session) = sessions.remove(&id) {
                    was_initialized = session.broker.session_id().is_some();
                    let closing_session_id = session.broker.session_id().map(ToOwned::to_owned);
                    // Lifecycle law: revoke BEFORE core session_closed so the
                    // closing session's cleanup pushes observe PORT_CLOSED.
                    if let Some(session_id) = closing_session_id.as_deref() {
                        event_hub.revoke_session(session_id);
                        deferred_hub.revoke_session(session_id);
                    }
                    let mut extension_host = extension_events.host(None, Some(&event_hub));
                    let _ = broker.close_session_with_extension_host(
                        &mut session.broker,
                        &mut extension_host,
                    );
                    if let Some(session_id) = closing_session_id.as_deref() {
                        extension_events.forget_session(session_id);
                        broker.operations().purge_session(session_id);
                    }
                    deliver_extension_events(
                        &extension_events,
                        &mut sessions,
                        extension_host.take_events(),
                    );
                    drain_hub_extension_events(
                        &event_hub,
                        &extension_events,
                        &broker,
                        &mut sessions,
                    );
                    drain_hub_deferred_terminals(&deferred_hub, &broker, None, &mut sessions);
                }
                if matches!(
                    broker_disconnect_action(was_initialized),
                    BrokerDisconnectAction::ExitOwnedBroker
                ) {
                    break;
                }
                if sessions.is_empty() {
                    idle_since = Some(Instant::now());
                }
            }
            BrokerEvent::ExtensionEventsReady => {
                drain_hub_extension_events(&event_hub, &extension_events, &broker, &mut sessions);
            }
            BrokerEvent::DeferredTerminalsReady => {
                drain_hub_deferred_terminals(&deferred_hub, &broker, None, &mut sessions);
            }
        }
    }

    // Shutdown law: revoke every source; there is no flush promise.
    event_hub.revoke_all();
    event_hub.log_shutdown_diagnostics();
    deferred_hub.revoke_all();
    listener.shutdown();
    Ok(())
}

/// Deferred-terminal drain with owner-loop settlement and session-writer
/// routing (see `deferred_port::drain_deferred_terminals`). `closing_session`
/// routes the Exit path through the purge-before-drain law (design section
/// 5.7 ruling 7).
#[cfg(not(target_os = "macos"))]
fn drain_hub_deferred_terminals<B>(
    deferred_hub: &DeferredPortHub,
    broker: &BrokerKernel<B, DynamicExtensionLoader>,
    closing_session: Option<&str>,
    sessions: &mut HashMap<u64, TransportSession>,
) where
    B: AppBackend,
{
    drain_deferred_terminals(deferred_hub, broker, closing_session, &mut |owner, frame| {
        let mut delivered = false;
        for session in sessions.values_mut() {
            if session.broker.session_id() == Some(owner) {
                session.write_frame(frame.clone());
                delivered = true;
            }
        }
        delivered
    });
}

/// Bounded hub drain with source-bound route validation (see
/// `extension_events::drain_extension_events`), writing to the owning
/// session's ordered frame channel.
#[cfg(not(target_os = "macos"))]
fn drain_hub_extension_events<B>(
    event_hub: &EventHub,
    extension_events: &ExtensionEventRouter,
    broker: &BrokerKernel<B, DynamicExtensionLoader>,
    sessions: &mut HashMap<u64, TransportSession>,
) where
    B: AppBackend,
{
    drain_extension_events(event_hub, extension_events, broker, &mut |owner, frame| {
        let mut delivered = false;
        for session in sessions.values_mut() {
            if session.broker.session_id() == Some(owner) {
                session.write_frame(frame.clone());
                delivered = true;
            }
        }
        delivered
    });
}

/// Delivers extension-pushed events to the owning client session's existing
/// ordered frame channel (see `extension_events`).
#[cfg(not(target_os = "macos"))]
fn deliver_extension_events(
    extension_events: &ExtensionEventRouter,
    sessions: &mut HashMap<u64, TransportSession>,
    events: Vec<opentray_spec::ExtensionEnvelope>,
) {
    extension_events.deliver(events, &mut |owner, frame| {
        let mut delivered = false;
        for session in sessions.values_mut() {
            if session.broker.session_id() == Some(owner) {
                session.write_frame(frame.clone());
                delivered = true;
            }
        }
        delivered
    });
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

#[cfg(not(target_os = "macos"))]
fn receive_next_event(
    receiver: &std::sync::mpsc::Receiver<BrokerEvent>,
    idle_timeout: Option<std::time::Duration>,
    idle_since: Option<Instant>,
) -> Option<BrokerEvent> {
    let Some(idle_timeout) = idle_timeout else {
        return receiver.recv().ok();
    };
    let Some(idle_since) = idle_since else {
        return receiver.recv().ok();
    };
    let elapsed = idle_since.elapsed();
    if elapsed >= idle_timeout {
        return None;
    }
    match receiver.recv_timeout(idle_timeout - elapsed) {
        Ok(event) => Some(event),
        Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => None,
    }
}

fn spawn_reader(id: u64, stream: UnixStream, writer: Writer, send: EventSender) {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(line) if line.trim().is_empty() => {}
                Ok(line) => match serde_json::from_str::<ClientFrame>(&line) {
                    Ok(frame) => send(TransportEvent::Frame { id, frame }),
                    Err(error) => {
                        // Correlate the error with the originating request when possible
                        // so the client rejects instead of hanging on an uncorrelated error.
                        let request_id = extract_request_id(&line);
                        // Invalid-frame errors ride the same bounded outbound
                        // queue as every other frame; the reader thread never
                        // writes the socket directly.
                        writer.enqueue(ServerFrame::Error {
                            request_id,
                            code: "invalid-frame".to_string(),
                            message: error.to_string(),
                            details: None,
                        });
                    }
                },
                Err(error) => {
                    eprintln!("opentray client read error: {error}");
                    break;
                }
            }
        }
        send(TransportEvent::Disconnected { id });
    });
}

/// Serializes one frame onto the writer thread's stream. Runs only on the
/// dedicated writer thread; failures there escalate the session disconnect.
fn serialize_frame(stream: &mut UnixStream, frame: &ServerFrame) -> std::io::Result<()> {
    serde_json::to_writer(&mut *stream, frame)?;
    stream.write_all(b"\n")?;
    stream.flush()
}

fn prepare_endpoint(endpoint: &Path) -> std::io::Result<()> {
    if let Some(parent) = endpoint.parent() {
        create_dir_all(parent)?;
    }
    if endpoint.exists() {
        remove_file(endpoint)?;
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;
    use std::time::Instant;

    /// Transport-robustness W7 (B4): write failures escalate, full queues
    /// escalate without parking the producer, and the outbound FIFO keeps
    /// response frames ahead of event frames. These exercise the transport
    /// escalation directly; the full disconnect cleanup chain
    /// (event-hub/deferred revocation, extension-host close, purge,
    /// ExitOwnedBroker) is the owner loop's existing handler for the same
    /// `TransportEvent::Disconnected` these tests observe.

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

    fn wait_until(
        sink: &Arc<Mutex<Vec<TransportEvent>>>,
        budget: Duration,
        predicate: impl Fn(&TransportEvent) -> bool,
    ) -> bool {
        let deadline = Instant::now() + budget;
        loop {
            {
                let events = sink.lock().expect("collector lock");
                if events.iter().any(&predicate) {
                    return true;
                }
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn wait_for_connected_writer(
        sink: &Arc<Mutex<Vec<TransportEvent>>>,
        budget: Duration,
    ) -> Option<(u64, Writer)> {
        let deadline = Instant::now() + budget;
        loop {
            {
                let events = sink.lock().expect("collector lock");
                let connected = events.iter().find_map(|event| match event {
                    TransportEvent::Connected { id, writer } => Some((*id, writer.clone())),
                    _ => None,
                });
                if let Some((id, writer)) = connected {
                    return Some((id, writer));
                }
            }
            if Instant::now() >= deadline {
                return None;
            }
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn temp_paths(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "opentray-transport-{}-{name}",
            std::process::id()
        ));
        (base.with_extension("sock"), base.with_extension("ready.json"))
    }

    fn test_broker_options(endpoint: &Path, ready_file: &Path) -> BrokerOptions {
        let (executable_path, artifact_identity) = crate::resolve_current_broker_artifact(
            "0.0.0-transport-test",
        )
        .expect("current broker artifact");
        let identity = serde_json::to_string(&artifact_identity).expect("artifact identity json");
        let args = [
            "--endpoint",
            &endpoint.to_string_lossy(),
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

    /// Escalation-path shutdown handle for tests that model a wedged client
    /// without a real peer: any socket suffices, its shutdown is advisory.
    fn pair_handle() -> UnixStream {
        let (handle, _) = UnixStream::pair().expect("socketpair");
        handle
    }

    #[test]
    fn writer_socket_failure_escalates_disconnected() {
        let sink = collector();
        let (broker_end, client_end) = UnixStream::pair().expect("socketpair");
        // Peer closed: the first write on the broker end fails (EPIPE).
        drop(client_end);
        let (writer, outbound) = OutboundWriter::new(41, collector_events(&sink), &broker_end)
            .expect("outbound writer");
        spawn_writer(broker_end, outbound, writer.clone());
        writer.enqueue(error_frame(0, "gone"));
        assert!(
            wait_until(&sink, Duration::from_secs(5), |event| matches!(
                event,
                TransportEvent::Disconnected { id: 41 }
            )),
            "a write failure must escalate Disconnected through the transport event path"
        );
    }

    #[test]
    fn full_outbound_queue_escalates_without_parking_the_producer() {
        let sink = collector();
        // No writer thread drains: the queue-side model of a client that
        // stopped draining (its writer is parked inside a full kernel
        // buffer, so nothing dequeues).
        let (writer, _never_drained) =
            OutboundWriter::new(42, collector_events(&sink), &pair_handle()).expect("outbound writer");
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
        let (broker_end, client_end) = UnixStream::pair().expect("socketpair");
        let (writer, outbound) = OutboundWriter::new(43, collector_events(&sink), &broker_end)
            .expect("outbound writer");
        spawn_writer(broker_end, outbound, writer.clone());
        // A command response frame enqueued before the same dispatch's
        // mirrored event frame must reach the wire first (EventPort
        // close-ordering law).
        writer.enqueue(ServerFrame::Ack {
            request_id: "req-1".to_string(),
        });
        writer.enqueue(error_frame(1, "mirrored"));
        let mut reader = BufReader::new(client_end);
        let mut line = String::new();
        reader.read_line(&mut line).expect("read response frame");
        let response: serde_json::Value =
            serde_json::from_str(line.trim()).expect("response frame json");
        line.clear();
        reader.read_line(&mut line).expect("read event frame");
        let event: serde_json::Value = serde_json::from_str(line.trim()).expect("event frame json");
        assert_eq!(response["type"].as_str(), Some("ack"));
        assert_eq!(event["type"].as_str(), Some("error"));
    }

    #[test]
    fn drain_outbound_settles_on_flush_and_stays_bounded_when_wedged() {
        // Healthy path: the exit drain settles only after the writer thread
        // actually wrote+flushed every enqueued frame, and the peer observes
        // the flushed bytes.
        let sink = collector();
        let (broker_end, client_end) = UnixStream::pair().expect("socketpair");
        let (writer, outbound) = OutboundWriter::new(50, collector_events(&sink), &broker_end)
            .expect("outbound writer");
        spawn_writer(broker_end, outbound, writer.clone());
        for sequence in 0..64 {
            writer.enqueue(error_frame(sequence, "drain"));
        }
        assert!(
            writer.drain_outbound(Duration::from_secs(2)),
            "a healthy drain settles within the budget"
        );
        let mut line = String::new();
        BufReader::new(client_end)
            .read_line(&mut line)
            .expect("read flushed frame");
        let flushed: serde_json::Value =
            serde_json::from_str(line.trim()).expect("flushed frame json");
        assert_eq!(flushed["code"].as_str(), Some("seq-0"));

        // Wedged path: no consumer ever drains, so the bounded drain gives
        // up after its budget instead of parking the exit path.
        let wedged_sink = collector();
        let (wedged, _never_drained) =
            OutboundWriter::new(51, collector_events(&wedged_sink), &pair_handle())
                .expect("outbound writer");
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
    fn listener_escalates_a_client_that_stops_draining_within_bounded_time() {
        let (endpoint, ready_file) = temp_paths("stopped-drain");
        let sink = collector();
        let listener = {
            let sink = sink.clone();
            spawn_listener(test_broker_options(&endpoint, &ready_file), move |event| {
                sink.lock().expect("collector lock").push(event);
            })
            .expect("spawn listener")
        };
        // A connected client that never reads: the kernel socket buffer
        // fills, the writer thread parks inside write_all, and the bounded
        // queue is the only remaining sink for outbound frames.
        let _client = UnixStream::connect(&endpoint).expect("client connect");
        let (session, writer) =
            wait_for_connected_writer(&sink, Duration::from_secs(5)).expect("connected event");
        let started = Instant::now();
        let payload = "x".repeat(8192);
        let mut escalated = false;
        // 8 KiB frames: kernel socket buffer plus the 1024-frame queue
        // saturate far below this loop bound even with generous buffers.
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

    #[test]
    fn listener_shutdown_is_bounded_when_the_endpoint_was_rebound() {
        let (endpoint, ready_file) = temp_paths("rebind");
        let listener =
            spawn_listener(test_broker_options(&endpoint, &ready_file), |_| {})
                .expect("spawn listener");
        // Replacement broker shape: prepare_endpoint unlinks this
        // listener's socket and a fresh listener binds the same path. The
        // old listener's accept would never see a wake through the endpoint
        // again (the H3 wedge).
        std::fs::remove_file(&endpoint).expect("unlink endpoint for rebind");
        let replacement = UnixListener::bind(&endpoint).expect("replacement listener bind");
        let started = Instant::now();
        listener.shutdown();
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(2),
            "shutdown must not park on a rebound endpoint (took {elapsed:?})"
        );
        assert!(
            endpoint.exists(),
            "shutdown must not destroy the replacement broker's endpoint file"
        );
        drop(replacement);
        let _ = std::fs::remove_file(&endpoint);
        let _ = std::fs::remove_file(&ready_file);
    }

    #[test]
    fn listener_shutdown_removes_its_own_endpoint() {
        let (endpoint, ready_file) = temp_paths("own-endpoint");
        let listener =
            spawn_listener(test_broker_options(&endpoint, &ready_file), |_| {})
                .expect("spawn listener");
        listener.shutdown();
        assert!(
            !endpoint.exists(),
            "shutdown still removes the endpoint while it names this listener's socket"
        );
        let _ = std::fs::remove_file(&ready_file);
    }
}
