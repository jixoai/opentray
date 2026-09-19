// Orthogonal intents (maintained 2026-07-21; original user requests: run the
// caller-owned tray broker and let a stable app-mode Dock entry relaunch the
// latest consumer invocation):
// 1. Parse and run the private broker command with artifact identity gates.
// 2. Run the Darwin no-broker carrier entry from a strict launch descriptor.
// 3. Compose native broker transport, tray backend, and dynamic extension host.
// 4. Preserve caller/session lifecycle, ready metadata, and idle shutdown.
// Compromise: this binary is the native composition root, so command entry and
// native event-loop ownership cannot be physically separated without adding a
// second shipped executable and breaking the shared carrier artifact contract.

#[cfg(target_os = "macos")]
mod darwin_reopen;
mod deferred_port;
mod dialog_poll;
mod dynamic_extension;
mod event_hub;
mod extension_events;
mod frame_error;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod host_capabilities;
#[cfg(any(target_os = "macos", target_os = "windows"))]
mod tray_notification;
#[cfg(unix)]
mod unix_transport;
#[cfg(target_os = "windows")]
mod windows_transport;

use std::{
    env,
    error::Error,
    path::PathBuf,
    time::Duration,
};
// Darwin carrier-entry imports (app launch descriptor, spawn, log append):
// windows/linux broker entrypoints never touch these, so they stay
// macos-gated and the windows cross-check stays warning-free.
#[cfg(target_os = "macos")]
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::Path,
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use opentray_spec::{
    sanitize_caller_label, AppOptions, BrokerArtifactIdentity, BrokerArtifactTarget,
    BrokerReadyMetadata, ClientFrame, DEFAULT_CALLER_LABEL, PROTOCOL_VERSION,
};
#[cfg(target_os = "macos")]
use serde::Deserialize;
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
            app_icon: None,
            default: true,
        }
    }
}

const DEFAULT_DAEMON_IDLE_TIMEOUT_MS: u64 = 30_000;
const DAEMON_IDLE_TIMEOUT_ENV: &str = "OPENTRAY_DAEMON_IDLE_TIMEOUT_MS";

fn main() -> Result<(), Box<dyn Error>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.first().map(String::as_str) == Some("broker") {
        return run_broker(parse_broker_options(args.into_iter().skip(1))?);
    }
    if is_app_launch_args(&args) {
        return run_app_entrypoint();
    }
    print_usage();
    Ok(())
}

fn is_app_launch_args(args: &[String]) -> bool {
    args.is_empty() || (args.len() == 1 && args[0].starts_with("-psn_"))
}

fn print_usage() {
    eprintln!("Usage: opentray broker --endpoint <path> --ready-file <path> --package-version <version> --protocol-version <version> --broker-executable-path <path> --broker-artifact-identity <json>");
}

#[cfg(target_os = "macos")]
fn run_app_entrypoint() -> Result<(), Box<dyn Error>> {
    // The stable .app is a carrier for the caller process. Its mutable launch
    // descriptor is intentionally separate from the immutable bundle manifest.
    let executable = env::current_exe()?.canonicalize()?;
    let descriptor_path = resolve_app_launch_descriptor_path(&executable)?;
    let log_path = resolve_app_launch_log_path(&descriptor_path)?;
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| {
            format!(
                "unable to open Darwin app launch log {}: {error}",
                log_path.display()
            )
        })?;
    append_app_launch_log(
        &mut log,
        "carrier-start",
        &descriptor_path,
        serde_json::json!({}),
    )?;
    let descriptor = match parse_app_launch_descriptor(&descriptor_path) {
        Ok(descriptor) => descriptor,
        Err(error) => {
            let _ = append_app_launch_log(
                &mut log,
                "launch-error",
                &descriptor_path,
                serde_json::json!({ "error": error.to_string() }),
            );
            return Err(error);
        }
    };
    append_app_launch_log(
        &mut log,
        "descriptor-read",
        &descriptor_path,
        serde_json::json!({ "command": descriptor.command, "cwd": descriptor.cwd }),
    )?;
    let stdout = log.try_clone()?;
    let stderr = log.try_clone()?;
    let child = match Command::new(&descriptor.command)
        .args(&descriptor.args)
        .current_dir(&descriptor.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let message = format!(
                "unable to launch consumer from Darwin app bundle {}: {error}",
                descriptor_path.display()
            );
            let _ = append_app_launch_log(
                &mut log,
                "launch-error",
                &descriptor_path,
                serde_json::json!({ "error": message }),
            );
            return Err(message.into());
        }
    };
    append_app_launch_log(
        &mut log,
        "consumer-spawned",
        &descriptor_path,
        serde_json::json!({ "pid": child.id() }),
    )?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn run_app_entrypoint() -> Result<(), Box<dyn Error>> {
    print_usage();
    Ok(())
}

#[cfg(target_os = "macos")]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AppLaunchDescriptor {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    command: String,
    args: Vec<String>,
    cwd: String,
}

#[cfg(target_os = "macos")]
fn resolve_app_launch_descriptor_path(executable: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let macos_dir = executable
        .parent()
        .ok_or("carrier executable has no parent directory")?;
    if macos_dir.file_name().and_then(|value| value.to_str()) != Some("MacOS") {
        return Err(format!(
            "carrier executable is not inside a Darwin .app bundle: {}",
            executable.display()
        )
        .into());
    }
    let contents_dir = macos_dir
        .parent()
        .ok_or("carrier executable is missing Contents directory")?;
    if contents_dir.file_name().and_then(|value| value.to_str()) != Some("Contents") {
        return Err(format!(
            "carrier executable is not inside a Darwin Contents directory: {}",
            executable.display()
        )
        .into());
    }
    let bundle_dir = contents_dir
        .parent()
        .ok_or("carrier executable is missing app bundle root")?;
    Ok(bundle_dir.join("Contents/Resources/opentray-launch.json"))
}

#[cfg(target_os = "macos")]
fn resolve_app_launch_log_path(descriptor: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let resources = descriptor
        .parent()
        .ok_or("app launch descriptor has no Resources directory")?;
    Ok(resources.join("opentray-launch.log"))
}

#[cfg(target_os = "macos")]
fn append_app_launch_log(
    log: &mut File,
    event: &str,
    descriptor: &Path,
    fields: serde_json::Value,
) -> Result<(), Box<dyn Error>> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut record = serde_json::Map::new();
    record.insert("timestamp".to_string(), serde_json::json!(timestamp));
    record.insert("event".to_string(), serde_json::json!(event));
    record.insert(
        "descriptorPath".to_string(),
        serde_json::json!(descriptor.to_string_lossy()),
    );
    if let Some(bundle_path) = descriptor
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
    {
        record.insert(
            "bundlePath".to_string(),
            serde_json::json!(bundle_path.to_string_lossy()),
        );
    }
    if let serde_json::Value::Object(fields) = fields {
        record.extend(fields);
    }
    writeln!(log, "{}", serde_json::Value::Object(record))?;
    log.flush()?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn parse_app_launch_descriptor(path: &Path) -> Result<AppLaunchDescriptor, Box<dyn Error>> {
    let raw = std::fs::read_to_string(path).map_err(|error| {
        format!(
            "unable to read Darwin app launch descriptor {}: {error}",
            path.display()
        )
    })?;
    let descriptor = serde_json::from_str::<AppLaunchDescriptor>(&raw).map_err(|error| {
        format!(
            "unable to parse Darwin app launch descriptor {}: {error}",
            path.display()
        )
    })?;
    if descriptor.schema_version != 1
        || descriptor.command.trim().is_empty()
        || descriptor.cwd.trim().is_empty()
        || descriptor.command.contains('\0')
        || descriptor.cwd.contains('\0')
        || descriptor.args.iter().any(|arg| arg.contains('\0'))
    {
        return Err(format!(
            "invalid Darwin app launch descriptor fields: {}",
            path.display()
        )
        .into());
    }
    Ok(descriptor)
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
    use std::{collections::HashMap, error::Error, sync::Arc, time::Duration, time::Instant};

    use opentray_backend_tray_icon::{NativeTrayIconRuntime, TrayIconBackend};
    use opentray_core::{BrokerKernel, BrokerSession};
    use opentray_core::operations::DeferredOperationRegistry;
    use opentray_spec::{
        ClientFrame, ExtensionEnvelope, ServerFrame, EXT_POLL_NO_DEADLINE_MS,
    };
    // The reopen-requested app event is a Darwin Dock-reopen projection.
    #[cfg(target_os = "macos")]
    use opentray_spec::AppEvent;
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
        broker_disconnect_action, broker_frame_action,
        deferred_port::{drain_deferred_terminals, DeferredPortHub},
        dialog_poll::PollScheduler,
        dynamic_extension::DynamicExtensionLoader,
        event_hub::{EventHub, RuntimeWake},
        extension_events::{
            drain_extension_events as drain_hub_events, ExtensionDispatch, ExtensionEventRouter,
            LoadedExtension,
        },
        host_capabilities::{
            compose_host_capability_frames, current_host_platform, HostServices,
        },
        BrokerDisconnectAction, BrokerOptions,
    };

    #[derive(Debug)]
    enum UserEvent {
        Transport(broker_transport::TransportEvent),
        Menu(tray_icon::menu::MenuEvent),
        Tray(tray_icon::TrayIconEvent),
        /// Coalesced EventPort drain request from the D19 hub wake adapter.
        ExtensionEventsReady,
        /// Coalesced deferred-terminal drain request from the DeferredPort
        /// hub wake adapter (add-ext-dialog design section 5.1).
        DeferredTerminalsReady,
        /// Merged dialog poll due (add-ext-dialog design section 5.2): the
        /// generation token drops stale events delivered after a scheduler
        /// revoke. Sent when a poll answer lowers the merged minimum
        /// deadline (the re-arm law: a loop already sleeping to a later
        /// instant must recompute its WaitUntil).
        DialogPollDue(u64),
        #[cfg(target_os = "macos")]
        AppReopenRequested,
        IdleExpired(u64),
    }

    /// Bounded delivery window for final outbound frames (the Exit ack) on
    /// the broker-exit path. Generous against a healthy drain (which
    /// completes in microseconds) while keeping the exit of a wedged
    /// session bounded.
    const EXIT_FLUSH_BUDGET: Duration = Duration::from_millis(250);

    /// Winit wake adapter: the owner loop is the winit user-event loop on
    /// macOS and Windows, so a drain request is one proxy user event. This
    /// is a host adapter; the C ABI never exposes the loop.
    struct ProxyWake(EventLoopProxy<UserEvent>);

    impl RuntimeWake for ProxyWake {
        fn wake(&self) -> bool {
            self.0.send_event(UserEvent::ExtensionEventsReady).is_ok()
        }
    }

    /// DeferredPort sibling of [`ProxyWake`]: terminal settlement requests
    /// get their own coalesced wake so poll/event drains stay separable.
    struct DeferredProxyWake(EventLoopProxy<UserEvent>);

    impl RuntimeWake for DeferredProxyWake {
        fn wake(&self) -> bool {
            self.0.send_event(UserEvent::DeferredTerminalsReady).is_ok()
        }
    }

    pub fn run(options: BrokerOptions) -> Result<(), Box<dyn Error>> {
        // harden-lifecycle-ownership: a tray broker with live sessions is
        // inherently user-facing, so the process asserts one lifetime activity
        // (UserInitiatedAllowingIdleSystemSleep) to stay out of App Nap's CPU
        // and timer throttling while keeping display sleep available.
        //
        // Correction (2026-09-15 root-cause round): the walkthrough symptom
        // ("buttons dead until I click the Dock icon") was NOT App Nap. The
        // broker answered socket probes instantly while the symptoms were
        // live, and the first walkthrough run with this assertion still
        // stalled. The actual defect was host-bound channel events riding
        // only the next command response (v1 flush ruling) -- idle sessions,
        // post-D19 with no 16 ms drain, never issued that command. The fix
        // pushes those events through the extension EventPort at the native
        // ipc handler; this assertion stays as defense-in-depth against CPU
        // throttling of a live-session broker.
        #[cfg(target_os = "macos")]
        {
            use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
            let activity = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
                NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
                &NSString::from_str("OpenTray broker serves live tray sessions"),
            );
            // The token must outlive the broker; dropping it would end the
            // activity and re-enable App Nap.
            std::mem::forget(activity);
        }

        let event_loop = build_event_loop()?;
        event_loop.set_control_flow(ControlFlow::Wait);

        #[cfg(target_os = "macos")]
        {
            let proxy = event_loop.create_proxy();
            super::darwin_reopen::install(move || {
                let _ = proxy.send_event(UserEvent::AppReopenRequested);
            })?;
        }

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

        let event_hub = EventHub::new(Box::new(ProxyWake(event_loop.create_proxy())));
        // One shared deferred-operation registry connects the kernel (which
        // issues operations at dispatch) with the deferred ports (whose
        // submits settle them) -- add-ext-dialog design section 5.1.
        let operations = Arc::new(DeferredOperationRegistry::new());
        let deferred_hub = DeferredPortHub::new(
            Box::new(DeferredProxyWake(event_loop.create_proxy())),
            operations.clone(),
        );

        // Typed side-channel registered at broker construction (win32
        // tray-notification channel addressing): one shared runtime handle is
        // cloned between the kernel's TrayIconBackend and the composition
        // HostServices, so the channel source reads live (HWND, uID)
        // registrations of the exact runtime the kernel projects through —
        // never a notification-specific method on the AppBackend trait. The
        // RefCell interior keeps the owner-loop-thread law: both holders live
        // on the winit owner loop, as before.
        let tray_runtime = Arc::new(NativeTrayIconRuntime::new());
        #[cfg(target_os = "windows")]
        let host_services = HostServices::new(tray_runtime.clone());
        #[cfg(not(target_os = "windows"))]
        let host_services = HostServices::new();

        let mut app = NativeBrokerApp {
            broker: BrokerKernel::with_default_app_options_and_operations(
                TrayIconBackend::with_runtime(tray_runtime.clone()),
                DynamicExtensionLoader::from_env(event_hub.clone(), deferred_hub.clone())?,
                options.default_app_options(),
                options.broker_artifact_identity().clone(),
                operations,
            ),
            extension_events: ExtensionEventRouter::new(),
            event_hub,
            deferred_hub,
            host_services,
            dialog_polls: PollScheduler::new(),
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
        broker:
            BrokerKernel<TrayIconBackend<Arc<NativeTrayIconRuntime>>, DynamicExtensionLoader>,
        extension_events: ExtensionEventRouter,
        event_hub: EventHub,
        deferred_hub: DeferredPortHub,
        /// Broker-composition host capabilities (add-ext-notification design
        /// section 2): the generic pre-dispatch route table's service pair,
        /// owned on the owner loop thread like the tray registration itself.
        host_services: HostServices,
        /// Broker-owned dialog poll scheduler (design section 5.2): merged
        /// DialogPollDue event, WaitUntil inputs, re-arm signaling, quota.
        /// Fed by the accepted-deferred-operation registration in the
        /// transport handler and the per-step re-arm in
        /// `process_dialog_polls` (batch B producer wiring).
        dialog_polls: PollScheduler,
        sessions: HashMap<u64, broker_transport::TransportSession>,
        broker_version: String,
        idle_timeout: Option<Duration>,
        idle_generation: u64,
        proxy: EventLoopProxy<UserEvent>,
        listener: Option<broker_transport::ListenerHandle>,
        options: BrokerOptions,
    }

    impl ApplicationHandler<UserEvent> for NativeBrokerApp {
        fn new_events(&mut self, event_loop: &ActiveEventLoop, cause: StartCause) {
            match cause {
                StartCause::Init => {
                    println!("opentray broker ready");
                    self.schedule_idle_if_empty();
                }
                // The merged WaitUntil(min deadline) fired: run one bounded
                // poll quantum (design section 5.2).
                StartCause::ResumeTimeReached { .. } => self.process_dialog_polls(),
                _ => {}
            }
            self.apply_dialog_poll_control_flow(event_loop);
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
                UserEvent::ExtensionEventsReady => self.drain_extension_events(),
                UserEvent::DeferredTerminalsReady => self.drain_deferred_terminals(None),
                UserEvent::DialogPollDue(generation) => {
                    // Stale tokens (pre-revoke events) drop without any poll.
                    if generation == self.dialog_polls.generation() {
                        self.process_dialog_polls();
                    }
                }
                #[cfg(target_os = "macos")]
                UserEvent::AppReopenRequested => self.dispatch_app_reopen_requested(),
                UserEvent::IdleExpired(generation) => {
                    if self.sessions.is_empty() && generation == self.idle_generation {
                        event_loop.exit();
                    }
                }
            }
            self.apply_dialog_poll_control_flow(event_loop);
        }

        fn window_event(
            &mut self,
            _event_loop: &ActiveEventLoop,
            _window_id: WindowId,
            _event: WindowEvent,
        ) {
        }

        fn exiting(&mut self, _event_loop: &ActiveEventLoop) {
            // Shutdown law: revoke every source and discard queued records
            // before the loop stops; there is no flush promise to keep.
            self.event_hub.revoke_all();
            self.event_hub.log_shutdown_diagnostics();
            self.deferred_hub.revoke_all();
            // Stale DialogPollDue events after this revoke drop on their
            // generation token.
            self.dialog_polls.revoke_all();
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
                            details: None,
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
                    // Pre-dispatch host-capability hook (add-ext-notification
                    // design section 2, frozen O1=B ruling): a generic
                    // composition-layer capability table may answer an
                    // ExtCommand envelope before kernel dispatch. Win32 routes
                    // (notification, notify) to the tray-notification bridge,
                    // which reuses the scope-bound registered tray icon's
                    // NIF_INFO channel; on darwin the table carries no entry,
                    // so every notification command reaches the extension
                    // DLL unchanged. A matched route answers with the same
                    // Immediate frame family (or a typed error frame) the
                    // kernel path produces, keeping facades
                    // transport-agnostic about who answered.
                    if let Some(frames) = compose_host_capability_frames(
                        &self.broker,
                        &session.broker,
                        &frame,
                        &self.host_services,
                        current_host_platform(),
                    ) {
                        session.write_frames(frames);
                        return BrokerDisconnectAction::WaitForIdle;
                    }
                    let session_was_initialized = session.broker.session_id().is_some();
                    let kernel_session_id = session.broker.session_id().map(ToOwned::to_owned);
                    let exit_action = broker_frame_action(&frame, session_was_initialized);
                    // Lifecycle law: the kernel's Exit dispatch runs session
                    // cleanup inline, so the closing session's EventPort
                    // sources must be revoked BEFORE dispatch -- its cleanup
                    // pushes then observe PORT_CLOSED instead of queueing
                    // across the close.
                    if matches!(exit_action, BrokerDisconnectAction::ExitOwnedBroker) {
                        if let Some(session_id) = kernel_session_id.as_deref() {
                            self.event_hub.revoke_session(session_id);
                            // Same lifecycle law for deferred terminals: the
                            // closing session's port submits observe
                            // PORT_CLOSED before core cleanup runs.
                            self.deferred_hub.revoke_session(session_id);
                        }
                    }
                    let loaded = LoadedExtension::from_frame(&frame);
                    // add-ext-dialog design section 5.2 (producer wiring):
                    // remember which (app, instance) this dispatch targets
                    // so accepted deferred operations below can register
                    // their first poll step.
                    let dispatched_ext = match &frame {
                        ClientFrame::ExtCommand { app_id, ext, .. } => {
                            Some((app_id.clone(), ext.clone()))
                        }
                        _ => None,
                    };
                    let mut extension_host = self
                        .extension_events
                        .host(ExtensionDispatch::from_frame(&frame), Some(&self.event_hub));
                    let frames = self.broker.handle_frame_with_extension_host(
                        &mut session.broker,
                        frame,
                        &self.broker_version,
                        &mut extension_host,
                    );
                    let load_acknowledged = matches!(frames.first(), Some(ServerFrame::Ack { .. }));
                    Self::register_dialog_polls(&mut self.dialog_polls, &dispatched_ext, &frames);
                    session.write_frames(frames);
                    if let (Some(loaded), Some(owner)) = (loaded, kernel_session_id.as_deref()) {
                        if load_acknowledged {
                            self.host_services.note_extension_mount(
                                &loaded.app_id,
                                &loaded.instance,
                                &loaded.declared_name,
                            );
                            self.extension_events
                                .note_loaded(loaded.clone(), owner.to_string());
                            // Only a successful LoadExt ACK opens the source
                            // reserved by the loader.
                            self.event_hub.note_loaded_and_open(
                                &loaded.app_id,
                                &loaded.instance,
                                owner,
                            );
                            // Same ACK gate for the deferred submit channel.
                            self.deferred_hub
                                .open_port(&loaded.app_id, &loaded.instance, owner);
                        }
                    }
                    if matches!(exit_action, BrokerDisconnectAction::ExitOwnedBroker) {
                        // The kernel already took the closing session's id
                        // inside the Exit dispatch; release its extension
                        // ownership before delivering cleanup pushes so they
                        // drop instead of surviving the close.
                        if let Some(session_id) = kernel_session_id.as_deref() {
                            self.extension_events.forget_session(session_id);
                        }
                    }
                    self.deliver_extension_events(extension_host.take_events());
                    // Post-response barrier: hub records submitted during the
                    // dispatch are delivered only after its response frames.
                    self.drain_extension_events();
                    // Windows named-pipe half-close may defer `Disconnected`
                    // indefinitely. `Exit` already performed kernel cleanup
                    // above, so the dedicated broker must leave its GUI event
                    // loop without waiting for that transport event.
                    //
                    // Close-ordering law (design section 5.7 ruling 7): the
                    // closing session's pending operations are purged BEFORE
                    // any deferred-terminal drain, so a terminal queued before
                    // the Exit settles as a diagnostic drop instead of being
                    // written into the closing socket.
                    let closing_session = if matches!(
                        exit_action,
                        BrokerDisconnectAction::ExitOwnedBroker
                    ) {
                        kernel_session_id.as_deref()
                    } else {
                        None
                    };
                    self.drain_deferred_terminals(closing_session);
                    if matches!(exit_action, BrokerDisconnectAction::ExitOwnedBroker) {
                        // Final-flush law: response frames (including the Exit
                        // ack) ride the bounded outbound queue since the
                        // owner-loop write discipline change, so the exit path
                        // gives the writer thread a bounded delivery window
                        // before tearing the process down — a healthy drain
                        // completes in microseconds, a wedged client is
                        // abandoned after the budget. Once-per-process wait on
                        // the owner loop.
                        if let Some(session) = self.sessions.get_mut(&id) {
                            session.flush_outbound(EXIT_FLUSH_BUDGET);
                        }
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
                        let closing_session_id = session.broker.session_id().map(ToOwned::to_owned);
                        // Lifecycle law: revoke BEFORE core session_closed so
                        // the closing session's cleanup pushes observe
                        // PORT_CLOSED and never cross the close.
                        if let Some(session_id) = closing_session_id.as_deref() {
                            self.event_hub.revoke_session(session_id);
                            self.deferred_hub.revoke_session(session_id);
                        }
                        let mut extension_host =
                            self.extension_events.host(None, Some(&self.event_hub));
                        let _ = self.broker.close_session_with_extension_host(
                            &mut session.broker,
                            &mut extension_host,
                        );
                        if let Some(session_id) = closing_session_id.as_deref() {
                            self.extension_events.forget_session(session_id);
                            // Purged before any deferred drain (design
                            // section 5.7 ruling 7): close delivers no
                            // terminal frames for the closing session.
                            self.broker.operations().purge_session(session_id);
                        }
                        self.deliver_extension_events(extension_host.take_events());
                        self.drain_extension_events();
                        self.drain_deferred_terminals(None);
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

        /// Delivers extension-pushed events to the owning client session's
        /// existing ordered frame channel. Delivery runs after the current
        /// kernel dispatch returned, so pushes always follow that dispatch's
        /// response frames and never reenter the kernel.
        fn deliver_extension_events(&mut self, events: Vec<ExtensionEnvelope>) {
            self.extension_events.deliver(events, &mut |owner, frame| {
                let mut delivered = false;
                for session in self.sessions.values_mut() {
                    if session.broker.session_id() == Some(owner) {
                        session.write_frame(frame.clone());
                        delivered = true;
                    }
                }
                delivered
            });
        }

        /// Bounded hub drain (one 64-record/128-KiB round-robin quantum) with
        /// source-bound route validation; re-wakes itself while drainable
        /// work remains. Runs on the owner loop only, after response frames.
        fn drain_extension_events(&mut self) {
            let Self {
                event_hub,
                extension_events,
                broker,
                sessions,
                ..
            } = self;
            drain_hub_events(event_hub, extension_events, broker, &mut |owner, frame| {
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

        /// Deferred-terminal drain: settles each queued terminal through the
        /// shared registry's one-shot CAS and writes the terminal frame to
        /// the still-matching session writer (add-ext-dialog design section
        /// 5.1). `closing_session` routes the Exit path through the purge-
        /// before-drain law (design section 5.7 ruling 7).
        fn drain_deferred_terminals(&mut self, closing_session: Option<&str>) {
            let Self {
                deferred_hub,
                broker,
                sessions,
                ..
            } = self;
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

        /// Schedules the first poll step for every deferred operation this
        /// frame batch accepted (add-ext-dialog design section 5.2, batch B
        /// producer wiring). Registration is producer-agnostic: the first
        /// step asks the instance, and its answer owns continuation — the
        /// macOS modal cadence keeps re-arming, a no-deadline answer
        /// (non-producer instance, or the win32 model whose completion
        /// lives on bounded STA workers, design section 5.3) retires the
        /// entry after one step. Deadline `now` = due on the next loop
        /// iteration; the post-event control-flow projection arms the
        /// WaitUntil wake.
        ///
        /// An associated function taking the scheduler directly: the call
        /// site sits inside the transport handler's live `session` borrow,
        /// and disjoint-field access (`dialog_polls` vs `sessions`) keeps
        /// the borrow checker honest without cloning frames.
        fn register_dialog_polls(
            scheduler: &mut PollScheduler,
            dispatched: &Option<(String, String)>,
            frames: &[ServerFrame],
        ) {
            let Some((app_id, ext)) = dispatched else {
                return;
            };
            for frame in frames {
                let ServerFrame::ExtCommandAccepted { operation_id, .. } = frame else {
                    continue;
                };
                let owner = dialog_poll_owner_key(app_id, ext, operation_id);
                scheduler.schedule(owner, Instant::now(), "deferred-accepted");
            }
        }

        /// One bounded dialog-poll quantum (design section 5.2): the
        /// scheduler's frozen quota caps this at four owners stepped once
        /// per iteration, and each producer's answer re-arms its own entry.
        /// Terminals never appear here — the deferred port is the single
        /// terminal channel and its hub wake (`DeferredTerminalsReady`)
        /// owns the drain after a natural completion.
        fn process_dialog_polls(&mut self) {
            let due = self.dialog_polls.take_due(Instant::now());
            for (owner, _wake_reason) in due {
                let Some((app_id, instance, operation_id)) = parse_dialog_poll_owner(&owner)
                else {
                    eprintln!("opentray dialog poll: dropping malformed owner key {owner:?}");
                    continue;
                };
                // The wire operation id is the 16-digit hex projection of
                // the FFI handle (operations registry law).
                let Ok(handle) = u64::from_str_radix(&operation_id, 16) else {
                    eprintln!(
                        "opentray dialog poll: owner {owner:?} carries a non-hex operation id; \
                         dropping the schedule entry"
                    );
                    continue;
                };
                // None: no live instance owns this name (unloaded) — the
                // entry dies here instead of stepping anything.
                let Some(next_ms) = self
                    .broker
                    .extensions_mut()
                    .poll_operation(&app_id, &instance, handle)
                else {
                    continue;
                };
                if next_ms == EXT_POLL_NO_DEADLINE_MS {
                    // The producer finished (or never needed stepping).
                    continue;
                }
                let Some(deadline) = Instant::now().checked_add(Duration::from_millis(next_ms))
                else {
                    // A producer answer beyond the Instant range would
                    // panic on add; treat it as nothing scheduled.
                    eprintln!(
                        "opentray dialog poll: owner {owner:?} reported an unrepresentable next \
                         deadline ({next_ms} ms); dropping the schedule entry"
                    );
                    continue;
                };
                if self.dialog_polls.schedule(owner, deadline, "modal-step") {
                    // The answer lowered the merged minimum: re-deliver the
                    // merged due event so a loop already sleeping to a
                    // later instant recomputes its WaitUntil (the
                    // section 5.2 re-arm law).
                    let generation = self.dialog_polls.generation();
                    let _ = self
                        .proxy
                        .send_event(UserEvent::DialogPollDue(generation));
                }
            }
        }

        /// Projects the merged minimum poll deadline into the loop's control
        /// flow: `WaitUntil(min deadline)` while any poll is scheduled,
        /// plain `Wait` otherwise (design section 5.2).
        fn apply_dialog_poll_control_flow(&self, event_loop: &ActiveEventLoop) {
            match self.dialog_polls.min_deadline() {
                Some(deadline) => event_loop.set_control_flow(ControlFlow::WaitUntil(deadline)),
                None => event_loop.set_control_flow(ControlFlow::Wait),
            }
        }

        #[cfg(target_os = "macos")]
        fn dispatch_app_reopen_requested(&mut self) {
            for session in self.sessions.values_mut() {
                let Some(app_id) = session
                    .broker
                    .app_identity()
                    .map(|identity| identity.app_id.clone())
                else {
                    continue;
                };
                eprintln!("opentray app reopen requested: app_id={app_id}");
                session.write_frame(ServerFrame::AppEvent {
                    event: AppEvent::ReopenRequested { app_id },
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

    /// Owner key of one scheduled dialog poll (design section 5.2): the
    /// accepted deferred operation's `(appId, instance, operationId)`
    /// triple in wire form. App ids may contain `/` themselves — the
    /// decoder splits from the right, so only the operation id and instance
    /// segments must be slash-free (extension names and the 16-digit hex
    /// operation ids always are).
    fn dialog_poll_owner_key(app_id: &str, instance: &str, operation_id: &str) -> String {
        format!("{app_id}/{instance}/{operation_id}")
    }

    /// Inverse of [`dialog_poll_owner_key`] (right-split; see its doc for
    /// the slash assumption).
    fn parse_dialog_poll_owner(owner: &str) -> Option<(String, String, String)> {
        let mut split = owner.rsplitn(3, '/');
        let operation_id = split.next()?;
        let instance = split.next()?;
        let app_id = split.next()?;
        if app_id.is_empty() || instance.is_empty() || operation_id.is_empty() {
            return None;
        }
        Some((
            app_id.to_string(),
            instance.to_string(),
            operation_id.to_string(),
        ))
    }

    #[cfg(test)]
    mod dialog_poll_owner_codec_tests {
        use super::{dialog_poll_owner_key, parse_dialog_poll_owner};

        #[test]
        fn owner_key_roundtrips_through_the_right_split() {
            let owner = dialog_poll_owner_key("app-1", "dialog", "000000000000000f");
            assert_eq!(owner, "app-1/dialog/000000000000000f");
            assert_eq!(
                parse_dialog_poll_owner(&owner),
                Some((
                    "app-1".to_string(),
                    "dialog".to_string(),
                    "000000000000000f".to_string()
                ))
            );
        }

        #[test]
        fn app_ids_may_contain_slashes() {
            let owner = dialog_poll_owner_key("dev/pkg-name", "dialog", "ffffffffffffffff");
            assert_eq!(
                parse_dialog_poll_owner(&owner),
                Some((
                    "dev/pkg-name".to_string(),
                    "dialog".to_string(),
                    "ffffffffffffffff".to_string()
                ))
            );
        }

        #[test]
        fn malformed_owner_keys_reject_instead_of_panicking() {
            for malformed in ["", "dialog/000000000000000f", "app-1//000000000000000f", "/"] {
                assert!(
                    parse_dialog_poll_owner(malformed).is_none(),
                    "{malformed:?} must not parse"
                );
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
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use std::path::Path;
    use std::time::Duration;

    use super::{
        broker_disconnect_action, broker_frame_action, is_app_launch_args, parse_broker_options,
        parse_daemon_idle_timeout, resolve_current_broker_artifact, BrokerDisconnectAction,
        DEFAULT_DAEMON_IDLE_TIMEOUT_MS,
    };
    #[cfg(target_os = "macos")]
    use super::{parse_app_launch_descriptor, resolve_app_launch_descriptor_path};
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

    #[test]
    fn app_launch_accepts_only_empty_or_launch_services_process_serial_number() {
        assert!(is_app_launch_args(&[]));
        assert!(is_app_launch_args(&["-psn_0_12345".to_string()]));
        assert!(!is_app_launch_args(&["--unexpected".to_string()]));
        assert!(!is_app_launch_args(&[
            "-psn_0_12345".to_string(),
            "extra".to_string()
        ]));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_launch_descriptor_path_is_relative_to_the_carrier_bundle() {
        let path = resolve_app_launch_descriptor_path(Path::new(
            "/tmp/Skill Creator.app/Contents/MacOS/opentray",
        ))
        .expect("descriptor path");
        assert_eq!(
            path,
            Path::new("/tmp/Skill Creator.app/Contents/Resources/opentray-launch.json")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn app_launch_descriptor_parser_rejects_unknown_fields() {
        let path = std::env::temp_dir().join(format!(
            "opentray-launch-descriptor-{}.json",
            std::process::id()
        ));
        std::fs::write(
            &path,
            r#"{"schemaVersion":1,"command":"/usr/bin/node","args":[],"cwd":"/tmp","env":{}}"#,
        )
        .expect("write descriptor");
        let error = parse_app_launch_descriptor(&path).expect_err("unknown fields must fail");
        std::fs::remove_file(&path).expect("remove descriptor");
        assert!(error.to_string().contains(path.to_string_lossy().as_ref()));
        assert!(error.to_string().contains("unknown field"));
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
            "2",
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
