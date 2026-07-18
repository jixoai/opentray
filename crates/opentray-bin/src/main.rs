mod dynamic_extension;
mod frame_error;
#[cfg(unix)]
mod unix_transport;
#[cfg(target_os = "windows")]
mod windows_transport;

use std::{env, error::Error, path::PathBuf, time::Duration};

use opentray_spec::{
    sanitize_caller_label, AppOptions, BrokerArtifactIdentity, BrokerArtifactTarget,
    BrokerReadyMetadata, ClientFrame, DEFAULT_CALLER_LABEL, PROTOCOL_VERSION,
};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct BrokerOptions {
    endpoint: PathBuf,
    ready_file: PathBuf,
    package_version: String,
    protocol_version: u32,
    app_id: String,
    app_name: String,
    caller_label: String,
    executable_path: PathBuf,
    broker_artifact_identity: BrokerArtifactIdentity,
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

    pub fn app_id(&self) -> &str {
        &self.app_id
    }

    pub fn app_name(&self) -> &str {
        &self.app_name
    }

    pub fn broker_artifact_identity(&self) -> &BrokerArtifactIdentity {
        &self.broker_artifact_identity
    }

    /// Builds the single readiness record shared by Unix and Windows transports.
    pub fn ready_metadata(&self) -> BrokerReadyMetadata {
        BrokerReadyMetadata {
            pid: std::process::id(),
            endpoint: self.endpoint.to_string_lossy().to_string(),
            package_version: self.package_version.clone(),
            protocol_version: self.protocol_version,
            app_id: self.app_id().to_string(),
            app_name: self.app_name().to_string(),
            caller_label: self.caller_label().to_string(),
            executable_path: self.executable_path.to_string_lossy().to_string(),
            broker_artifact_identity: self.broker_artifact_identity.clone(),
        }
    }

    pub fn default_app_options(&self) -> AppOptions {
        AppOptions {
            id: Some(self.app_id.clone()),
            name: Some(self.app_name.clone()),
            icon: None,
            default: true,
        }
    }
}

const DEFAULT_DAEMON_IDLE_TIMEOUT_MS: u64 = 30_000;
const DAEMON_IDLE_TIMEOUT_ENV: &str = "OPENTRAY_DAEMON_IDLE_TIMEOUT_MS";

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("broker") => run_broker(parse_broker_options(args)?),
        _ => {
            eprintln!("Usage: opentray broker --endpoint <path> --ready-file <path> --package-version <version> --protocol-version <version> --broker-executable-path <path> --broker-artifact-identity <json>");
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
    let mut app_id = None;
    let mut app_name = None;
    let mut caller_label = None;
    let mut broker_executable_path = None;
    let mut broker_artifact_identity = None;
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
            "--app-id" => app_id = Some(value),
            "--app-name" => app_name = Some(value),
            "--caller-label" => caller_label = Some(value),
            "--broker-executable-path" => broker_executable_path = Some(PathBuf::from(value)),
            "--broker-artifact-identity" => {
                broker_artifact_identity =
                    Some(serde_json::from_str::<BrokerArtifactIdentity>(&value)?);
            }
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

    let package_version = package_version.ok_or("missing --package-version")?;
    let expected_executable_path = broker_executable_path
        .ok_or("missing --broker-executable-path")?
        .canonicalize()?;
    let expected_artifact_identity =
        broker_artifact_identity.ok_or("missing --broker-artifact-identity")?;
    let (executable_path, actual_artifact_identity) =
        resolve_current_broker_artifact(&package_version)?;
    // Recompute from current_exe so a path replacement between SDK hashing and exec cannot pass.
    if executable_path != expected_executable_path
        || actual_artifact_identity != expected_artifact_identity
    {
        return Err(format!(
            "broker artifact identity mismatch: expectedPath={}; actualPath={}; expected={}; actual={}",
            expected_executable_path.display(),
            executable_path.display(),
            serde_json::to_string(&expected_artifact_identity)?,
            serde_json::to_string(&actual_artifact_identity)?,
        )
        .into());
    }

    // Caller label precedence: explicit flag > OPENTRAY_DAEMON_CALLER_LABEL env > neutral default.
    let raw_caller_label = caller_label.or_else(|| env::var("OPENTRAY_DAEMON_CALLER_LABEL").ok());
    let caller_label = match raw_caller_label {
        Some(value) if !value.trim().is_empty() => sanitize_caller_label(&value),
        _ => DEFAULT_CALLER_LABEL.to_string(),
    };
    let app_id = resolve_non_empty(
        app_id.or_else(|| env::var("OPENTRAY_DAEMON_APP_ID").ok()),
        &caller_label,
    );
    let app_name = resolve_non_empty(
        app_name.or_else(|| env::var("OPENTRAY_DAEMON_APP_NAME").ok()),
        &caller_label,
    );

    // The visible process name is carried by the spawned argv[0] on platforms
    // whose task manager reflects it (e.g. Linux `ps`/`comm`). The label also
    // scopes the endpoint, runtime directory, ready.json, and runtime-host-health so
    // the owning application is identifiable without inspecting the binary.
    eprintln!("opentray broker starting for caller: {caller_label}");

    Ok(BrokerOptions {
        endpoint: endpoint.ok_or("missing --endpoint")?,
        ready_file: ready_file.ok_or("missing --ready-file")?,
        package_version,
        protocol_version,
        app_id,
        app_name,
        caller_label,
        executable_path,
        broker_artifact_identity: actual_artifact_identity,
        idle_timeout: daemon_idle_timeout()?,
    })
}

fn resolve_current_broker_artifact(
    package_version: &str,
) -> Result<(PathBuf, BrokerArtifactIdentity), Box<dyn Error>> {
    let executable_path = env::current_exe()?.canonicalize()?;
    let executable_hash = format!("{:x}", Sha256::digest(std::fs::read(&executable_path)?));
    let identity = BrokerArtifactIdentity {
        package_version: package_version.to_string(),
        target: BrokerArtifactTarget {
            os: if cfg!(target_os = "windows") {
                "win32"
            } else if cfg!(target_os = "macos") {
                "darwin"
            } else {
                "linux"
            }
            .to_string(),
            arch: if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "x64"
            }
            .to_string(),
        },
        build_identity: format!("sha256:{}", &executable_hash[..16]),
        executable_hash,
    };
    Ok((executable_path, identity))
}

fn resolve_non_empty(value: Option<String>, fallback: &str) -> String {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrokerDisconnectAction {
    ExitOwnedBroker,
    WaitForIdle,
}

pub(crate) fn broker_disconnect_action(
    disconnected_session_was_initialized: bool,
) -> BrokerDisconnectAction {
    if disconnected_session_was_initialized {
        BrokerDisconnectAction::ExitOwnedBroker
    } else {
        BrokerDisconnectAction::WaitForIdle
    }
}

pub(crate) fn broker_frame_action(
    frame: &ClientFrame,
    session_was_initialized: bool,
) -> BrokerDisconnectAction {
    if matches!(frame, ClientFrame::Exit) && session_was_initialized {
        BrokerDisconnectAction::ExitOwnedBroker
    } else {
        BrokerDisconnectAction::WaitForIdle
    }
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
    use super::{
        broker_disconnect_action, broker_frame_action, dynamic_extension::DynamicExtensionLoader,
        BrokerDisconnectAction, BrokerOptions,
    };

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
            broker: BrokerKernel::with_default_app_options(
                TrayIconBackend::with_runtime(NativeTrayIconRuntime::new()),
                DynamicExtensionLoader::from_env()?,
                options.default_app_options(),
                options.broker_artifact_identity().clone(),
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
                UserEvent::Transport(event) => {
                    if matches!(
                        self.handle_transport(event),
                        BrokerDisconnectAction::ExitOwnedBroker
                    ) {
                        event_loop.exit();
                    }
                }
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
        fn handle_transport(
            &mut self,
            event: broker_transport::TransportEvent,
        ) -> BrokerDisconnectAction {
            match event {
                broker_transport::TransportEvent::Connected { id, writer } => {
                    // A broker is pinned to exactly one caller session. With per-caller
                    // endpoints two callers cannot normally reach the same broker, but a
                    // second connection is rejected defensively with a typed error rather
                    // than silently aggregating sessions.
                    let already_serving = self
                        .sessions
                        .values()
                        .any(|session| session.broker.session_id().is_some());
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
                        return BrokerDisconnectAction::WaitForIdle;
                    }
                    self.bump_idle_generation();
                    self.sessions.insert(
                        id,
                        broker_transport::TransportSession {
                            writer,
                            broker: BrokerSession::new(),
                        },
                    );
                    BrokerDisconnectAction::WaitForIdle
                }
                broker_transport::TransportEvent::Frame { id, frame } => {
                    if let ClientFrame::Health { request_id } = frame {
                        let health = broker_transport::build_runtime_host_health(
                            &self.options,
                            &self.sessions,
                        );
                        if let Some(session) = self.sessions.get_mut(&id) {
                            session
                                .write_frame(ServerFrame::RuntimeHostHealth { request_id, health });
                        }
                        return BrokerDisconnectAction::WaitForIdle;
                    }
                    let Some(session) = self.sessions.get_mut(&id) else {
                        return BrokerDisconnectAction::WaitForIdle;
                    };
                    let session_was_initialized = session.broker.session_id().is_some();
                    let exit_action = broker_frame_action(&frame, session_was_initialized);
                    let mut extension_host = UnsupportedExtensionHostContext;
                    let frames = self.broker.handle_frame_with_extension_host(
                        &mut session.broker,
                        frame,
                        &self.broker_version,
                        &mut extension_host,
                    );
                    session.write_frames(frames);
                    if matches!(exit_action, BrokerDisconnectAction::ExitOwnedBroker) {
                        // Windows named-pipe half-close may defer `Disconnected` indefinitely.
                        // `Exit` already performed kernel cleanup above, so the dedicated broker
                        // must leave its GUI event loop without waiting for that transport event.
                        self.sessions.remove(&id);
                        self.bump_idle_generation();
                        self.schedule_idle_if_empty();
                        return exit_action;
                    }
                    BrokerDisconnectAction::WaitForIdle
                }
                broker_transport::TransportEvent::Disconnected { id } => {
                    let mut was_initialized = false;
                    if let Some(mut session) = self.sessions.remove(&id) {
                        was_initialized = session.broker.session_id().is_some();
                        let mut extension_host = UnsupportedExtensionHostContext;
                        let _ = self.broker.close_session_with_extension_host(
                            &mut session.broker,
                            &mut extension_host,
                        );
                    }
                    self.bump_idle_generation();
                    self.schedule_idle_if_empty();
                    broker_disconnect_action(was_initialized)
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
            let Some((button, x, y)) = tray_click_payload(&event) else {
                return;
            };
            let tray_icon_id = event.id().as_ref();
            self.broker.backend().record_tray_interaction(tray_icon_id);
            if button == opentray_spec::MouseButton::Left {
                if let Some(event) = self.broker.backend().primary_event(tray_icon_id) {
                    self.dispatch_backend_event(event);
                    return;
                }
            }
            if let Some(event) = self
                .broker
                .backend()
                .tray_click_event(tray_icon_id, button, x, y)
            {
                self.dispatch_backend_event(event);
            }
        }

        fn dispatch_backend_event(&mut self, event: opentray_spec::TrayEvent) {
            let Some(routed) = self.broker.route_backend_event(event) else {
                return;
            };
            for session in self.sessions.values_mut() {
                if session.broker.session_id() == Some(routed.session_id.as_str()) {
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

    fn tray_click_payload(
        event: &tray_icon::TrayIconEvent,
    ) -> Option<(opentray_spec::MouseButton, i32, i32)> {
        match event {
            tray_icon::TrayIconEvent::Click {
                button,
                button_state: tray_icon::MouseButtonState::Up,
                position,
                ..
            } => Some((
                mouse_button(*button)?,
                coordinate_to_i32(position.x),
                coordinate_to_i32(position.y),
            )),
            _ => None,
        }
    }

    fn mouse_button(button: tray_icon::MouseButton) -> Option<opentray_spec::MouseButton> {
        match button {
            tray_icon::MouseButton::Left => Some(opentray_spec::MouseButton::Left),
            tray_icon::MouseButton::Right => Some(opentray_spec::MouseButton::Right),
            tray_icon::MouseButton::Middle => Some(opentray_spec::MouseButton::Middle),
        }
    }

    fn coordinate_to_i32(value: f64) -> i32 {
        value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        broker_disconnect_action, broker_frame_action, parse_broker_options,
        parse_daemon_idle_timeout, resolve_current_broker_artifact, BrokerDisconnectAction,
        DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
    };
    use opentray_spec::ClientFrame;

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

    #[test]
    fn uninitialized_disconnect_stays_on_idle_timeout() {
        assert_eq!(
            broker_disconnect_action(false),
            BrokerDisconnectAction::WaitForIdle
        );
    }

    #[test]
    fn initialized_session_disconnect_exits_owned_broker() {
        assert_eq!(
            broker_disconnect_action(true),
            BrokerDisconnectAction::ExitOwnedBroker
        );
    }

    #[test]
    fn initialized_session_exit_frame_exits_owned_broker() {
        assert_eq!(
            broker_frame_action(&ClientFrame::Exit, true),
            BrokerDisconnectAction::ExitOwnedBroker
        );
        assert_eq!(
            broker_frame_action(&ClientFrame::Exit, false),
            BrokerDisconnectAction::WaitForIdle
        );
    }

    fn broker_args() -> Vec<String> {
        let (executable_path, artifact_identity) =
            resolve_current_broker_artifact("0.1.0").expect("current broker artifact");
        let artifact_identity_json =
            serde_json::to_string(&artifact_identity).expect("artifact identity");
        vec![
            "--endpoint",
            "/tmp/opentray.sock",
            "--ready-file",
            "/tmp/ready.json",
            "--package-version",
            "0.1.0",
            "--protocol-version",
            "1",
            "--broker-executable-path",
            executable_path.to_str().expect("executable path"),
            "--broker-artifact-identity",
            artifact_identity_json.as_str(),
        ]
        .into_iter()
        .map(ToOwned::to_owned)
        .collect()
    }

    #[test]
    fn broker_options_parse_caller_label() {
        let mut args = broker_args();
        args.push("--caller-label".to_string());
        args.push("myapp".to_string());

        let options = parse_broker_options(args.into_iter()).expect("broker options");
        assert_eq!(options.caller_label(), "myapp");
        assert_eq!(options.app_id(), "myapp");
        assert_eq!(options.app_name(), "myapp");
    }

    #[test]
    fn broker_options_fall_back_to_neutral_caller_label() {
        let options = parse_broker_options(broker_args().into_iter()).expect("broker options");
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

    #[test]
    fn broker_options_preserve_app_identity_metadata() {
        let mut args = broker_args();
        args.extend(
            [
                "--caller-label",
                "build-tool",
                "--app-id",
                "com.example.build",
                "--app-name",
                "Example Build",
            ]
            .iter()
            .map(|value| value.to_string()),
        );

        let options = parse_broker_options(args.into_iter()).expect("broker options");
        assert_eq!(options.caller_label(), "build-tool");
        assert_eq!(options.app_id(), "com.example.build");
        assert_eq!(options.app_name(), "Example Build");
        assert_eq!(
            options.default_app_options().name.as_deref(),
            Some("Example Build")
        );
    }
}
