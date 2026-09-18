// Orthogonal intents (maintained 2026-09-18; original user request: win32
// notify must reuse the caller's registered tray icon channel —
// add-ext-notification design reference section 2, frozen O1=B ruling):
// 1. Project one scope-bound notify command onto the registered tray icon's
//    Shell_NotifyIcon NIF_INFO channel: no new window, no new identity atom,
//    the same (HWND, uID) registration law the vendored tray backend owns.
// 2. Fill the fixed UTF-16 balloon fields verbatim: the facade preflight has
//    already enforced the frozen 64/256/64 common-subset boundary and joined
//    the win32 subtitle into the body, so at-boundary values pass through
//    with no re-truncation (design section 1 payload freeze).
// 3. Surface typed rejections with the family's error-code contract:
//    `notification_tray_absent` when the scope has no registered icon
//    channel and `notification_failed` (details carrying the win32 error
//    code) when the native call returns FALSE.
// 4. Keep every native dependency behind two injectable seams (channel
//    source + notify-icon invoker) so the bridge is fully testable on any
//    host and the win32 production adapters are thin, auditable shells.
// 5. Reach the backend runtime through a typed, downcast-free side channel:
//    one Arc<NativeTrayIconRuntime> handle registered at broker construction
//    is shared between the kernel's TrayIconBackend and the channel source —
//    never a notification-specific method on the AppBackend trait.
// Compromise: the bridge is broker composition (design law:
// opentray-core stays product-neutral), so it cannot live beside the kernel
// dispatch it bypasses; the neutral mirror of NOTIFYICONDATAW's NIF_INFO
// projection is the price of darwin-runnable seam tests.

use opentray_spec::CommandScope;
use serde_json::Value;

use crate::host_capabilities::{HostCapabilityDispatch, HostCapabilityOutcome};

/// Frozen payload boundary (design section 1): NOTIFYICONDATAW's physical
/// szInfoTitle/szInfo capacities are the platform-independent contract, and
/// the facade preflight has already truncated-at-boundary before the bridge
/// sees the values.
pub(crate) const TITLE_CAPACITY_UTF16: usize = 64;
pub(crate) const BODY_CAPACITY_UTF16: usize = 256;

/// NOTIFYICONDATAW projection constants (winuser.h frozen values): only the
/// NIF_INFO flag family is used; the deprecated uTimeout/uVersion balloon
/// timing members stay zero because presentation timing is system policy.
#[cfg(target_os = "windows")]
pub(crate) const NIM_MODIFY: u32 = 0x1;
pub(crate) const NIF_INFO: u32 = 0x10;
pub(crate) const NIIF_NOSOUND: u32 = 0x2;

/// Typed error codes frozen by the add-ext-notification shared schema
/// (`NOTIFICATION_ERROR_CODES` in @opentray/spec).
const NOTIFICATION_PAYLOAD_INVALID: &str = "notification_payload_invalid";
const NOTIFICATION_TRAY_ABSENT: &str = "notification_tray_absent";
const NOTIFICATION_FAILED: &str = "notification_failed";

/// The shell registration identity of one tray icon: the same (HWND, uID)
/// pair the tray backend used at NIM_ADD. Reusing any other pair would
/// fabricate a second icon channel, which the frozen design forbids.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TrayIconChannel {
    pub hwnd: isize,
    pub u_id: u32,
}

/// Neutral mirror of the NOTIFYICONDATAW fields the NIF_INFO projection
/// sets. Fixed arrays carry the verbatim UTF-16 payloads so at-boundary
/// values are observable byte-for-byte in seam tests on any host; the win32
/// production invoker copies them into the real struct unchanged.
///
/// NUL law: the terminating NUL is written only when a slot remains — a
/// value at the exact frozen boundary fills its array completely (design
/// section 5: "UTF-16 boundary values fill exactly without overflow").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct TrayNotifyIconData {
    pub hwnd: isize,
    pub u_id: u32,
    /// `uFlags`: always NIF_INFO for this bridge.
    pub u_flags: u32,
    pub sz_info_title: [u16; TITLE_CAPACITY_UTF16],
    pub title_len: usize,
    pub sz_info: [u16; BODY_CAPACITY_UTF16],
    pub info_len: usize,
    /// `dwInfoFlags`: NIIF_NOSOUND when silent, zero otherwise. Quiet-time
    /// and large-icon flags are deliberately absent — presentation policy
    /// belongs to the shell (documented degradation, design section 2).
    pub dw_info_flags: u32,
}

/// Injectable tray-registry lookup: resolves the native registration channel
/// of the tray icon bound to one command scope. The scope is the broker-
/// injected host truth; implementations key on (appId, trayId) under the
/// owning sessionId so a foreign session's icon is unreachable. `None` is
/// the typed `notification_tray_absent` path (missing or unregistered icon).
pub(crate) trait TrayNotificationChannelSource {
    fn channel_for(&self, scope: &CommandScope) -> Option<TrayIconChannel>;
}

/// Injectable Shell_NotifyIconW-shaped invoker: performs one NIM_MODIFY with
/// the NIF_INFO payload on the calling (owner-loop) thread. `Err(code)` is
/// the native win32 error code of a FALSE return.
pub(crate) trait NotifyIconInvoker {
    fn modify_info(&self, data: &TrayNotifyIconData) -> Result<(), u32>;
}

/// Scope→channel resolution core (host-neutral): the composition pre-dispatch
/// has already validated the kernel's LOGICAL tray registry for the scope, so
/// this projects the logical `(appId, trayId)` onto the tray backend's
/// projected tray-icon id (the projection compiler's neutral derivation) and
/// reads the native registration through the supplied lookup — the win32
/// production lookup is `NativeTrayIconRuntime::win32_tray_registration`.
/// `None` is the typed `notification_tray_absent` path (no live registered
/// icon for the projected pair).
#[cfg(any(target_os = "windows", test))]
fn resolve_tray_channel(
    scope: &CommandScope,
    registration: impl FnOnce(&opentray_spec::AppId, &str) -> Option<(isize, u32)>,
) -> Option<TrayIconChannel> {
    let tray_icon_id =
        opentray_backend_tray_icon::stable_tray_icon_id(&scope.app_id, &scope.tray_id);
    let (hwnd, u_id) = registration(&scope.app_id, &tray_icon_id)?;
    Some(TrayIconChannel { hwnd, u_id })
}

/// The bridge's composition-owned service pair.
pub(crate) struct TrayNotificationSeam {
    channels: Box<dyn TrayNotificationChannelSource>,
    invoker: Box<dyn NotifyIconInvoker>,
}

impl TrayNotificationSeam {
    /// Production seam per platform. Win32 wires the real Shell_NotifyIconW
    /// invoker plus the channel source that reads the shared tray-backend
    /// runtime handle registered at broker construction; other platforms
    /// register no routes, so their inert pair is never consulted.
    #[cfg(target_os = "windows")]
    pub(crate) fn compose_native(
        tray_runtime: std::sync::Arc<opentray_backend_tray_icon::NativeTrayIconRuntime>,
    ) -> Self {
        Self {
            channels: Box::new(NativeTrayChannelSource { tray_runtime }),
            invoker: Box::new(ShellNotifyIconInvoker),
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub(crate) fn compose_native() -> Self {
        Self {
            channels: Box::new(InertChannelSource),
            invoker: Box::new(InertInvoker),
        }
    }
}

/// The command payload the bridge consumes. The facade preflight has already
/// produced the final win32 title/body (subtitle joined into the body
/// prefix), so `subtitle` and any future darwin-only fields are not bridge
/// inputs; unknown fields are transport tolerance, not errors.
struct NotifyCommand<'a> {
    title: &'a str,
    body: Option<&'a str>,
    silent: bool,
}

fn payload_invalid(field: &str, reason: String) -> HostCapabilityOutcome {
    HostCapabilityOutcome::Failed {
        code: NOTIFICATION_PAYLOAD_INVALID.to_string(),
        message: reason,
        details: Some(serde_json::json!({ "field": field })),
    }
}

fn parse_notify_command(data: &Value) -> Result<NotifyCommand<'_>, HostCapabilityOutcome> {
    let title = match data.get("title") {
        Some(Value::String(title)) if !title.is_empty() => title.as_str(),
        Some(Value::String(_)) => {
            return Err(payload_invalid(
                "title",
                "notification title must be a non-empty string".to_string(),
            ));
        }
        Some(_) => {
            return Err(payload_invalid(
                "title",
                "notification title must be a string".to_string(),
            ));
        }
        None => {
            return Err(payload_invalid(
                "title",
                "notification requires a title".to_string(),
            ));
        }
    };
    let body = match data.get("body") {
        None | Some(Value::Null) => None,
        Some(Value::String(body)) => Some(body.as_str()),
        Some(_) => {
            return Err(payload_invalid(
                "body",
                "notification body must be a string".to_string(),
            ));
        }
    };
    let silent = match data.get("silent") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(silent)) => *silent,
        Some(_) => {
            return Err(payload_invalid(
                "silent",
                "notification silent flag must be a boolean".to_string(),
            ));
        }
    };
    Ok(NotifyCommand {
        title,
        body,
        silent,
    })
}

/// Copies UTF-16 code units verbatim into a fixed balloon field: all units
/// up to the array capacity, then a NUL only if a slot remains. Preflight
/// guarantees the frozen boundary, so conforming values never lose a unit;
/// the capacity clamp plus diagnostic only guards raw-protocol callers that
/// bypassed the facade (buffer safety, not re-truncation policy).
fn fill_balloon_field(
    field: &str,
    buffer: &mut [u16],
    value: &str,
) -> usize {
    let units: Vec<u16> = value.encode_utf16().collect();
    if units.len() > buffer.len() {
        eprintln!(
            "opentray tray-notification: {field} carries {} UTF-16 units beyond the frozen \
             {}-unit balloon capacity from a non-preflighted caller; clamping to capacity",
            units.len(),
            buffer.len(),
        );
    }
    let filled = units.len().min(buffer.len());
    buffer[..filled].copy_from_slice(&units[..filled]);
    if filled < buffer.len() {
        buffer[filled] = 0;
    }
    filled
}

/// Builds the NIF_INFO projection for one notify command against one
/// registered channel.
fn build_notify_icon_data(
    channel: TrayIconChannel,
    command: &NotifyCommand<'_>,
) -> TrayNotifyIconData {
    let mut data = TrayNotifyIconData {
        hwnd: channel.hwnd,
        u_id: channel.u_id,
        u_flags: NIF_INFO,
        sz_info_title: [0; TITLE_CAPACITY_UTF16],
        title_len: 0,
        sz_info: [0; BODY_CAPACITY_UTF16],
        info_len: 0,
        dw_info_flags: 0,
    };
    data.title_len = fill_balloon_field("title", &mut data.sz_info_title, command.title);
    // An absent body is the documented empty-string balloon, not an error.
    data.info_len = fill_balloon_field(
        "body",
        &mut data.sz_info,
        command.body.unwrap_or_default(),
    );
    if command.silent {
        data.dw_info_flags = NIIF_NOSOUND;
    }
    data
}

/// The frozen void-operation result event of the clipboard/dialog/sound
/// Immediate family: `{ "type": "result", "op": "notify" }`. The facade
/// consumes exactly this shape, so the bridge and the DLL are
/// indistinguishable on the wire.
fn notify_result_event() -> Value {
    serde_json::json!({ "type": "result", "op": "notify" })
}

/// The registered tray-notification bridge handler (host-capability table
/// entry for (notification, notify, win32)). Scope-bound channel resolution,
/// verbatim NIF_INFO projection, immediate typed completion.
pub(crate) fn tray_notification_bridge(
    dispatch: &HostCapabilityDispatch<'_>,
) -> HostCapabilityOutcome {
    let command = match parse_notify_command(dispatch.data) {
        Ok(command) => command,
        Err(outcome) => return outcome,
    };
    let Some(channel) = dispatch.tray_notification.channels.channel_for(&dispatch.scope) else {
        return HostCapabilityOutcome::Failed {
            code: NOTIFICATION_TRAY_ABSENT.to_string(),
            message: format!(
                "notification tray icon is not registered for app {} tray {} in session {}",
                dispatch.scope.app_id, dispatch.scope.tray_id, dispatch.scope.session_id
            ),
            details: None,
        };
    };
    let projection = build_notify_icon_data(channel, &command);
    if let Err(win32_error_code) = dispatch.tray_notification.invoker.modify_info(&projection) {
        return HostCapabilityOutcome::Failed {
            code: NOTIFICATION_FAILED.to_string(),
            message: format!(
                "Shell_NotifyIconW(NIM_MODIFY, NIF_INFO) failed for the tray icon channel of \
                 app {} tray {}",
                dispatch.scope.app_id, dispatch.scope.tray_id
            ),
            details: Some(serde_json::json!({ "win32ErrorCode": win32_error_code })),
        };
    }
    HostCapabilityOutcome::Immediate(notify_result_event())
}

// ---------------------------------------------------------------------------
// Non-win32 inert seam: platforms without a registered route never consult
// the service pair. The inert answers are the typed absent/failure paths,
// not panics — a broker never crashes on a routing-table regression.
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "windows"))]
struct InertChannelSource;

#[cfg(not(target_os = "windows"))]
impl TrayNotificationChannelSource for InertChannelSource {
    fn channel_for(&self, _scope: &CommandScope) -> Option<TrayIconChannel> {
        eprintln!(
            "opentray tray-notification: channel source consulted on a platform with no \
             registered route; answering the typed absent path"
        );
        None
    }
}

#[cfg(not(target_os = "windows"))]
struct InertInvoker;

#[cfg(not(target_os = "windows"))]
impl NotifyIconInvoker for InertInvoker {
    fn modify_info(&self, _data: &TrayNotifyIconData) -> Result<(), u32> {
        eprintln!(
            "opentray tray-notification: notify-icon invoker consulted on a platform with no \
             registered route; answering the typed failure path"
        );
        Err(0)
    }
}

// ---------------------------------------------------------------------------
// Win32 production adapters.
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
mod native {
    use super::{
        NotifyIconInvoker, TrayNotificationChannelSource, TrayIconChannel, TrayNotifyIconData,
        resolve_tray_channel, NIF_INFO, NIM_MODIFY,
    };
    use opentray_spec::CommandScope;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::UI::Shell::{Shell_NotifyIconW, NOTIFYICONDATAW};

    /// Real Shell_NotifyIconW adapter: one NIM_MODIFY carrying only the
    /// NIF_INFO family, on the calling owner-loop thread (the same thread
    /// law as tray registration). The deprecated uTimeout/uVersion members
    /// stay zeroed — presentation timing is system policy.
    pub(super) struct ShellNotifyIconInvoker;

    impl NotifyIconInvoker for ShellNotifyIconInvoker {
        fn modify_info(&self, data: &TrayNotifyIconData) -> Result<(), u32> {
            debug_assert_eq!(data.u_flags, NIF_INFO);
            let mut native: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
            native.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
            native.hWnd = data.hwnd as _;
            native.uID = data.u_id;
            native.uFlags = data.u_flags;
            native.szInfo = data.sz_info;
            native.szInfoTitle = data.sz_info_title;
            native.dwInfoFlags = data.dw_info_flags;
            // SAFETY: `native` is a fully initialized stack value whose
            // pointers are null; Shell_NotifyIconW reads it synchronously.
            let succeeded = unsafe { Shell_NotifyIconW(NIM_MODIFY, &native) };
            if succeeded != 0 {
                Ok(())
            } else {
                Err(unsafe { GetLastError() })
            }
        }
    }

    /// Production win32 channel source: resolves the scope's tray icon through
    /// the shared tray-backend runtime handle registered at broker
    /// construction (a typed, downcast-free side-channel — composition
    /// addressing only, never a notification-specific method on `AppBackend`).
    /// The composition pre-dispatch has already validated the kernel's logical
    /// tray registry and session ownership, so this projects the logical
    /// `(appId, trayId)` onto the backend's projected tray-icon id and reads
    /// the live `(HWND, uID)` registration. `None` keeps the typed
    /// `notification_tray_absent` path for genuinely missing icons — this
    /// source never fabricates a channel or a second icon registration.
    pub(super) struct NativeTrayChannelSource {
        pub(super) tray_runtime: std::sync::Arc<opentray_backend_tray_icon::NativeTrayIconRuntime>,
    }
    impl TrayNotificationChannelSource for NativeTrayChannelSource {
        fn channel_for(&self, scope: &CommandScope) -> Option<TrayIconChannel> {
            resolve_tray_channel(scope, |app_id, tray_icon_id| {
                self.tray_runtime
                    .win32_tray_registration(app_id, tray_icon_id)
            })
        }
    }
}

#[cfg(target_os = "windows")]
use native::{NativeTrayChannelSource, ShellNotifyIconInvoker};

// ---------------------------------------------------------------------------
// Darwin-runnable seam tests: routing selection, scope binding, typed
// paths, and verbatim at-boundary balloon fills are host-independent facts.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use opentray_core::{
        AppBackend, AppProjection, BackendCapabilities, BackendError, BrokerKernel, TrayProjection,
    };
    use opentray_spec::{
        AppOptions, AppRef, BrokerArtifactIdentity, BrokerArtifactTarget, ClientFrame, Icon, Rect,
        ServerFrame, TrayEvent, PROTOCOL_VERSION,
    };

    use super::*;
    use crate::host_capabilities::{
        compose_host_capability_frames, current_host_platform, resolve_host_capability,
        HostPlatform, HostServices,
    };

    /// Channel registry keyed by the full scope identity: the (appId, trayId)
    /// pair under its owning sessionId. A wrong app, tray, or session cannot
    /// resolve a channel — cross-app/session icons are unreachable by
    /// construction. Shared handles survive boxing into the seam so tests
    /// keep observing resolutions and their absence.
    #[derive(Clone, Default)]
    struct SpyChannels {
        entries: Arc<Mutex<HashMap<(String, String, String), TrayIconChannel>>>,
        seen: Arc<Mutex<Vec<CommandScope>>>,
    }

    impl SpyChannels {
        fn register(&self, scope: &CommandScope, channel: TrayIconChannel) {
            self.entries
                .lock()
                .expect("spy channels lock")
                .insert(scope_key(scope), channel);
        }

        fn seen_count(&self) -> usize {
            self.seen.lock().expect("spy channels lock").len()
        }
    }

    impl TrayNotificationChannelSource for SpyChannels {
        fn channel_for(&self, scope: &CommandScope) -> Option<TrayIconChannel> {
            self.seen
                .lock()
                .expect("spy channels lock")
                .push(scope.clone());
            self.entries
                .lock()
                .expect("spy channels lock")
                .get(&scope_key(scope))
                .copied()
        }
    }

    fn scope_key(scope: &CommandScope) -> (String, String, String) {
        (
            scope.app_id.clone(),
            scope.tray_id.clone(),
            scope.session_id.clone(),
        )
    }

    #[derive(Clone)]
    struct SpyInvoker {
        calls: Arc<Mutex<Vec<TrayNotifyIconData>>>,
        result: Arc<Result<(), u32>>,
    }

    impl Default for SpyInvoker {
        fn default() -> Self {
            Self {
                calls: Arc::default(),
                result: Arc::new(Ok(())),
            }
        }
    }

    impl SpyInvoker {
        fn failing(code: u32) -> Self {
            Self {
                result: Arc::new(Err(code)),
                ..Self::default()
            }
        }
    }

    impl NotifyIconInvoker for SpyInvoker {
        fn modify_info(&self, data: &TrayNotifyIconData) -> Result<(), u32> {
            self.calls.lock().expect("spy invoker lock").push(*data);
            *self.result
        }
    }

    fn seam(channels: SpyChannels, invoker: SpyInvoker) -> TrayNotificationSeam {
        TrayNotificationSeam {
            channels: Box::new(channels),
            invoker: Box::new(invoker),
        }
    }

    fn scope(app_id: &str, tray_id: &str, session_id: &str) -> CommandScope {
        CommandScope {
            app_id: app_id.to_string(),
            tray_id: tray_id.to_string(),
            session_id: session_id.to_string(),
            instance_generation: 0,
        }
    }

    fn dispatch<'a>(
        command_scope: CommandScope,
        data: &'a Value,
        service: &'a TrayNotificationSeam,
    ) -> HostCapabilityDispatch<'a> {
        HostCapabilityDispatch {
            scope: command_scope,
            data,
            tray_notification: service,
        }
    }

    fn notify_payload(title: &str, body: Option<&str>, silent: bool) -> Value {
        let mut payload = serde_json::json!({ "type": "notify", "title": title });
        if let Some(body) = body {
            payload["body"] = serde_json::json!(body);
        }
        if silent {
            payload["silent"] = serde_json::json!(true);
        }
        payload
    }

    const CHANNEL: TrayIconChannel = TrayIconChannel {
        hwnd: 0x1234,
        u_id: 7,
    };

    // -- Routing table selection -------------------------------------------

    #[test]
    fn routing_selects_the_bridge_only_for_notification_notify_win32() {
        assert!(resolve_host_capability("notification", "notify", HostPlatform::Win32).is_some());
        // Non-notify notification commands never route: getBackend and the
        // authorization pair flow to the extension DLL like every other
        // capability word.
        for command in [
            "getBackend",
            "getAuthorizationStatus",
            "requestAuthorization",
            "notifyExtra",
            "",
        ] {
            assert!(
                resolve_host_capability("notification", command, HostPlatform::Win32).is_none(),
                "(notification, {command}, win32) must not route to the bridge"
            );
        }
        // darwin (and linux) have no entry: notify flows to the DLL normally.
        for platform in [HostPlatform::Darwin, HostPlatform::Linux] {
            assert!(
                resolve_host_capability("notification", "notify", platform).is_none(),
                "(notification, notify, {platform:?}) must not route to the bridge"
            );
        }
        // Other capability words never route regardless of command shape.
        for capability in ["clipboard", "dialog", "sound", "opener", "webview"] {
            assert!(
                resolve_host_capability(capability, "notify", HostPlatform::Win32).is_none(),
                "({capability}, notify, win32) must not route to the bridge"
            );
        }
        // The host platform of this test binary selects exactly per table.
        assert_eq!(
            resolve_host_capability("notification", "notify", current_host_platform()).is_some(),
            cfg!(target_os = "windows"),
        );
    }

    // -- Payload parsing ----------------------------------------------------

    #[test]
    fn malformed_notify_payloads_reject_typed_payload_invalid() {
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", "session-1"), CHANNEL);
        let service = seam(channels, SpyInvoker::default());
        for (payload, expected_field) in [
            (serde_json::json!({ "type": "notify" }), "title"),
            (serde_json::json!({ "type": "notify", "title": "" }), "title"),
            (serde_json::json!({ "type": "notify", "title": 7 }), "title"),
            (
                serde_json::json!({ "type": "notify", "title": "t", "body": 7 }),
                "body",
            ),
            (
                serde_json::json!({ "type": "notify", "title": "t", "silent": "yes" }),
                "silent",
            ),
        ] {
            let outcome = tray_notification_bridge(&dispatch(
                scope("app-1", "tray-1", "session-1"),
                &payload,
                &service,
            ));
            let HostCapabilityOutcome::Failed { code, details, .. } = outcome else {
                panic!("payload {payload} must reject typed");
            };
            assert_eq!(code, NOTIFICATION_PAYLOAD_INVALID, "payload {payload}");
            assert_eq!(
                details,
                Some(serde_json::json!({ "field": expected_field })),
                "payload {payload}"
            );
        }
    }

    #[test]
    fn notify_payload_tolerates_foreign_projection_fields() {
        // The darwin subtitle projection and unknown fields are not bridge
        // inputs: the win32 facade preflight already joined the subtitle into
        // the body, and strict preflight validation belongs to the facade.
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", "session-1"), CHANNEL);
        let service = seam(channels, SpyInvoker::default());
        let payload = serde_json::json!({
            "type": "notify",
            "title": "Joined already",
            "body": "subtitle — body",
            "silent": false,
            "subtitle": "ignored by the win32 projection",
        });
        let outcome = tray_notification_bridge(&dispatch(
            scope("app-1", "tray-1", "session-1"),
            &payload,
            &service,
        ));
        assert!(matches!(outcome, HostCapabilityOutcome::Immediate(_)));
    }

    // -- Scope-bound channel resolution -------------------------------------

    #[test]
    fn channel_resolution_is_scope_bound() {
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", "session-1"), CHANNEL);
        let service = seam(channels, SpyInvoker::default());

        // Matching scope resolves and delivers the exact channel.
        let outcome = tray_notification_bridge(&dispatch(
            scope("app-1", "tray-1", "session-1"),
            &notify_payload("Hello", Some("World"), false),
            &service,
        ));
        assert!(matches!(outcome, HostCapabilityOutcome::Immediate(_)));

        // Wrong app, wrong tray, wrong session: unreachable icon.
        for foreign in [
            scope("app-2", "tray-1", "session-1"),
            scope("app-1", "tray-2", "session-1"),
            scope("app-1", "tray-1", "session-2"),
        ] {
            let outcome = tray_notification_bridge(&dispatch(
                foreign,
                &notify_payload("Hello", None, false),
                &service,
            ));
            let HostCapabilityOutcome::Failed { code, .. } = outcome else {
                panic!("foreign scope must not resolve a channel");
            };
            assert_eq!(code, NOTIFICATION_TRAY_ABSENT);
        }
    }

    // -- Scope→channel resolution core ----------------------------------------

    #[test]
    fn scope_to_channel_resolution_projects_the_logical_tray_onto_the_registration() {
        // Fake runtime registry keyed the way NativeTrayIconRuntime keys live
        // icons — (app_id, PROJECTED tray_icon_id) → (HWND, uID) — and built
        // from a real TrayIconProjection, so the test drives the exact
        // projection law the backend applies and proves the full
        // scope→channel path host-neutrally.
        let projection =
            opentray_backend_tray_icon::TrayIconProjection::from_app_projection(&AppProjection {
                app: AppRef {
                    app_id: "app-1".to_string(),
                },
                title: None,
                tooltip: None,
                app_icon: None,
                trays: vec![TrayProjection {
                    tray_id: "tray/1".to_string(),
                    title: "Tray".to_string(),
                    tooltip: None,
                    icon: Some(Icon::rgba(vec![0, 0, 0, 0], 1, 1)),
                    menu: None,
                }],
            })
            .expect("projection");
        let registrations: HashMap<(String, String), (isize, u32)> = projection
            .trays
            .iter()
            .map(|tray| {
                (
                    (projection.app_id.clone(), tray.tray_icon_id.clone()),
                    (CHANNEL.hwnd, CHANNEL.u_id),
                )
            })
            .collect();
        let lookup = |app_id: &opentray_spec::AppId, tray_icon_id: &str| {
            registrations
                .get(&(app_id.clone(), tray_icon_id.to_string()))
                .copied()
        };

        // Full path: logical scope → projected tray-icon id → registration.
        assert_eq!(
            resolve_tray_channel(&scope("app-1", "tray/1", "session-1"), lookup),
            Some(CHANNEL)
        );
        // A tray the runtime never registered answers the typed absent path:
        // wrong tray and wrong app cannot resolve a channel.
        assert_eq!(
            resolve_tray_channel(&scope("app-1", "tray-2", "session-1"), lookup),
            None
        );
        assert_eq!(
            resolve_tray_channel(&scope("app-2", "tray/1", "session-1"), lookup),
            None
        );
        // The registry is keyed by the PROJECTED id, so the raw logical tray
        // id never matches by accident — the projection derivation is on the
        // resolution path, not identity.
        assert!(!registrations.contains_key(&("app-1".to_string(), "tray/1".to_string())));
    }

    // -- Typed failure paths -------------------------------------------------

    #[test]
    fn absent_tray_icon_is_the_typed_tray_absent_path() {
        let service = seam(SpyChannels::default(), SpyInvoker::default());
        let outcome = tray_notification_bridge(&dispatch(
            scope("app-1", "tray-1", "session-1"),
            &notify_payload("Hello", None, false),
            &service,
        ));
        let HostCapabilityOutcome::Failed { code, message, details } = outcome else {
            panic!("unregistered scope must fail typed");
        };
        assert_eq!(code, NOTIFICATION_TRAY_ABSENT);
        assert!(message.contains("app-1") && message.contains("tray-1"));
        assert_eq!(details, None);
    }

    #[test]
    fn native_failure_carries_the_win32_error_code() {
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", "session-1"), CHANNEL);
        let service = seam(channels, SpyInvoker::failing(5));
        let outcome = tray_notification_bridge(&dispatch(
            scope("app-1", "tray-1", "session-1"),
            &notify_payload("Hello", None, false),
            &service,
        ));
        let HostCapabilityOutcome::Failed { code, details, .. } = outcome else {
            panic!("native FALSE must fail typed");
        };
        assert_eq!(code, NOTIFICATION_FAILED);
        assert_eq!(details, Some(serde_json::json!({ "win32ErrorCode": 5 })));
    }

    // -- NIF_INFO projection --------------------------------------------------

    #[test]
    fn success_projects_nif_info_with_verbatim_at_boundary_values() {
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", "session-1"), CHANNEL);
        let invoker = SpyInvoker::default();
        let service = seam(channels, invoker.clone());

        // Boundary values: a 64-unit title (astral-plane pairs) and a
        // 256-unit body fill their arrays exactly, verbatim, no NUL slot.
        let title: String = "𝕏".repeat(TITLE_CAPACITY_UTF16 / 2);
        let body: String = "b".repeat(BODY_CAPACITY_UTF16);
        assert_eq!(title.encode_utf16().count(), TITLE_CAPACITY_UTF16);
        assert_eq!(body.encode_utf16().count(), BODY_CAPACITY_UTF16);

        let outcome = tray_notification_bridge(&dispatch(
            scope("app-1", "tray-1", "session-1"),
            &notify_payload(&title, Some(&body), false),
            &service,
        ));

        let HostCapabilityOutcome::Immediate(event) = outcome else {
            panic!("accepted notify must complete immediately");
        };
        assert_eq!(event, serde_json::json!({ "type": "result", "op": "notify" }));
        let calls = invoker.calls.lock().expect("spy invoker lock");
        assert_eq!(calls.len(), 1);
        let data = &calls[0];
        assert_eq!(data.hwnd, CHANNEL.hwnd);
        assert_eq!(data.u_id, CHANNEL.u_id);
        assert_eq!(data.u_flags, NIF_INFO);
        assert_eq!(data.dw_info_flags, 0);
        // Title: exactly the 64 verbatim code units, array exactly full.
        assert_eq!(data.title_len, TITLE_CAPACITY_UTF16);
        assert_eq!(
            &data.sz_info_title[..data.title_len],
            &title.encode_utf16().collect::<Vec<u16>>()[..]
        );
        // Body: exactly the 256 verbatim code units, array exactly full.
        assert_eq!(data.info_len, BODY_CAPACITY_UTF16);
        assert_eq!(
            &data.sz_info[..data.info_len],
            &body.encode_utf16().collect::<Vec<u16>>()[..]
        );
        // A below-boundary value keeps the NUL terminator inside the array.
        drop(calls);
        let outcome = tray_notification_bridge(&dispatch(
            scope("app-1", "tray-1", "session-1"),
            &notify_payload("Short", Some("Body"), false),
            &service,
        ));
        assert!(matches!(outcome, HostCapabilityOutcome::Immediate(_)));
        let calls = invoker.calls.lock().expect("spy invoker lock");
        let data = &calls[1];
        assert_eq!(&data.sz_info_title[..5], &"Short".encode_utf16().collect::<Vec<u16>>());
        assert_eq!(data.sz_info_title[5], 0);
        assert_eq!(&data.sz_info[..4], &"Body".encode_utf16().collect::<Vec<u16>>());
        assert_eq!(data.sz_info[4], 0);
        assert_eq!(data.dw_info_flags, 0);
    }

    #[test]
    fn silent_projects_niif_nosound_and_absent_body_is_empty() {
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", "session-1"), CHANNEL);
        let invoker = SpyInvoker::default();
        let service = seam(channels, invoker.clone());

        let outcome = tray_notification_bridge(&dispatch(
            scope("app-1", "tray-1", "session-1"),
            &notify_payload("Silent", None, true),
            &service,
        ));
        assert!(matches!(outcome, HostCapabilityOutcome::Immediate(_)));
        let calls = invoker.calls.lock().expect("spy invoker lock");
        assert_eq!(calls.len(), 1);
        let data = &calls[0];
        assert_eq!(data.dw_info_flags, NIIF_NOSOUND);
        assert_eq!(data.info_len, 0);
        assert_eq!(data.sz_info[0], 0);
    }

    // -- Composition pre-dispatch ---------------------------------------------

    /// Minimal recording backend so tests drive the exact production
    /// `compose_host_capability_frames` against a real kernel.
    #[derive(Default)]
    struct StubBackend;

    impl AppBackend for StubBackend {
        fn capabilities(&self) -> BackendCapabilities {
            BackendCapabilities {
                tray_bounds: false,
                show_menu: false,
            }
        }
        fn sync_app(&self, _projection: AppProjection) -> Result<(), BackendError> {
            Ok(())
        }
        fn tray_bounds(
            &self,
            _app_id: &String,
            _tray_id: &String,
        ) -> Result<Option<Rect>, BackendError> {
            Ok(None)
        }
        fn show_menu(&self, _app_id: &String) -> Result<(), BackendError> {
            Ok(())
        }
        fn emit_event(&self, _event: TrayEvent) -> Result<(), BackendError> {
            Ok(())
        }
    }

    fn test_artifact_identity() -> BrokerArtifactIdentity {
        BrokerArtifactIdentity {
            package_version: "0.1.0".to_string(),
            target: BrokerArtifactTarget {
                os: "test".to_string(),
                arch: "test".to_string(),
            },
            executable_hash: "0".repeat(64),
            build_identity: "test-broker".to_string(),
        }
    }

    fn initialized_broker_with_tray()
    -> (BrokerKernel<StubBackend, opentray_core::UnsupportedExtensionLoader>, opentray_core::BrokerSession) {
        use opentray_spec::{Icon, TrayOptions};
        let mut broker = BrokerKernel::new(StubBackend, test_artifact_identity());
        let mut session = opentray_core::BrokerSession::new();
        let _ = broker.handle_frame(
            &mut session,
            ClientFrame::Init {
                protocol_version: PROTOCOL_VERSION,
                client_version: "test".to_string(),
            },
            "0.1.0",
        );
        let _ = broker.handle_frame(
            &mut session,
            ClientFrame::CreateApp {
                request_id: "req-app".to_string(),
                options: AppOptions {
                    id: Some("app-1".to_string()),
                    name: Some("App One".to_string()),
                    app_icon: None,
                    default: true,
                },
            },
            "0.1.0",
        );
        let _ = broker.handle_frame(
            &mut session,
            ClientFrame::CreateTray {
                request_id: "req-tray".to_string(),
                app: opentray_spec::AppRef {
                    app_id: "app-1".to_string(),
                },
                tray: TrayOptions {
                    id: "tray-1".to_string(),
                    tooltip: None,
                    icon: Some(Icon::rgba(vec![0, 0, 0, 0], 1, 1)),
                    menu: None,
                },
            },
            "0.1.0",
        );
        (broker, session)
    }

    fn ext_command_frame(data: Value) -> ClientFrame {
        ClientFrame::ExtCommand {
            request_id: "req-1".to_string(),
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            ext: "notification".to_string(),
            data,
        }
    }

    /// Test HostServices carrying spies whose shared handles stay observable
    /// after boxing, proving the pre-dispatch never consults the seam when no
    /// route matches (fall-through, session rejection, foreign platform).
    fn compose_services(session_id: &str) -> (HostServices, SpyChannels) {
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", session_id), CHANNEL);
        (
            HostServices::from_tray_notification(seam(channels.clone(), SpyInvoker::default())),
            channels,
        )
    }

    /// Services whose channel registry stays empty: models a session whose
    /// scope has no registered tray icon channel at all.
    fn compose_services_without_channels() -> HostServices {
        HostServices::from_tray_notification(seam(SpyChannels::default(), SpyInvoker::default()))
    }

    fn session_id_of(session: &opentray_core::BrokerSession) -> String {
        session.session_id().expect("initialized session").to_string()
    }

    #[test]
    fn compose_answers_win32_notify_immediately_in_family_frame_shape() {
        let (broker, session) = initialized_broker_with_tray();
        let (services, channels) = compose_services(&session_id_of(&session));
        let frames = compose_host_capability_frames(
            &broker,
            &session,
            &ext_command_frame(notify_payload("Title", Some("Body"), false)),
            &services,
            HostPlatform::Win32,
        )
        .expect("win32 notify routes to the bridge");
        assert_eq!(channels.seen_count(), 1);
        assert_eq!(frames.len(), 2);
        let ServerFrame::ExtCommandResult { request_id, events } = &frames[0] else {
            panic!("first frame must be the immediate result");
        };
        assert_eq!(request_id, "req-1");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].scope.app_id, "app-1");
        assert_eq!(events[0].scope.tray_id.as_deref(), Some("tray-1"));
        assert_eq!(events[0].scope.ext, "notification");
        assert_eq!(events[0].data, serde_json::json!({ "type": "result", "op": "notify" }));
        let ServerFrame::ExtEvent { app_id, tray_id, ext, data } = &frames[1] else {
            panic!("second frame must be the listener event");
        };
        assert_eq!(
            (app_id.as_str(), tray_id.as_str(), ext.as_str()),
            ("app-1", "tray-1", "notification")
        );
        assert_eq!(*data, serde_json::json!({ "type": "result", "op": "notify" }));
    }

    #[test]
    fn compose_falls_through_for_darwin_and_non_notify_commands() {
        let (broker, session) = initialized_broker_with_tray();
        let (services, channels) = compose_services(&session_id_of(&session));
        // darwin: notify flows to the DLL.
        assert!(
            compose_host_capability_frames(
                &broker,
                &session,
                &ext_command_frame(notify_payload("Title", None, false)),
                &services,
                HostPlatform::Darwin,
            )
            .is_none()
        );
        // win32 non-notify commands flow to the DLL.
        for payload in [
            serde_json::json!({ "type": "getBackend" }),
            serde_json::json!({ "type": "requestAuthorization" }),
        ] {
            assert!(
                compose_host_capability_frames(
                    &broker,
                    &session,
                    &ext_command_frame(payload.clone()),
                    &services,
                    HostPlatform::Win32,
                )
                .is_none(),
                "{payload} must fall through to the kernel"
            );
        }
        // Non-ExtCommand frames never participate.
        assert!(
            compose_host_capability_frames(
                &broker,
                &session,
                &ClientFrame::Health {
                    request_id: "req-h".to_string(),
                },
                &services,
                HostPlatform::Win32,
            )
            .is_none()
        );
        assert_eq!(channels.seen_count(), 0);
    }

    #[test]
    fn compose_rejects_foreign_sessions_with_the_kernel_parity_code() {
        let (mut broker, owner) = initialized_broker_with_tray();
        let mut foreign = opentray_core::BrokerSession::new();
        let _ = broker.handle_frame(
            &mut foreign,
            ClientFrame::Init {
                protocol_version: PROTOCOL_VERSION,
                client_version: "test".to_string(),
            },
            "0.1.0",
        );
        // The services registry only knows the OWNING session's channel.
        let (services, channels) = compose_services(&session_id_of(&owner));
        let frames = compose_host_capability_frames(
            &broker,
            &foreign,
            &ext_command_frame(notify_payload("Title", None, false)),
            &services,
            HostPlatform::Win32,
        )
        .expect("the route matched, so composition still answers");
        assert_eq!(frames.len(), 1);
        let ServerFrame::Error { code, .. } = &frames[0] else {
            panic!("foreign session must receive the typed authorization error");
        };
        assert_eq!(code, "session-mismatch");
        // The seam was never consulted for the rejected dispatch.
        assert_eq!(channels.seen_count(), 0);
    }

    #[test]
    fn compose_requires_an_initialized_session() {
        let (broker, _owner) = initialized_broker_with_tray();
        let uninitialized = opentray_core::BrokerSession::new();
        let (services, _channels) = compose_services("session-never");
        let frames = compose_host_capability_frames(
            &broker,
            &uninitialized,
            &ext_command_frame(notify_payload("Title", None, false)),
            &services,
            HostPlatform::Win32,
        )
        .expect("the route matched, so composition still answers");
        assert_eq!(frames.len(), 1);
        let ServerFrame::Error { code, .. } = &frames[0] else {
            panic!("uninitialized session must receive the not-initialized error");
        };
        assert_eq!(code, "not-initialized");
    }

    #[test]
    fn compose_routes_unregistered_trays_to_the_typed_absent_path() {
        // A session without any CreateTray: the kernel's logical registry has
        // no owner for (app-1, tray-1), so the bridge classifies the scope
        // as notification_tray_absent (design section 2 error mapping).
        let mut broker = BrokerKernel::new(StubBackend, test_artifact_identity());
        let mut session = opentray_core::BrokerSession::new();
        let _ = broker.handle_frame(
            &mut session,
            ClientFrame::Init {
                protocol_version: PROTOCOL_VERSION,
                client_version: "test".to_string(),
            },
            "0.1.0",
        );
        let services = compose_services_without_channels();
        let frames = compose_host_capability_frames(
            &broker,
            &session,
            &ext_command_frame(notify_payload("Title", None, false)),
            &services,
            HostPlatform::Win32,
        )
        .expect("the route matched, so composition still answers");
        assert_eq!(frames.len(), 1);
        let ServerFrame::Error { code, .. } = &frames[0] else {
            panic!("unregistered tray must receive the typed absent error");
        };
        assert_eq!(code, NOTIFICATION_TRAY_ABSENT);
    }

    // -- Product-neutrality gate ----------------------------------------------

    /// Design law (frozen O1=B ruling): opentray-core is the platform-neutral
    /// kernel/protocol layer and must contain no capability-word special
    /// casing. The bridge lives in broker composition only; if a future
    /// change ever drags the word into core, this gate fails the suite.
    #[test]
    fn opentray_core_contains_zero_notification_literals() {
        let core_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../opentray-core");
        let mut scanned = 0usize;
        let mut offender: Option<std::path::PathBuf> = None;
        let mut stack = vec![core_dir.join("src"), core_dir.join("Cargo.toml")];
        while let Some(path) = stack.pop() {
            if path.is_dir() {
                for entry in std::fs::read_dir(&path).expect("read core dir") {
                    stack.push(entry.expect("core dir entry").path());
                }
                continue;
            }
            let bytes = std::fs::read(&path).unwrap_or_default();
            scanned += 1;
            if bytes.windows(b"notification".len()).any(|w| w == b"notification") {
                offender = Some(path);
                break;
            }
        }
        assert!(scanned > 5, "expected to scan the core crate sources");
        assert_eq!(
            offender, None,
            "opentray-core must stay product-neutral: no 'notification' literals allowed"
        );
    }
}
