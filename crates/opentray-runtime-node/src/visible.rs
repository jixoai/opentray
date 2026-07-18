use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use napi::{Error, Status};
use napi_derive::napi;
use opentray_backend_tray_icon::{NativeTrayIconRuntime, TrayIconBackend};
use opentray_core::{BrokerKernel, BrokerSession, UnsupportedExtensionHostContext};
use opentray_spec::{
    AppIdentity, AppOptions, ClientFrame, RuntimeHostHealth, RuntimeHostSessionHealth, ServerFrame,
    TrayEvent, PROTOCOL_VERSION,
};
use winit::application::ApplicationHandler;
use winit::event::StartCause;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
#[cfg(target_os = "macos")]
use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
use winit::window::WindowId;

use crate::{runtime_app_identity, runtime_broker_artifact_identity, serialize_frames};

#[napi(object)]
pub struct VisibleRuntimeHostOptions {
    pub package_version: Option<String>,
    pub app_id: Option<String>,
    pub app_name: Option<String>,
    pub auto_exit_after_ms: Option<u32>,
}

#[derive(Clone)]
struct VisibleHostHandle {
    proxy: EventLoopProxy<UserEvent>,
}

static VISIBLE_HOST: OnceLock<Mutex<Option<VisibleHostHandle>>> = OnceLock::new();

#[napi]
pub struct VisibleRuntime {
    host: VisibleHostHandle,
    closed: Mutex<bool>,
}

#[napi]
impl VisibleRuntime {
    #[napi]
    pub fn request(&self, frame_json: String) -> napi::Result<Vec<String>> {
        self.send(RuntimeCommand::Request { frame_json })
    }

    #[napi]
    pub fn poll_events(&self) -> napi::Result<Vec<String>> {
        self.send(RuntimeCommand::PollEvents)
    }

    #[napi]
    pub fn close(&self) -> napi::Result<Vec<String>> {
        self.close_inner(true)
    }
}

impl VisibleRuntime {
    fn send(&self, command: RuntimeCommand) -> napi::Result<Vec<String>> {
        send_runtime_command(&self.host, command)
    }

    fn close_inner(&self, exit_host: bool) -> napi::Result<Vec<String>> {
        let mut closed = self
            .closed
            .lock()
            .map_err(|_| Error::new(Status::GenericFailure, "visible runtime lock poisoned"))?;
        if *closed {
            return Ok(Vec::new());
        }
        *closed = true;
        send_runtime_command(&self.host, RuntimeCommand::Close { exit_host })
    }
}

impl Drop for VisibleRuntime {
    fn drop(&mut self) {
        if let Ok(mut closed) = self.closed.lock() {
            if !*closed {
                *closed = true;
                let _ = send_runtime_command(&self.host, RuntimeCommand::Close { exit_host: true });
            }
        }
    }
}

#[napi]
pub fn create_visible_runtime() -> napi::Result<VisibleRuntime> {
    let host = current_visible_host()?;
    send_runtime_command(&host, RuntimeCommand::Connect)?;
    Ok(VisibleRuntime {
        host,
        closed: Mutex::new(false),
    })
}

#[napi]
pub fn run_visible_runtime_host(options: Option<VisibleRuntimeHostOptions>) -> napi::Result<()> {
    let options = options.unwrap_or(VisibleRuntimeHostOptions {
        package_version: None,
        app_id: None,
        app_name: None,
        auto_exit_after_ms: None,
    });
    let package_version = options
        .package_version
        .unwrap_or_else(|| "0.0.0".to_string());
    let broker_artifact_identity = runtime_broker_artifact_identity(&package_version)?;
    let app = runtime_app_identity(options.app_id, options.app_name);
    let event_loop = build_event_loop()?;
    event_loop.set_control_flow(ControlFlow::Wait);

    let proxy = event_loop.create_proxy();
    register_visible_host(VisibleHostHandle {
        proxy: proxy.clone(),
    })?;

    let proxy = event_loop.create_proxy();
    tray_icon::menu::MenuEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::Menu(event));
    }));

    let proxy = event_loop.create_proxy();
    tray_icon::TrayIconEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::Tray(event));
    }));

    if let Some(duration) = options
        .auto_exit_after_ms
        .filter(|duration| *duration > 0)
        .map(|duration| Duration::from_millis(u64::from(duration)))
    {
        let proxy = event_loop.create_proxy();
        std::thread::spawn(move || {
            std::thread::sleep(duration);
            let _ = proxy.send_event(UserEvent::AutoExit);
        });
    }

    let mut app = VisibleRuntimeApp {
        broker: BrokerKernel::with_default_app_options(
            TrayIconBackend::with_runtime(NativeTrayIconRuntime::new()),
            opentray_core::UnsupportedExtensionLoader,
            AppOptions {
                id: Some(app.app_id.clone()),
                name: Some(app.app_name.clone()),
                icon: None,
                default: true,
            },
            broker_artifact_identity,
        ),
        session: None,
        event_queue: Vec::new(),
        package_version,
        app,
    };
    let result = event_loop.run_app(&mut app);
    clear_visible_host();
    result.map_err(|error| Error::new(Status::GenericFailure, error.to_string()))
}

fn build_event_loop() -> napi::Result<EventLoop<UserEvent>> {
    let mut builder = EventLoop::<UserEvent>::with_user_event();
    #[cfg(target_os = "macos")]
    builder
        .with_activation_policy(ActivationPolicy::Accessory)
        .with_default_menu(false)
        .with_activate_ignoring_other_apps(false);
    builder
        .build()
        .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))
}

#[derive(Debug)]
enum UserEvent {
    Command(RuntimeCommandEnvelope),
    Menu(tray_icon::menu::MenuEvent),
    Tray(tray_icon::TrayIconEvent),
    AutoExit,
}

#[derive(Debug)]
struct RuntimeCommandEnvelope {
    command: RuntimeCommand,
    respond_to: mpsc::Sender<CommandResult>,
}

#[derive(Debug)]
enum RuntimeCommand {
    Connect,
    Request { frame_json: String },
    PollEvents,
    Close { exit_host: bool },
}

type CommandResult = Result<Vec<String>, String>;

struct VisibleRuntimeApp {
    broker: BrokerKernel<TrayIconBackend<NativeTrayIconRuntime>>,
    session: Option<BrokerSession>,
    event_queue: Vec<String>,
    package_version: String,
    app: AppIdentity,
}

impl ApplicationHandler<UserEvent> for VisibleRuntimeApp {
    fn new_events(&mut self, _event_loop: &ActiveEventLoop, cause: StartCause) {
        if matches!(cause, StartCause::Init) {
            println!("opentray visible runtime host ready");
        }
    }

    fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Command(envelope) => {
                let RuntimeCommandEnvelope {
                    command,
                    respond_to,
                } = envelope;
                let exit_after = matches!(command, RuntimeCommand::Close { exit_host: true });
                let result = self.handle_command(command);
                let _ = respond_to.send(result);
                if exit_after {
                    event_loop.exit();
                }
            }
            UserEvent::Menu(event) => self.handle_menu(event),
            UserEvent::Tray(event) => self.handle_tray(event),
            UserEvent::AutoExit => event_loop.exit(),
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        _event: WindowEvent,
    ) {
    }
}

impl VisibleRuntimeApp {
    fn handle_command(&mut self, command: RuntimeCommand) -> CommandResult {
        match command {
            RuntimeCommand::Connect => {
                if self.session.is_some() {
                    return Err("OPENTRAY_VISIBLE_RUNTIME_SINGLE_SESSION: visible runtime host already serves one caller session".to_string());
                }
                self.session = Some(BrokerSession::new());
                Ok(Vec::new())
            }
            RuntimeCommand::Request { frame_json } => {
                let frame = serde_json::from_str::<ClientFrame>(&frame_json)
                    .map_err(|error| format!("invalid OpenTray client frame JSON: {error}"))?;
                if let ClientFrame::Health { request_id } = frame {
                    return serialize_visible_frames(vec![ServerFrame::RuntimeHostHealth {
                        request_id,
                        health: self.health(),
                    }]);
                }
                let Some(session) = self.session.as_mut() else {
                    return Err(
                        "OPENTRAY_VISIBLE_RUNTIME_NO_SESSION: createVisibleRuntime() must connect first"
                            .to_string(),
                    );
                };
                let mut extension_host = UnsupportedExtensionHostContext;
                let frames = self.broker.handle_frame_with_extension_host(
                    session,
                    frame,
                    &self.package_version,
                    &mut extension_host,
                );
                serialize_visible_frames(frames)
            }
            RuntimeCommand::PollEvents => Ok(self.event_queue.drain(..).collect()),
            RuntimeCommand::Close { exit_host: _ } => {
                let Some(mut session) = self.session.take() else {
                    return Ok(Vec::new());
                };
                let mut extension_host = UnsupportedExtensionHostContext;
                let frames = self
                    .broker
                    .close_session_with_extension_host(&mut session, &mut extension_host);
                self.event_queue.clear();
                serialize_visible_frames(frames)
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

    fn dispatch_backend_event(&mut self, event: TrayEvent) {
        let Some(session) = self.session.as_ref() else {
            return;
        };
        let Some(routed) = self.broker.route_backend_event(event) else {
            return;
        };
        if session.session_id() != Some(routed.session_id.as_str()) {
            return;
        }
        if let Ok(mut frames) = serialize_visible_frames(vec![ServerFrame::Event {
            event: routed.event,
        }]) {
            self.event_queue.append(&mut frames);
        }
    }

    fn health(&self) -> RuntimeHostHealth {
        let session_health = self
            .session
            .as_ref()
            .and_then(|session| session.session_id())
            .map(|session_id| RuntimeHostSessionHealth {
                session_id: 1,
                internal_session_id: Some(session_id.to_string()),
                initialized: true,
            });
        RuntimeHostHealth {
            pid: std::process::id(),
            package_version: self.package_version.clone(),
            protocol_version: PROTOCOL_VERSION,
            endpoint: "in-process://opentray-runtime-node/visible".to_string(),
            app: self
                .session
                .as_ref()
                .and_then(BrokerSession::app_identity)
                .cloned()
                .unwrap_or_else(|| self.app.clone()),
            caller_label: opentray_spec::sanitize_caller_label(&self.app.app_name),
            session_count: usize::from(session_health.is_some()),
            sessions: session_health.into_iter().collect(),
        }
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

fn current_visible_host() -> napi::Result<VisibleHostHandle> {
    VISIBLE_HOST
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| Error::new(Status::GenericFailure, "visible runtime host lock poisoned"))?
        .clone()
        .ok_or_else(|| {
            Error::new(
                Status::GenericFailure,
                "OpenTray visible runtime host is not running; call runVisibleRuntimeHost() on the host main thread first",
            )
        })
}

fn register_visible_host(host: VisibleHostHandle) -> napi::Result<()> {
    let mut current = VISIBLE_HOST
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| Error::new(Status::GenericFailure, "visible runtime host lock poisoned"))?;
    if current.is_some() {
        return Err(Error::new(
            Status::GenericFailure,
            "OpenTray visible runtime host is already running",
        ));
    }
    *current = Some(host);
    Ok(())
}

fn clear_visible_host() {
    if let Ok(mut current) = VISIBLE_HOST.get_or_init(|| Mutex::new(None)).lock() {
        *current = None;
    }
}

fn send_runtime_command(
    host: &VisibleHostHandle,
    command: RuntimeCommand,
) -> napi::Result<Vec<String>> {
    let (respond_to, response) = mpsc::channel();
    host.proxy
        .send_event(UserEvent::Command(RuntimeCommandEnvelope {
            command,
            respond_to,
        }))
        .map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "OpenTray visible runtime host stopped",
            )
        })?;
    response
        .recv()
        .map_err(|_| {
            Error::new(
                Status::GenericFailure,
                "OpenTray visible runtime host stopped",
            )
        })?
        .map_err(|message| Error::new(Status::GenericFailure, message))
}

fn serialize_visible_frames(frames: Vec<ServerFrame>) -> CommandResult {
    serialize_frames(frames).map_err(|error| error.to_string())
}
