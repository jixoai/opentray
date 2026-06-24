mod dynamic_extension;
#[cfg(unix)]
mod unix_transport;
#[cfg(target_os = "windows")]
mod windows_transport;

use std::{env, error::Error, path::PathBuf, time::Duration};

use opentray_spec::{sanitize_caller_label, DEFAULT_CALLER_LABEL, PROTOCOL_VERSION};

#[derive(Debug, Clone)]
pub struct BrokerOptions {
    endpoint: PathBuf,
    ready_file: PathBuf,
    package_version: String,
    protocol_version: u32,
    caller_label: String,
    idle_timeout: Option<Duration>,
}

impl BrokerOptions {
    pub fn caller_label(&self) -> &str {
        &self.caller_label
    }

    pub fn endpoint(&self) -> &std::path::Path {
        &self.endpoint
    }

    pub fn ready_file(&self) -> &std::path::Path {
        &self.ready_file
    }

    pub fn package_version(&self) -> &str {
        &self.package_version
    }

    pub fn protocol_version(&self) -> u32 {
        self.protocol_version
    }
}

const DEFAULT_DAEMON_IDLE_TIMEOUT_MS: u64 = 30_000;
const DAEMON_IDLE_TIMEOUT_ENV: &str = "OPENTRAY_DAEMON_IDLE_TIMEOUT_MS";

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("broker") => run_broker(parse_broker_options(args)?),
        _ => {
            eprintln!("Usage: opentray broker --endpoint <path> --ready-file <path> --package-version <version> --protocol-version <version>");
            Ok(())
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn run_broker(options: BrokerOptions) -> Result<(), Box<dyn Error>> {
    native_broker::run(options)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_broker(options: BrokerOptions) -> Result<(), Box<dyn Error>> {
    unix_transport::run_blocking_broker(options, opentray_backend_ksni::KsniBackend::new())
}

#[cfg(all(not(unix), not(target_os = "windows")))]
fn run_broker(_options: BrokerOptions) -> Result<(), Box<dyn Error>> {
    Err("opentray broker transport is not implemented for this platform yet".into())
}

fn parse_broker_options(
    args: impl Iterator<Item = String>,
) -> Result<BrokerOptions, Box<dyn Error>> {
    let mut endpoint = None;
    let mut ready_file = None;
    let mut package_version = None;
    let mut protocol_version = None;
    let mut caller_label = None;
    let mut args = args.peekable();

    while let Some(flag) = args.next() {
        let value = args
            .next()
            .ok_or_else(|| format!("missing value for broker option {flag}"))?;
        match flag.as_str() {
            "--endpoint" => endpoint = Some(PathBuf::from(value)),
            "--ready-file" => ready_file = Some(PathBuf::from(value)),
            "--package-version" => package_version = Some(value),
            "--protocol-version" => {
                protocol_version = Some(value.parse::<u32>()?);
            }
            "--caller-label" => caller_label = Some(value),
            _ => return Err(format!("unknown broker option: {flag}").into()),
        }
    }

    let protocol_version = protocol_version.unwrap_or(PROTOCOL_VERSION);
    if protocol_version != PROTOCOL_VERSION {
        return Err(format!(
            "unsupported broker protocolVersion {protocol_version}; expected {PROTOCOL_VERSION}"
        )
        .into());
    }

    // Caller label precedence: explicit flag > OPENTRAY_DAEMON_CALLER_LABEL env > neutral default.
    let raw_caller_label = caller_label.or_else(|| env::var("OPENTRAY_DAEMON_CALLER_LABEL").ok());
    let caller_label = match raw_caller_label {
        Some(value) if !value.trim().is_empty() => sanitize_caller_label(&value),
        _ => DEFAULT_CALLER_LABEL.to_string(),
    };

    // The visible process name is carried by the spawned argv[0] on platforms
    // whose task manager reflects it (e.g. Linux `ps`/`comm`). The label also
    // scopes the endpoint, runtime directory, ready.json, and daemon-health so
    // the owning application is identifiable without inspecting the binary.
    eprintln!("opentray broker starting for caller: {caller_label}");

    Ok(BrokerOptions {
        endpoint: endpoint.ok_or("missing --endpoint")?,
        ready_file: ready_file.ok_or("missing --ready-file")?,
        package_version: package_version.ok_or("missing --package-version")?,
        protocol_version,
        caller_label,
        idle_timeout: daemon_idle_timeout()?,
    })
}

fn daemon_idle_timeout() -> Result<Option<Duration>, Box<dyn Error>> {
    parse_daemon_idle_timeout(env::var(DAEMON_IDLE_TIMEOUT_ENV).ok().as_deref())
        .map_err(|error| error.into())
}

fn parse_daemon_idle_timeout(value: Option<&str>) -> Result<Option<Duration>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(Some(Duration::from_millis(DEFAULT_DAEMON_IDLE_TIMEOUT_MS)));
    };
    let timeout_ms = value
        .parse::<u64>()
        .map_err(|_| format!("invalid {DAEMON_IDLE_TIMEOUT_ENV}: {value}"))?;
    if timeout_ms == 0 {
        return Ok(None);
    }
    Ok(Some(Duration::from_millis(timeout_ms)))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod native_broker {
    use std::{collections::HashMap, error::Error, time::Duration};

    use opentray_backend_tray_icon::{NativeTrayIconRuntime, TrayIconBackend};
    use opentray_core::{BrokerKernel, BrokerSession, UnsupportedExtensionHostContext};
    use opentray_spec::{ClientFrame, ServerFrame};
    use winit::application::ApplicationHandler;
    use winit::event::StartCause;
    use winit::event::WindowEvent;
    use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
    #[cfg(target_os = "macos")]
    use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
    use winit::window::WindowId;

    #[cfg(target_os = "macos")]
    use super::unix_transport as broker_transport;
    #[cfg(target_os = "windows")]
    use super::windows_transport as broker_transport;
    use super::{dynamic_extension::DynamicExtensionLoader, BrokerOptions};

    #[derive(Debug)]
    enum UserEvent {
        Transport(broker_transport::TransportEvent),
        Menu(tray_icon::menu::MenuEvent),
        Tray(tray_icon::TrayIconEvent),
        IdleExpired(u64),
    }

    pub fn run(options: BrokerOptions) -> Result<(), Box<dyn Error>> {
        let event_loop = build_event_loop()?;
        event_loop.set_control_flow(ControlFlow::Wait);

        let proxy = event_loop.create_proxy();
        let listener = broker_transport::spawn_listener(options.clone(), move |event| {
            let _ = proxy.send_event(UserEvent::Transport(event));
        })?;

        let proxy = event_loop.create_proxy();
        tray_icon::menu::MenuEvent::set_event_handler(Some(move |event| {
            let _ = proxy.send_event(UserEvent::Menu(event));
        }));

        let proxy = event_loop.create_proxy();
        tray_icon::TrayIconEvent::set_event_handler(Some(move |event| {
            let _ = proxy.send_event(UserEvent::Tray(event));
        }));

        let mut app = NativeBrokerApp {
            broker: BrokerKernel::with_extension_loader(
                TrayIconBackend::with_runtime(NativeTrayIconRuntime::new()),
                DynamicExtensionLoader::from_env()?,
            ),
            sessions: HashMap::new(),
            broker_version: options.package_version.clone(),
            idle_timeout: options.idle_timeout,
            idle_generation: 0,
            proxy: event_loop.create_proxy(),
            listener: Some(listener),
            options,
        };
        event_loop.run_app(&mut app)?;
        Ok(())
    }

    fn build_event_loop() -> Result<EventLoop<UserEvent>, Box<dyn Error>> {
        let mut builder = EventLoop::<UserEvent>::with_user_event();
        #[cfg(target_os = "macos")]
        builder
            // Keep the broker process in accessory mode on macOS.
            // OpenTray can host mixed spaces and extensions inside one daemon, so letting one
            // ext-webview window promote the whole process into a Dock-visible regular app would
            // leak app identity across unrelated surfaces. If we ever need a Dock-owned web
            // application, it should be a dedicated runtime atom (for example a future
            // ext-webapp), not a mode toggle inside ext-webview.
            .with_activation_policy(ActivationPolicy::Accessory)
            .with_default_menu(false)
            .with_activate_ignoring_other_apps(false);
        Ok(builder.build()?)
    }

    struct NativeBrokerApp {
        broker: BrokerKernel<TrayIconBackend<NativeTrayIconRuntime>, DynamicExtensionLoader>,
        sessions: HashMap<u64, broker_transport::TransportSession>,
        broker_version: String,
        idle_timeout: Option<Duration>,
        idle_generation: u64,
        proxy: EventLoopProxy<UserEvent>,
        listener: Option<broker_transport::ListenerHandle>,
        options: BrokerOptions,
    }

    impl ApplicationHandler<UserEvent> for NativeBrokerApp {
        fn new_events(&mut self, _event_loop: &ActiveEventLoop, cause: StartCause) {
            if matches!(cause, StartCause::Init) {
                println!("opentray broker ready");
                self.schedule_idle_if_empty();
            }
        }

        fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

        fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
            match event {
                UserEvent::Transport(event) => self.handle_transport(event),
                UserEvent::Menu(event) => self.handle_menu(event),
                UserEvent::Tray(event) => self.handle_tray(event),
                UserEvent::IdleExpired(generation) => {
                    if self.sessions.is_empty() && generation == self.idle_generation {
                        event_loop.exit();
                    }
                }
            }
        }

        fn window_event(
            &mut self,
            _event_loop: &ActiveEventLoop,
            _window_id: WindowId,
            _event: WindowEvent,
        ) {
        }

        fn exiting(&mut self, _event_loop: &ActiveEventLoop) {
            if let Some(listener) = self.listener.take() {
                listener.shutdown();
            }
        }
    }

    impl NativeBrokerApp {
        fn handle_transport(&mut self, event: broker_transport::TransportEvent) {
            match event {
                broker_transport::TransportEvent::Connected { id, writer } => {
                    // A broker is pinned to exactly one caller session. With per-caller
                    // endpoints two callers cannot normally reach the same broker, but a
                    // second connection is rejected defensively with a typed error rather
                    // than silently aggregating sessions.
                    let already_serving = self
                        .sessions
                        .values()
                        .any(|session| session.broker.lease_id().is_some());
                    if already_serving {
                        let mut session = broker_transport::TransportSession {
                            writer,
                            broker: BrokerSession::new(),
                        };
                        session.write_frame(ServerFrame::Error {
                            request_id: None,
                            code: "OPENTRAY_BROKER_SINGLE_SESSION".to_string(),
                            message: "broker already serves one caller session".to_string(),
                        });
                        return;
                    }
                    self.bump_idle_generation();
                    self.sessions.insert(
                        id,
                        broker_transport::TransportSession {
                            writer,
                            broker: BrokerSession::new(),
                        },
                    );
                }
                broker_transport::TransportEvent::Frame { id, frame } => {
                    if let ClientFrame::Health { request_id } = frame {
                        let health =
                            broker_transport::build_daemon_health(&self.options, &self.sessions);
                        if let Some(session) = self.sessions.get_mut(&id) {
                            session.write_frame(ServerFrame::DaemonHealth { request_id, health });
                        }
                        return;
                    }
                    let Some(session) = self.sessions.get_mut(&id) else {
                        return;
                    };
                    let mut extension_host = UnsupportedExtensionHostContext;
                    let frames = self.broker.handle_frame_with_extension_host(
                        &mut session.broker,
                        frame,
                        &self.broker_version,
                        &mut extension_host,
                    );
                    session.write_frames(frames);
                }
                broker_transport::TransportEvent::Disconnected { id } => {
                    if let Some(mut session) = self.sessions.remove(&id) {
                        let mut extension_host = UnsupportedExtensionHostContext;
                        let _ = self.broker.close_session_with_extension_host(
                            &mut session.broker,
                            &mut extension_host,
                        );
                    }
                    self.bump_idle_generation();
                    self.schedule_idle_if_empty();
                }
            }
        }

        fn handle_menu(&mut self, event: tray_icon::menu::MenuEvent) {
            let menu_id = event.id.0;
            let Some(event) = self.broker.backend().menu_event(&menu_id) else {
                return;
            };
            self.dispatch_backend_event(event);
        }

        fn handle_tray(&mut self, event: tray_icon::TrayIconEvent) {
            if !is_primary_tray_activation(&event) {
                return;
            }
            self.broker
                .backend()
                .record_tray_interaction(event.id().as_ref());
            let Some(event) = self.broker.backend().primary_event(event.id().as_ref()) else {
                return;
            };
            self.dispatch_backend_event(event);
        }

        fn dispatch_backend_event(&mut self, event: opentray_spec::TrayEvent) {
            let Some(routed) = self.broker.route_backend_event(event) else {
                return;
            };
            for session in self.sessions.values_mut() {
                if session.broker.lease_id() == Some(routed.lease_id.as_str()) {
                    session.write_frame(ServerFrame::Event {
                        event: routed.event.clone(),
                    });
                }
            }
        }

        fn bump_idle_generation(&mut self) {
            self.idle_generation = self.idle_generation.wrapping_add(1);
        }

        fn schedule_idle_if_empty(&mut self) {
            if !self.sessions.is_empty() {
                return;
            }
            let Some(timeout) = self.idle_timeout else {
                return;
            };
            // Generation tokens cancel stale idle timers when a new session connects.
            let generation = self.idle_generation;
            let proxy = self.proxy.clone();
            std::thread::spawn(move || {
                std::thread::sleep(timeout);
                let _ = proxy.send_event(UserEvent::IdleExpired(generation));
            });
        }
    }

    fn is_primary_tray_activation(event: &tray_icon::TrayIconEvent) -> bool {
        matches!(
            event,
            tray_icon::TrayIconEvent::Click {
                button: tray_icon::MouseButton::Left,
                button_state: tray_icon::MouseButtonState::Up,
                ..
            }
        )
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{parse_broker_options, parse_daemon_idle_timeout, DEFAULT_DAEMON_IDLE_TIMEOUT_MS};

    #[test]
    fn daemon_idle_timeout_defaults_to_short_release_window() {
        assert_eq!(
            parse_daemon_idle_timeout(None).unwrap(),
            Some(Duration::from_millis(DEFAULT_DAEMON_IDLE_TIMEOUT_MS))
        );
    }

    #[test]
    fn daemon_idle_timeout_can_be_disabled() {
        assert_eq!(parse_daemon_idle_timeout(Some("0")).unwrap(), None);
    }

    #[test]
    fn daemon_idle_timeout_accepts_milliseconds() {
        assert_eq!(
            parse_daemon_idle_timeout(Some("500")).unwrap(),
            Some(Duration::from_millis(500))
        );
    }

    fn broker_args() -> Vec<String> {
        [
            "--endpoint",
            "/tmp/opentray.sock",
            "--ready-file",
            "/tmp/ready.json",
            "--package-version",
            "0.1.0",
            "--protocol-version",
            "1",
        ]
        .iter()
        .map(|value| value.to_string())
        .collect()
    }

    #[test]
    fn broker_options_parse_caller_label() {
        let mut args = broker_args();
        args.push("--caller-label".to_string());
        args.push("myapp".to_string());

        let options = parse_broker_options(args.into_iter()).expect("broker options");
        assert_eq!(options.caller_label(), "myapp");
    }

    #[test]
    fn broker_options_fall_back_to_neutral_caller_label() {
        let options =
            parse_broker_options(broker_args().into_iter()).expect("broker options");
        assert_eq!(options.caller_label(), "opentray");
    }

    #[test]
    fn broker_options_sanitize_unsafe_caller_label() {
        let mut args = broker_args();
        args.push("--caller-label".to_string());
        args.push("My App!!!".to_string());

        let options = parse_broker_options(args.into_iter()).expect("broker options");
        assert_eq!(options.caller_label(), "my-app");
    }
}
