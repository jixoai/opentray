use std::collections::HashMap;
use std::fs::{create_dir_all, remove_file, File};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
#[cfg(not(target_os = "macos"))]
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};

use crate::frame_error::extract_request_id;
#[cfg(not(target_os = "macos"))]
use std::time::Instant;

use opentray_core::BrokerSession;
#[cfg(not(target_os = "macos"))]
use opentray_core::{AppBackend, BrokerKernel};
use opentray_spec::{ClientFrame, RuntimeHostHealth, RuntimeHostSessionHealth, ServerFrame};

#[cfg(not(target_os = "macos"))]
use crate::dynamic_extension::DynamicExtensionLoader;
use crate::BrokerOptions;
#[cfg(not(target_os = "macos"))]
use crate::{broker_disconnect_action, BrokerDisconnectAction};

pub type Writer = Arc<Mutex<UnixStream>>;
type EventSender = Arc<dyn Fn(TransportEvent) + Send + Sync>;

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
        let _ = write_frame(&self.writer, &frame);
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
        let _ = UnixStream::connect(&self.endpoint);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let _ = remove_file(&self.endpoint);
    }
}

pub fn spawn_listener(
    options: BrokerOptions,
    send: impl Fn(TransportEvent) + Send + Sync + 'static,
) -> Result<ListenerHandle, Box<dyn std::error::Error>> {
    prepare_endpoint(&options.endpoint)?;
    let listener = UnixListener::bind(&options.endpoint)?;
    write_ready_file(&options)?;

    let endpoint = options.endpoint.to_string_lossy().to_string();
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_thread = shutdown.clone();
    let send: EventSender = Arc::new(send);
    let next_id = Arc::new(AtomicU64::new(1));
    let thread = thread::spawn(move || {
        for stream in listener.incoming() {
            if shutdown_thread.load(Ordering::SeqCst) {
                break;
            }

            match stream {
                Ok(stream) => {
                    let id = next_id.fetch_add(1, Ordering::SeqCst);
                    match stream.try_clone() {
                        Ok(writer) => {
                            let writer = Arc::new(Mutex::new(writer));
                            send(TransportEvent::Connected {
                                id,
                                writer: writer.clone(),
                            });
                            spawn_reader(id, stream, writer, send.clone());
                        }
                        Err(error) => {
                            eprintln!("failed to clone opentray client stream: {error}");
                        }
                    }
                }
                Err(error) => {
                    if !shutdown_thread.load(Ordering::SeqCst) {
                        eprintln!("opentray listener error: {error}");
                    }
                }
            }
        }
    });

    Ok(ListenerHandle {
        shutdown,
        endpoint,
        thread: Some(thread),
    })
}

#[cfg(not(target_os = "macos"))]
pub fn run_blocking_broker<B>(
    options: BrokerOptions,
    backend: B,
) -> Result<(), Box<dyn std::error::Error>>
where
    B: AppBackend + 'static,
{
    let (sender, receiver) = std::sync::mpsc::channel::<TransportEvent>();
    let listener = spawn_listener(options.clone(), move |event| {
        let _ = sender.send(event);
    })?;
    let mut broker = BrokerKernel::with_default_app_options(
        backend,
        DynamicExtensionLoader::from_env()?,
        options.default_app_options(),
        options.broker_artifact_identity().clone(),
    );
    let mut sessions = HashMap::<u64, TransportSession>::new();
    let mut idle_since = Some(Instant::now());

    while let Some(event) = receive_next_event(&receiver, options.idle_timeout, idle_since) {
        match event {
            TransportEvent::Connected { id, writer } => {
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
            TransportEvent::Frame { id, frame } => {
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
                let frames =
                    broker.handle_frame(&mut session.broker, frame, &options.package_version);
                session.write_frames(frames);
            }
            TransportEvent::Disconnected { id } => {
                let mut was_initialized = false;
                if let Some(mut session) = sessions.remove(&id) {
                    was_initialized = session.broker.session_id().is_some();
                    let _ = broker.close_session(&mut session.broker);
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
        }
    }

    listener.shutdown();
    Ok(())
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
    receiver: &std::sync::mpsc::Receiver<TransportEvent>,
    idle_timeout: Option<std::time::Duration>,
    idle_since: Option<Instant>,
) -> Option<TransportEvent> {
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
                        let _ = write_frame(
                            &writer,
                            &ServerFrame::Error {
                                request_id,
                                code: "invalid-frame".to_string(),
                                message: error.to_string(),
                            },
                        );
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

fn write_frame(writer: &Writer, frame: &ServerFrame) -> std::io::Result<()> {
    let mut writer = writer.lock().expect("opentray client writer lock");
    serde_json::to_writer(&mut *writer, frame)?;
    writer.write_all(b"\n")?;
    writer.flush()
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
