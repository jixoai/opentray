#[cfg(unix)]
mod unix_transport;

use std::{env, error::Error, path::PathBuf, time::Duration};

use opentray_spec::PROTOCOL_VERSION;

#[derive(Debug, Clone)]
pub struct BrokerOptions {
    endpoint: PathBuf,
    ready_file: PathBuf,
    package_version: String,
    protocol_version: u32,
    idle_timeout: Option<Duration>,
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

#[cfg(target_os = "macos")]
fn run_broker(options: BrokerOptions) -> Result<(), Box<dyn Error>> {
    native_broker::run(options)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn run_broker(options: BrokerOptions) -> Result<(), Box<dyn Error>> {
    unix_transport::run_blocking_broker(options, opentray_backend_ksni::KsniBackend::new())
}

#[cfg(not(unix))]
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

    Ok(BrokerOptions {
        endpoint: endpoint.ok_or("missing --endpoint")?,
        ready_file: ready_file.ok_or("missing --ready-file")?,
        package_version: package_version.ok_or("missing --package-version")?,
        protocol_version,
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

#[cfg(target_os = "macos")]
mod native_broker {
    use std::{collections::HashMap, error::Error, time::Duration};

    use opentray_backend_tray_icon::{NativeTrayIconRuntime, TrayIconBackend};
    use opentray_core::{
        BrokerKernel, BrokerSession, ExtensionError, ExtensionInstance, ExtensionLoadRequest,
        ExtensionLoader,
    };
    use opentray_spec::{ExtensionEnvelope, ExtensionScope, ServerFrame};
    use serde_json::{json, Value};
    use winit::application::ApplicationHandler;
    use winit::dpi::LogicalSize;
    use winit::event::{StartCause, WindowEvent};
    use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
    use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
    use winit::window::{Window, WindowId};
    use wry::{WebView, WebViewBuilder};

    use super::{unix_transport, BrokerOptions};

    #[derive(Debug)]
    enum UserEvent {
        Transport(unix_transport::TransportEvent),
        Menu(tray_icon::menu::MenuEvent),
        Webview(WebviewRuntimeMessage),
        IdleExpired(u64),
    }

    pub fn run(options: BrokerOptions) -> Result<(), Box<dyn Error>> {
        let mut builder = EventLoop::<UserEvent>::with_user_event();
        builder
            .with_activation_policy(ActivationPolicy::Accessory)
            .with_default_menu(false)
            .with_activate_ignoring_other_apps(false);
        let event_loop = builder.build()?;
        event_loop.set_control_flow(ControlFlow::Wait);

        let proxy = event_loop.create_proxy();
        let listener = unix_transport::spawn_listener(options.clone(), move |event| {
            let _ = proxy.send_event(UserEvent::Transport(event));
        })?;

        let proxy = event_loop.create_proxy();
        tray_icon::menu::MenuEvent::set_event_handler(Some(move |event| {
            let _ = proxy.send_event(UserEvent::Menu(event));
        }));

        let proxy = event_loop.create_proxy();
        let mut app = NativeBrokerApp {
            broker: BrokerKernel::with_extension_loader(
                TrayIconBackend::with_runtime(NativeTrayIconRuntime::new()),
                NativeWebviewLoader { proxy },
            ),
            sessions: HashMap::new(),
            broker_version: options.package_version,
            idle_timeout: options.idle_timeout,
            idle_generation: 0,
            webview: NativeWebviewRuntime::default(),
            proxy: event_loop.create_proxy(),
            listener: Some(listener),
        };
        event_loop.run_app(&mut app)?;
        Ok(())
    }

    struct NativeBrokerApp {
        broker: BrokerKernel<TrayIconBackend<NativeTrayIconRuntime>, NativeWebviewLoader>,
        sessions: HashMap<u64, unix_transport::TransportSession>,
        broker_version: String,
        idle_timeout: Option<Duration>,
        idle_generation: u64,
        webview: NativeWebviewRuntime,
        proxy: EventLoopProxy<UserEvent>,
        listener: Option<unix_transport::ListenerHandle>,
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
                UserEvent::Webview(message) => {
                    match self.webview.handle(event_loop, message.command) {
                        Ok(data) => self.write_ext_event(&message.scope, data),
                        Err(error) => {
                            let error_message = error.to_string();
                            self.write_ext_event(
                                &message.scope,
                                json!({ "type": "error", "message": error_message }),
                            );
                        }
                    }
                }
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
            window_id: WindowId,
            event: WindowEvent,
        ) {
            if matches!(event, WindowEvent::CloseRequested)
                && self.webview.window_id() == Some(window_id)
            {
                self.webview.close();
            }
        }

        fn exiting(&mut self, _event_loop: &ActiveEventLoop) {
            if let Some(listener) = self.listener.take() {
                listener.shutdown();
            }
        }
    }

    impl NativeBrokerApp {
        fn handle_transport(&mut self, event: unix_transport::TransportEvent) {
            match event {
                unix_transport::TransportEvent::Connected { id, writer } => {
                    self.bump_idle_generation();
                    self.sessions.insert(
                        id,
                        unix_transport::TransportSession {
                            writer,
                            broker: BrokerSession::new(),
                        },
                    );
                }
                unix_transport::TransportEvent::Frame { id, frame } => {
                    let Some(session) = self.sessions.get_mut(&id) else {
                        return;
                    };
                    let frames =
                        self.broker
                            .handle_frame(&mut session.broker, frame, &self.broker_version);
                    session.write_frames(frames);
                }
                unix_transport::TransportEvent::Disconnected { id } => {
                    if let Some(mut session) = self.sessions.remove(&id) {
                        let _ = self.broker.close_session(&mut session.broker);
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

        fn write_ext_event(&mut self, scope: &ExtensionScope, data: Value) {
            let Some(tray_id) = &scope.tray_id else {
                return;
            };

            for session in self.sessions.values_mut() {
                session.write_frame(ServerFrame::ExtEvent {
                    surface_id: scope.surface_id.clone(),
                    tray_id: tray_id.clone(),
                    ext: scope.ext.clone(),
                    data: data.clone(),
                });
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

    #[derive(Clone)]
    struct NativeWebviewLoader {
        proxy: EventLoopProxy<UserEvent>,
    }

    impl ExtensionLoader for NativeWebviewLoader {
        fn load(
            &self,
            request: &ExtensionLoadRequest,
        ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
            if request.name != "webview" || request.path != "@opentray/ext-webview" {
                return Err(ExtensionError::Unsupported(format!(
                    "native webview loader only supports webview at @opentray/ext-webview, got {} at {}",
                    request.name, request.path
                )));
            }

            Ok(Box::new(NativeWebviewExtension {
                proxy: self.proxy.clone(),
            }))
        }
    }

    struct NativeWebviewExtension {
        proxy: EventLoopProxy<UserEvent>,
    }

    impl ExtensionInstance for NativeWebviewExtension {
        fn name(&self) -> &str {
            "webview"
        }

        fn command(
            &mut self,
            envelope: ExtensionEnvelope,
        ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
            let command = WebviewRuntimeCommand::from_data(&envelope.data)?;
            self.proxy
                .send_event(UserEvent::Webview(WebviewRuntimeMessage {
                    scope: envelope.scope,
                    command,
                }))
                .map_err(|_| {
                    ExtensionError::Rejected("native webview event loop is closed".into())
                })?;
            Ok(Vec::new())
        }

        fn lease_closed(
            &mut self,
            _lease_id: &str,
        ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
            self.proxy
                .send_event(UserEvent::Webview(WebviewRuntimeMessage {
                    scope: ExtensionScope {
                        surface_id: "lease-cleanup".into(),
                        tray_id: None,
                        ext: "webview".into(),
                    },
                    command: WebviewRuntimeCommand::Hide,
                }))
                .map_err(|_| {
                    ExtensionError::Rejected("native webview event loop is closed".into())
                })?;
            Ok(Vec::new())
        }
    }

    #[derive(Debug)]
    struct WebviewRuntimeMessage {
        scope: ExtensionScope,
        command: WebviewRuntimeCommand,
    }

    #[derive(Debug)]
    enum WebviewRuntimeCommand {
        Show {
            html: Option<String>,
            url: Option<String>,
            width: f64,
            height: f64,
        },
        Hide,
        Navigate {
            url: String,
        },
        Evaluate {
            js: String,
        },
        PostMessage {
            payload: Value,
        },
    }

    impl WebviewRuntimeCommand {
        fn from_data(data: &Value) -> Result<Self, ExtensionError> {
            let command_type = data
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| ExtensionError::Rejected("webview command requires type".into()))?;

            match command_type {
                "show" => Ok(Self::Show {
                    html: data
                        .get("html")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                    url: data
                        .get("url")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                    width: data.get("width").and_then(Value::as_f64).unwrap_or(420.0),
                    height: data.get("height").and_then(Value::as_f64).unwrap_or(260.0),
                }),
                "hide" => Ok(Self::Hide),
                "navigate" => Ok(Self::Navigate {
                    url: required_string(data, "url")?,
                }),
                "evaluate" => Ok(Self::Evaluate {
                    js: required_string(data, "js")?,
                }),
                "postMessage" => Ok(Self::PostMessage {
                    payload: data.get("payload").cloned().unwrap_or(Value::Null),
                }),
                other => Err(ExtensionError::Rejected(format!(
                    "unsupported webview command: {other}"
                ))),
            }
        }
    }

    fn required_string(data: &Value, key: &str) -> Result<String, ExtensionError> {
        data.get(key)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| ExtensionError::Rejected(format!("webview command requires {key}")))
    }

    #[derive(Default)]
    struct NativeWebviewRuntime {
        webview: Option<WebView>,
        window: Option<Window>,
    }

    impl NativeWebviewRuntime {
        fn handle(
            &mut self,
            event_loop: &ActiveEventLoop,
            command: WebviewRuntimeCommand,
        ) -> Result<Value, Box<dyn Error>> {
            match command {
                WebviewRuntimeCommand::Show {
                    html,
                    url,
                    width,
                    height,
                } => self.show(event_loop, html, url, width, height),
                WebviewRuntimeCommand::Hide => {
                    self.hide();
                    Ok(json!({ "type": "hidden" }))
                }
                WebviewRuntimeCommand::Navigate { url } => self.navigate(event_loop, url),
                WebviewRuntimeCommand::Evaluate { js } => {
                    self.ensure_window(event_loop, None, None, 420.0, 260.0)?;
                    if let Some(webview) = &self.webview {
                        webview.evaluate_script(&js)?;
                    }
                    println!("native webview evaluated script");
                    Ok(json!({ "type": "evaluated" }))
                }
                WebviewRuntimeCommand::PostMessage { payload } => {
                    self.ensure_window(event_loop, None, None, 420.0, 260.0)?;
                    if let Some(webview) = &self.webview {
                        let payload_json = serde_json::to_string(&payload)?;
                        webview.evaluate_script(&format!(
                            "window.dispatchEvent(new MessageEvent('message', {{ data: {payload_json} }}));"
                        ))?;
                    }
                    println!("native webview posted message");
                    Ok(json!({ "type": "message", "payload": payload }))
                }
            }
        }

        fn show(
            &mut self,
            event_loop: &ActiveEventLoop,
            html: Option<String>,
            url: Option<String>,
            width: f64,
            height: f64,
        ) -> Result<Value, Box<dyn Error>> {
            self.ensure_window(event_loop, html, url, width, height)?;
            self.focus();
            println!("native webview shown");
            Ok(json!({ "type": "shown" }))
        }

        fn navigate(
            &mut self,
            event_loop: &ActiveEventLoop,
            url: String,
        ) -> Result<Value, Box<dyn Error>> {
            self.ensure_window(event_loop, None, Some(url.clone()), 420.0, 260.0)?;
            if let Some(webview) = &self.webview {
                webview.load_url(&url)?;
            }
            self.focus();
            println!("native webview navigated: {url}");
            Ok(json!({ "type": "navigated", "url": url }))
        }

        fn hide(&self) {
            if let Some(window) = &self.window {
                window.set_visible(false);
                println!("native webview hidden");
            }
        }

        fn close(&mut self) {
            self.webview = None;
            self.window = None;
            println!("native webview closed");
        }

        fn window_id(&self) -> Option<WindowId> {
            self.window.as_ref().map(Window::id)
        }

        fn focus(&self) {
            if let Some(window) = &self.window {
                window.set_visible(true);
                window.focus_window();
            }
        }

        fn ensure_window(
            &mut self,
            event_loop: &ActiveEventLoop,
            html: Option<String>,
            url: Option<String>,
            width: f64,
            height: f64,
        ) -> Result<(), Box<dyn Error>> {
            if self.window.is_none() {
                let window = event_loop.create_window(
                    Window::default_attributes()
                        .with_title("OpenTray WebView")
                        .with_inner_size(LogicalSize::new(width.max(240.0), height.max(160.0)))
                        .with_visible(true),
                )?;
                let webview = build_webview(&window, html, url)?;
                self.webview = Some(webview);
                self.window = Some(window);
                println!("native webview created");
                return Ok(());
            }

            if let Some(window) = &self.window {
                let _ = window
                    .request_inner_size(LogicalSize::new(width.max(240.0), height.max(160.0)));
            }
            if let Some(webview) = &self.webview {
                if let Some(url) = url {
                    webview.load_url(&url)?;
                } else if let Some(html) = html {
                    webview.load_html(&html)?;
                }
            }
            Ok(())
        }
    }

    fn build_webview(
        window: &Window,
        html: Option<String>,
        url: Option<String>,
    ) -> Result<WebView, Box<dyn Error>> {
        let builder = WebViewBuilder::new();
        let builder = if let Some(url) = url {
            builder.with_url(url)
        } else {
            builder.with_html(html.unwrap_or_else(default_webview_html))
        };
        Ok(builder.build(window)?)
    }

    fn default_webview_html() -> String {
        r#"<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>OpenTray WebView</title></head>
  <body><main><h1>OpenTray WebView</h1><p>Native daemon runtime.</p></main></body>
</html>"#
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{parse_daemon_idle_timeout, DEFAULT_DAEMON_IDLE_TIMEOUT_MS};

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
}
