// Orthogonal intents (amended 2026-09-23; original user request: win32
// notify must ride the caller's registered tray app, delivery must be
// VISIBLE — add-ext-notification design reference section 2, O1=B ruling as
// amended below):
// 1. Scope binding still rides the registered tray icon: the bridge resolves
//    the scope's live (HWND, uID) registration first, so `notification_tray_absent`
//    and session/app ownership semantics are unchanged (the frozen O1=B
//    routing half).
// 2. DELIVERY is a WinRT toast posted under a per-app AUMID (the amended
//    O1=B delivery half). Real-machine Windows 11 evidence (2026-09-23,
//    build 26200): the legacy NIF_INFO balloon channel is untrustworthy —
//    `dwInfoFlags=NIIF_NONE` balloons are dropped silently, and after the
//    user opens the tray overflow flyout (the exact interaction required to
//    reach a tray menu) even `NIIF_INFO` balloons stop presenting while
//    `Shell_NotifyIconW` keeps returning TRUE. WinRT toasts with a
//    registered AUMID presented correctly in every probed state (fresh
//    boot, post-flyout, flyout-open). The AUMID is an attribution record in
//    HKCU — no new window, no second tray icon channel; the "no new
//    identity atom" wording of the original ruling is amended to permit
//    exactly this registry record.
// 3. Payload law unchanged: the facade preflight already enforced the frozen
//    64/256/64 common-subset boundary and joined the win32 subtitle into
//    the body; the bridge re-validates bounds (typed rejection, never
//    truncation) and projects title/body verbatim into toast XML.
// 4. Surface typed rejections with the family's error-code contract:
//    `notification_tray_absent` when the scope has no registered icon
//    channel and `notification_failed` (details carrying the failing
//    HRESULT) when the platform rejects the toast.
// 5. Keep every native dependency behind two injectable seams (channel
//    source + toast invoker) so the bridge is fully testable on any host
//    and the win32 production adapters are thin, auditable shells.
// 6. Reach the backend runtime through a typed, downcast-free side channel:
//    one Arc<NativeTrayIconRuntime> handle registered at broker construction
//    is shared between the kernel's TrayIconBackend and the channel source —
//    never a notification-specific method on the AppBackend trait.
// Compromise: the bridge is broker composition (design law:
// opentray-core stays product-neutral), so it cannot live beside the kernel
// dispatch it bypasses; the neutral toast projection (owned strings + XML
// builder) is the price of darwin-runnable seam tests.

use opentray_spec::CommandScope;
use serde_json::Value;

use crate::host_capabilities::{HostCapabilityDispatch, HostCapabilityOutcome};

/// Frozen payload boundary (design section 1): the physical capacities that
/// were NOTIFYICONDATAW's szInfoTitle/szInfo limits remain the
/// platform-independent contract, and the facade preflight has already
/// truncated-at-boundary before the bridge sees the values.
pub(crate) const TITLE_CAPACITY_UTF16: usize = 64;
pub(crate) const BODY_CAPACITY_UTF16: usize = 256;

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

/// Neutral mirror of the win32 toast projection: the AUMID the toast is
/// attributed to plus the verbatim title/body strings and the silent flag.
/// Owned strings keep at-boundary values observable byte-for-byte in seam
/// tests on any host; the win32 production invoker serializes them into
/// toast XML unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ToastNotificationData {
    /// Per-app AUMID the toast is posted under (derived from the command
    /// scope's app id; the win32 adapter registers its attribution record
    /// under HKCU before the first post).
    pub aumid: String,
    pub title: String,
    /// An absent body is the documented empty-body toast, not an error.
    pub body: String,
    pub silent: bool,
}

/// Injectable tray-registry lookup: resolves the native registration channel
/// of the tray icon bound to one command scope. The scope is the broker-
/// injected host truth; implementations key on (appId, trayId) under the
/// owning sessionId so a foreign session's icon is unreachable. `None` is
/// the typed `notification_tray_absent` path (missing or unregistered icon).
pub(crate) trait TrayNotificationChannelSource {
    fn channel_for(&self, scope: &CommandScope) -> Option<TrayIconChannel>;
}

/// Injectable WinRT-toast-shaped invoker: posts one toast under the AUMID on
/// a dedicated MTA worker thread (the same apartment law the ext-webview
/// WinRT calls established — never on a pump-blocking STA). `Err(hresult)`
/// is the failing HRESULT of the platform call.
pub(crate) trait ToastInvoker {
    fn show_toast(&self, data: &ToastNotificationData) -> Result<(), u32>;
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
    invoker: Box<dyn ToastInvoker>,
}

impl TrayNotificationSeam {
    /// Production seam per platform. Win32 wires the WinRT toast invoker plus
    /// the channel source that reads the shared tray-backend runtime handle
    /// registered at broker construction; other platforms register no routes,
    /// so their inert pair is never consulted.
    #[cfg(target_os = "windows")]
    pub(crate) fn compose_native(
        tray_runtime: std::sync::Arc<opentray_backend_tray_icon::NativeTrayIconRuntime>,
    ) -> Self {
        Self {
            channels: Box::new(NativeTrayChannelSource { tray_runtime }),
            invoker: Box::new(WinRtToastInvoker),
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

/// The frozen bounds-rejection details shape of the family
/// (`{field, lengthUtf16, limit}` — isomorphic with the facade preflight
/// and the DLL's defense-in-depth validator).
fn payload_invalid_bounds(field: &str, length_utf16: usize, limit: usize) -> HostCapabilityOutcome {
    HostCapabilityOutcome::Failed {
        code: NOTIFICATION_PAYLOAD_INVALID.to_string(),
        message: format!(
            "notification {field} carries {length_utf16} UTF-16 code units; the frozen \
             platform-independent limit is {limit} — rejected, never truncated"
        ),
        details: Some(serde_json::json!({
            "field": field,
            "lengthUtf16": length_utf16,
            "limit": limit,
        })),
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
    // The frozen UTF-16 bounds are enforced HERE too (implementation
    // review I3b P1): a raw-protocol caller that bypassed the facade
    // preflight gets the typed family rejection with zero native calls —
    // never a silent capacity clamp. The balloon capacities are the
    // physical NOTIFYICONDATAW limits and equal the frozen contract.
    let title_len = title.encode_utf16().count();
    if title_len > TITLE_CAPACITY_UTF16 {
        return Err(payload_invalid_bounds("title", title_len, TITLE_CAPACITY_UTF16));
    }
    if let Some(body) = body {
        let body_len = body.encode_utf16().count();
        if body_len > BODY_CAPACITY_UTF16 {
            return Err(payload_invalid_bounds("body", body_len, BODY_CAPACITY_UTF16));
        }
    }
    Ok(NotifyCommand {
        title,
        body,
        silent,
    })
}

/// XML-escapes one text node value for the toast payload (the win32
/// XmlDocument loader rejects raw markup, and a hostile title must never
/// inject toast schema — attribute-escaping rules also satisfy text nodes).
fn xml_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

/// Builds the toast XML for one projection: `ToastText02` (title + body) or
/// `ToastText01` (title only when the body is absent), with
/// `<audio silent="true"/>` for silent notifications.
fn toast_xml(data: &ToastNotificationData) -> String {
    let title = xml_escape(&data.title);
    let audio = if data.silent {
        "<audio silent=\"true\"/>"
    } else {
        ""
    };
    if data.body.is_empty() {
        format!(
            "<toast><visual><binding template=\"ToastText01\"><text id=\"1\">{title}</text></binding></visual>{audio}</toast>"
        )
    } else {
        let body = xml_escape(&data.body);
        format!(
            "<toast><visual><binding template=\"ToastText02\"><text id=\"1\">{title}</text><text id=\"2\">{body}</text></binding></visual>{audio}</toast>"
        )
    }
}

/// Derives the per-app AUMID from the command scope's app id: AUMIDs are
/// limited to 129 characters of `[A-Za-z0-9.\-_]`, so foreign characters are
/// folded to `-` and the value is truncated at the limit. The projection is
/// deterministic, so one app always toasts under the same identity.
pub(crate) fn toast_aumid(app_id: &str) -> String {
    let folded: String = app_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .take(129)
        .collect();
    if folded.is_empty() {
        "opentray.app".to_string()
    } else {
        folded
    }
}

/// Builds the toast projection for one notify command. The channel is the
/// scope's registration gate (live tray icon required); the AUMID carries
/// the app identity for attribution.
fn build_toast_data(
    _channel: TrayIconChannel,
    scope: &CommandScope,
    command: &NotifyCommand<'_>,
) -> ToastNotificationData {
    ToastNotificationData {
        aumid: toast_aumid(&scope.app_id),
        title: command.title.to_string(),
        // An absent body is the documented empty-body toast, not an error.
        body: command.body.unwrap_or_default().to_string(),
        silent: command.silent,
    }
}

/// The frozen void-operation result event of the clipboard/dialog/sound
/// Immediate family: `{ "type": "result", "op": "notify" }`. The facade
/// consumes exactly this shape, so the bridge and the DLL are
/// indistinguishable on the wire.
fn notify_result_event() -> Value {
    serde_json::json!({ "type": "result", "op": "notify" })
}

/// The registered tray-notification bridge handler (host-capability table
/// entry for (notification, notify, win32)). Scope-bound channel resolution
/// (the live-tray gate), verbatim toast projection, immediate typed
/// completion.
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
    let projection = build_toast_data(channel, &dispatch.scope, &command);
    if let Err(hresult) = dispatch.tray_notification.invoker.show_toast(&projection) {
        return HostCapabilityOutcome::Failed {
            code: NOTIFICATION_FAILED.to_string(),
            message: format!(
                "WinRT toast presentation failed for app {} tray {} under AUMID {}",
                dispatch.scope.app_id, dispatch.scope.tray_id, projection.aumid
            ),
            details: Some(serde_json::json!({ "hresult": hresult })),
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
impl ToastInvoker for InertInvoker {
    fn show_toast(&self, _data: &ToastNotificationData) -> Result<(), u32> {
        eprintln!(
            "opentray tray-notification: toast invoker consulted on a platform with no \
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
        ToastInvoker, ToastNotificationData, TrayNotificationChannelSource, TrayIconChannel,
        resolve_tray_channel, toast_xml,
    };
    use opentray_spec::CommandScope;

    /// Real WinRT toast adapter: a single long-lived worker thread owns the
    /// process's toast MTA and drains an mpsc queue, so the bridge thread
    /// only enqueues and returns immediately — no WinRT call, no join, no
    /// transport-deadline risk. The apartment is initialized exactly once
    /// and NEVER uninitialized: windows-core caches WinRT factory pointers
    /// in process-wide statics, and tearing down the apartment that created
    /// them leaves those caches dangling (the real-machine 0xC0000005 after
    /// an idle period, symbolized at IGenericFactory::ActivateInstance on
    /// the per-notify-thread design). `Err` is reserved for a closed worker
    /// channel (worker died); presentation failures are logged by the
    /// worker itself.
    pub(super) struct WinRtToastInvoker;

    impl ToastInvoker for WinRtToastInvoker {
        fn show_toast(&self, data: &ToastNotificationData) -> Result<(), u32> {
            toast_worker_sender()
                .send(data.clone())
                .map_err(|_| {
                    eprintln!(
                        "opentray tray-notification: toast worker channel is closed; dropping \
                         the notification"
                    );
                    0x8000FFFFu32 // E_UNEXPECTED: presentation can no longer happen
                })
        }
    }

    /// The process-wide toast worker handle (lazy, exactly one thread).
    fn toast_worker_sender() -> &'static std::sync::mpsc::Sender<ToastNotificationData> {
        use std::sync::OnceLock;
        static SENDER: OnceLock<std::sync::mpsc::Sender<ToastNotificationData>> = OnceLock::new();
        SENDER.get_or_init(|| {
            let (sender, receiver) = std::sync::mpsc::channel::<ToastNotificationData>();
            let spawned = std::thread::Builder::new()
                .name("opentray-toast".to_string())
                .spawn(move || toast_worker_loop(receiver));
            if let Err(error) = spawned {
                eprintln!(
                    "opentray tray-notification: toast worker could not start: {error}; the \
                     channel stays closed and every notify answers the typed failure"
                );
            }
            sender
        })
    }

    fn toast_worker_loop(receiver: std::sync::mpsc::Receiver<ToastNotificationData>) {
        use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
        // MTA for the whole process lifetime — see WinRtToastInvoker. A
        // worker that cannot get an apartment stays drained-but-inert so the
        // channel surfaces a clean typed failure instead of a crash.
        if let Err(error) = unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
            if error.code().0 as u32 != 0x80010106 {
                eprintln!(
                    "opentray tray-notification: toast worker apartment init failed: {error}"
                );
                return;
            }
        }
        while let Ok(data) = receiver.recv() {
            if let Err(error) = post_toast(&data) {
                eprintln!(
                    "opentray tray-notification: toast presentation failed for AUMID {}: {error}",
                    data.aumid
                );
            }
        }
    }

    /// Registers the per-app AUMID attribution record under
    /// HKCU\Software\Classes\AppUserModelId\<aumid> (DisplayName + Settings
    /// visibility) once per process per app. This is the standard unpackaged
    /// toast identity: no window, no tray icon, just attribution so the toast
    /// carries the app's name and the user can find it in notification
    /// settings. Failures are logged and non-fatal — Windows still presents
    /// toasts under unregistered AUMIDs on current builds, and a read-only
    /// profile must never break delivery.
    fn ensure_aumid_registration(aumid: &str, display_name: &str) {
        use std::collections::HashSet;
        use std::sync::Mutex;
        static REGISTERED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
        let mut guard = match REGISTERED.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let seen = guard.get_or_insert_with(HashSet::new);
        if seen.contains(aumid) {
            return;
        }
        if let Err(error) = write_aumid_record(aumid, display_name) {
            eprintln!(
                "opentray tray-notification: AUMID record for {aumid} could not be written \
                 ({error}); presenting the toast without the Settings attribution"
            );
        }
        seen.insert(aumid.to_string());
    }

    fn write_aumid_record(aumid: &str, display_name: &str) -> windows::core::Result<()> {
        use windows::core::PCWSTR;
        use windows::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
            KEY_WOW64_64KEY, REG_OPTION_NON_VOLATILE, REG_SZ,
        };
        let subkey: Vec<u16> = format!("Software\\Classes\\AppUserModelId\\{aumid}")
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut hkey: HKEY = HKEY(std::ptr::null_mut());
        let result = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE | KEY_WOW64_64KEY,
                None,
                &mut hkey,
                None,
            )
        };
        result.ok()?;
        let wide_name: Vec<u16> = "DisplayName".encode_utf16().chain(std::iter::once(0)).collect();
        let wide_value: Vec<u16> = display_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let bytes = unsafe {
            std::slice::from_raw_parts(wide_value.as_ptr().cast::<u8>(), wide_value.len() * 2)
        };
        let outcome = unsafe {
            RegSetValueExW(
                hkey,
                PCWSTR(wide_name.as_ptr()),
                None,
                REG_SZ,
                Some(bytes),
            )
        }
        .ok();
        unsafe { RegCloseKey(hkey) };
        outcome
    }

    /// One toast post on the long-lived worker thread (apartment already
    /// owned by the loop). Presentation failures surface as `Err` and are
    /// logged by the worker loop.
    fn post_toast(data: &ToastNotificationData) -> windows::core::Result<()> {
        use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

        // The display name is the raw app id (the bridge has no richer name
        // at this layer); the fold is deterministic and human-readable.
        ensure_aumid_registration(&data.aumid, &data.aumid);

        let xml = toast_xml(data);
        let document = windows::Data::Xml::Dom::XmlDocument::new()?;
        document.LoadXml(&windows::core::HSTRING::from(&xml))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(
            &windows::core::HSTRING::from(&data.aumid),
        )?;
        unsafe { notifier.Show(&toast)? };
        Ok(())
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
use native::{NativeTrayChannelSource, WinRtToastInvoker};

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
        calls: Arc<Mutex<Vec<ToastNotificationData>>>,
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

        fn call_count(&self) -> usize {
            self.calls.lock().expect("spy invoker lock").len()
        }
    }

    impl ToastInvoker for SpyInvoker {
        fn show_toast(&self, data: &ToastNotificationData) -> Result<(), u32> {
            self.calls.lock().expect("spy invoker lock").push(data.clone());
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
    fn over_limit_payloads_reject_typed_bounds_with_zero_native_calls() {
        // Implementation review I3b P1: the bridge enforces the frozen
        // UTF-16 bounds itself — a raw-protocol caller that bypassed the
        // facade preflight gets the typed family rejection with the exact
        // bounds details, and no native call happens (no channel
        // resolution, no Shell_NotifyIconW) — never a silent clamp.
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", "session-1"), CHANNEL);
        let invoker = SpyInvoker::default();
        let service = seam(channels.clone(), invoker.clone());
        for (payload, field, length, limit) in [
            (notify_payload(&"t".repeat(65), None, false), "title", 65, 64),
            (
                notify_payload("t", Some(&"b".repeat(257)), false),
                "body",
                257,
                256,
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
                Some(serde_json::json!({
                    "field": field,
                    "lengthUtf16": length,
                    "limit": limit,
                })),
                "payload {payload}"
            );
        }
        assert_eq!(invoker.call_count(), 0, "no native modify call");
        assert_eq!(channels.seen_count(), 0, "no channel resolution");
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
        assert_eq!(details, Some(serde_json::json!({ "hresult": 5 })));
    }

    // -- Toast projection -------------------------------------------------------

    #[test]
    fn success_projects_the_toast_with_verbatim_at_boundary_values() {
        let channels = SpyChannels::default();
        channels.register(&scope("app-1", "tray-1", "session-1"), CHANNEL);
        let invoker = SpyInvoker::default();
        let service = seam(channels, invoker.clone());

        // Boundary values: a 64-unit title (astral-plane pairs) and a
        // 256-unit body pass through verbatim — owned strings, no capacity.
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
        assert_eq!(data.title, title);
        assert_eq!(data.body, body);
        assert!(!data.silent);
        assert_eq!(data.aumid, "app-1");
        let xml = toast_xml(data);
        assert!(xml.contains("ToastText02"), "two-line template: {xml}");
        assert!(!xml.contains("<audio"), "non-silent carries no audio element: {xml}");
        drop(calls);

        // A below-boundary value stays verbatim too.
        let outcome = tray_notification_bridge(&dispatch(
            scope("app-1", "tray-1", "session-1"),
            &notify_payload("Short", Some("Body"), false),
            &service,
        ));
        assert!(matches!(outcome, HostCapabilityOutcome::Immediate(_)));
        let calls = invoker.calls.lock().expect("spy invoker lock");
        let data = &calls[1];
        assert_eq!(data.title, "Short");
        assert_eq!(data.body, "Body");
        assert_eq!(toast_xml(data), "<toast><visual><binding template=\"ToastText02\"><text id=\"1\">Short</text><text id=\"2\">Body</text></binding></visual></toast>");
    }

    #[test]
    fn toast_xml_escapes_markup_in_text_values() {
        let data = ToastNotificationData {
            aumid: "app-1".to_string(),
            title: "a<b>&\"c\"".to_string(),
            body: "<script>&'</script>".to_string(),
            silent: false,
        };
        let xml = toast_xml(&data);
        assert!(xml.contains("a&lt;b&gt;&amp;&quot;c&quot;"), "{xml}");
        assert!(xml.contains("&lt;script&gt;&amp;&apos;&lt;/script&gt;"), "{xml}");
        assert!(!xml.contains("<script>"), "raw markup must never reach the toast XML");
    }

    #[test]
    fn toast_aumid_folds_foreign_characters_and_caps_length() {
        assert_eq!(toast_aumid("com.example.opentray.notify-repro"), "com.example.opentray.notify-repro");
        assert_eq!(toast_aumid("app with spaces/and:colons"), "app-with-spaces-and-colons");
        assert_eq!(toast_aumid("").len(), "opentray.app".len());
        let long = "a".repeat(400);
        assert_eq!(toast_aumid(&long).len(), 129);
    }

    #[test]
    fn silent_projects_the_muted_audio_element_and_absent_body_uses_the_one_line_template() {
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
        assert!(data.silent);
        assert_eq!(data.body, "");
        let xml = toast_xml(data);
        assert!(xml.contains("ToastText01"), "absent body uses the one-line template: {xml}");
        assert!(xml.contains("<audio silent=\"true\"/>"), "{xml}");
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
    fn compose_routes_generated_mount_ids_after_the_acknowledged_load() {
        // Implementation review I3b P0: the ExtCommand wire carries the
        // MOUNT id (`notification.<trayId>.<ordinal>` for default mounts),
        // not the declared extension name. Only instances observed at
        // acknowledged load time route to the bridge; the answer still
        // carries the caller's mount id in its scopes.
        let (broker, session) = initialized_broker_with_tray();
        let (services, channels) = compose_services(&session_id_of(&session));
        services.note_extension_mount("app-1", "notification.tray-1.1", "notification");
        let mounted_frame = ClientFrame::ExtCommand {
            request_id: "req-1".to_string(),
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            ext: "notification.tray-1.1".to_string(),
            data: notify_payload("Title", Some("Body"), false),
        };
        let frames = compose_host_capability_frames(
            &broker,
            &session,
            &mounted_frame,
            &services,
            HostPlatform::Win32,
        )
        .expect("a generated mount id routes to the bridge after its acknowledged load");
        assert_eq!(channels.seen_count(), 1);
        let ServerFrame::ExtCommandResult { events, .. } = &frames[0] else {
            panic!("first frame must be the immediate result");
        };
        assert_eq!(events[0].scope.ext, "notification.tray-1.1");

        // An unobserved generated id (never loaded) falls through to the
        // kernel.
        let frame = ClientFrame::ExtCommand {
            request_id: "req-1".to_string(),
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            ext: "notification.tray-9.9".to_string(),
            data: notify_payload("Title", None, false),
        };
        assert!(
            compose_host_capability_frames(&broker, &session, &frame, &services, HostPlatform::Win32)
                .is_none(),
            "an unobserved mount id must fall through to the kernel"
        );
        // A foreign-declared mount observed at load time still never
        // routes (table-driven match, not name-prefix matching).
        services.note_extension_mount("app-1", "clipboard.tray-1.2", "clipboard");
        let frame = ClientFrame::ExtCommand {
            request_id: "req-1".to_string(),
            app_id: "app-1".to_string(),
            tray_id: "tray-1".to_string(),
            ext: "clipboard.tray-1.2".to_string(),
            data: notify_payload("Title", None, false),
        };
        assert!(
            compose_host_capability_frames(&broker, &session, &frame, &services, HostPlatform::Win32)
                .is_none(),
            "a non-capability declared name must never route"
        );
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
