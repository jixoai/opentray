use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use opentray_core::BrokerSession;
use opentray_spec::{ClientFrame, DaemonHealth, DaemonSessionHealth, ServerFrame};
use serde_json::json;
use windows_sys::Win32::Foundation::{
    GetLastError, ERROR_BROKEN_PIPE, ERROR_NO_DATA, ERROR_PIPE_CONNECTED, ERROR_PIPE_NOT_CONNECTED,
    INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PeekNamedPipe, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES,
};

use crate::BrokerOptions;

pub type Writer = mpsc::Sender<ServerFrame>;
type EventSender = Arc<dyn Fn(TransportEvent) + Send + Sync>;
const PIPE_POLL_INTERVAL: Duration = Duration::from_millis(10);

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

    pub fn write_frame(&mut self, frame: ServerFrame) {
        let _ = self.writer.send(frame);
    }
}

pub struct ListenerHandle {
    shutdown: Arc<AtomicBool>,
    endpoint: String,
    thread: Option<JoinHandle<()>>,
}

impl ListenerHandle {
    pub fn shutdown(mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        let _ = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&self.endpoint);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
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
            let (writer, outbound) = mpsc::channel::<ServerFrame>();
            send(TransportEvent::Connected {
                id,
                writer: writer.clone(),
            });
            spawn_pipe_pump(id, pipe, outbound, send.clone());
        }
    });

    Ok(ListenerHandle {
        shutdown,
        endpoint,
        thread: Some(thread),
    })
}

pub fn build_daemon_health(
    options: &BrokerOptions,
    sessions: &HashMap<u64, TransportSession>,
) -> DaemonHealth {
    let mut sessions = sessions
        .iter()
        .map(|(session_id, session)| DaemonSessionHealth {
            session_id: *session_id,
            internal_lease_id: session.broker.lease_id().map(ToOwned::to_owned),
            initialized: session.broker.lease_id().is_some(),
        })
        .collect::<Vec<_>>();
    sessions.sort_by_key(|session| session.session_id);

    DaemonHealth {
        pid: std::process::id(),
        package_version: options.package_version.clone(),
        protocol_version: options.protocol_version,
        endpoint: options.endpoint.to_string_lossy().to_string(),
        session_count: sessions.len(),
        sessions,
    }
}

fn spawn_pipe_pump(id: u64, mut stream: File, outbound: Receiver<ServerFrame>, send: EventSender) {
    thread::spawn(move || {
        // Keep synchronous named-pipe reads and writes on one thread; cloned handles can block
        // each other on Windows while a read is pending.
        let mut inbound = Vec::<u8>::new();
        loop {
            if !drain_outbound(&mut stream, &outbound) {
                break;
            }

            match available_pipe_bytes(&stream) {
                Ok(0) => match outbound.recv_timeout(PIPE_POLL_INTERVAL) {
                    Ok(frame) => {
                        if let Err(error) = write_frame_to_pipe(&mut stream, &frame) {
                            eprintln!("opentray client write error: {error}");
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

fn drain_outbound(stream: &mut File, outbound: &Receiver<ServerFrame>) -> bool {
    loop {
        match outbound.try_recv() {
            Ok(frame) => {
                if let Err(error) = write_frame_to_pipe(stream, &frame) {
                    eprintln!("opentray client write error: {error}");
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
                write_frame_to_pipe(
                    stream,
                    &ServerFrame::Error {
                        request_id: None,
                        code: "invalid-frame".to_string(),
                        message: error.to_string(),
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

    let ready = json!({
        "pid": std::process::id(),
        "endpoint": options.endpoint.to_string_lossy(),
        "packageVersion": options.package_version,
        "protocolVersion": options.protocol_version,
    });
    let mut file = File::create(&options.ready_file)?;
    serde_json::to_writer_pretty(&mut file, &ready)?;
    file.write_all(b"\n")?;
    Ok(())
}

fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}
