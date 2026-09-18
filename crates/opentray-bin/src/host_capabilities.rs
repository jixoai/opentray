// Orthogonal intents (maintained 2026-09-18; original user request: win32
// notifications must ride the caller's already-registered tray icon channel
// instead of a new identity atom — add-ext-notification design reference
// section 2, frozen O1=B ruling):
// 1. Route one host-platform ExtCommand envelope family at a time through a
//    generic capability table owned by broker composition, never a
//    string-compare branch inside kernel dispatch (opentray-core stays
//    product-neutral and free of any capability-word special casing).
// 2. Preserve the kernel's frame laws isomorphically for bridged commands:
//    session initialization and session-owns-tray authorization reject with
//    the same protocol codes the kernel path produces.
// 3. Answer bridged commands immediately with the extension family's
//    ExtCommandResult/ExtEvent frame shape so facades stay
//    transport-agnostic about whether a DLL or the bridge answered.
// 4. Keep the broker-injected CommandScope (appId, trayId, sessionId,
//    instanceGeneration) host-derived for bridge dispatches exactly as the
//    kernel derives it for extension dispatches.
// Compromise: this module is the single broker-side capability-routing
// composition point, so the route table and the pre-dispatch hook cannot be
// physically separated without inventing a second broker binary; the table
// stays data (one static slice), and the routing logic inspects no
// capability words itself.

use opentray_core::{AppBackend, BrokerKernel, BrokerSession, ExtensionLoader};
use opentray_spec::{
    ClientFrame, CommandScope, ExtensionEnvelope, ExtensionScope, ServerFrame,
};
use serde_json::Value;

use crate::tray_notification::{tray_notification_bridge, TrayNotificationSeam};

/// Host platform word used only for route selection. The routing composition
/// itself is platform-neutral: tests drive every platform value on any host.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum HostPlatform {
    Darwin,
    Win32,
    Linux,
}

/// The platform the broker binary was compiled for. Route resolution always
/// receives this value from the composition call site; nothing else in this
/// module inspects `cfg`.
pub(crate) fn current_host_platform() -> HostPlatform {
    if cfg!(target_os = "macos") {
        HostPlatform::Darwin
    } else if cfg!(target_os = "windows") {
        HostPlatform::Win32
    } else {
        HostPlatform::Linux
    }
}

/// One registered broker-side command route: when an `ExtCommand` envelope's
/// capability word (`ext`) and command type (`data.type`) match on the given
/// host platform, the handler answers in composition instead of the extension
/// DLL. The table is the ONLY place a capability word appears in routing; the
/// matcher below compares fields, never literals.
struct HostCapabilityRoute {
    capability: &'static str,
    command: &'static str,
    platform: HostPlatform,
    handler: HostCapabilityHandler,
}

type HostCapabilityHandler = fn(&HostCapabilityDispatch<'_>) -> HostCapabilityOutcome;

/// The static composition route table. Registration is additive: a future
/// host capability appends one entry (and its service below), never a branch.
static HOST_CAPABILITY_ROUTES: &[HostCapabilityRoute] = &[HostCapabilityRoute {
    // add-ext-notification design section 2 (frozen): win32 notify reuses the
    // scope-bound registered tray icon's Shell_NotifyIcon NIF_INFO channel.
    // On darwin this entry is inert by platform mismatch — every notification
    // command, notify included, flows to the extension DLL unchanged.
    capability: "notification",
    command: "notify",
    platform: HostPlatform::Win32,
    handler: tray_notification_bridge,
}];

/// Resolves the handler for one (capability, command type, platform) triple.
/// `None` means "not a bridged command": the envelope falls through to normal
/// kernel dispatch. This function contains no capability-word literals.
pub(crate) fn resolve_host_capability(
    capability: &str,
    command: &str,
    platform: HostPlatform,
) -> Option<HostCapabilityHandler> {
    HOST_CAPABILITY_ROUTES
        .iter()
        .find(|route| {
            route.platform == platform && route.capability == capability && route.command == command
        })
        .map(|route| route.handler)
}

/// Broker-native services a bridged handler may use. Owned by the broker
/// application on the owner loop thread (the same thread law as tray
/// registration), so the seams carry no thread-safety bound.
pub(crate) struct HostServices {
    tray_notification: TrayNotificationSeam,
}

impl HostServices {
    /// Composition constructor: the production seam per platform. Win32 wires
    /// the tray-notification channel source to the shared tray-backend runtime
    /// handle registered at broker construction (the typed, downcast-free
    /// side-channel law — the kernel's TrayIconBackend keeps applying
    /// projections through the same runtime object). Non-win32 brokers
    /// register no routes, so their seam is never consulted.
    #[cfg(target_os = "windows")]
    pub(crate) fn new(
        tray_runtime: std::sync::Arc<opentray_backend_tray_icon::NativeTrayIconRuntime>,
    ) -> Self {
        Self {
            tray_notification: TrayNotificationSeam::compose_native(tray_runtime),
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub(crate) fn new() -> Self {
        Self {
            tray_notification: TrayNotificationSeam::compose_native(),
        }
    }

    /// Test/composition constructor over an explicit seam.
    #[cfg(test)]
    pub(crate) fn from_tray_notification(tray_notification: TrayNotificationSeam) -> Self {
        Self { tray_notification }
    }
}

/// Everything a bridged handler receives: the broker-injected ownership
/// scope, the command payload, and the composition-owned native services.
/// The scope is host-derived host truth exactly like the kernel's extension
/// dispatch scope — handlers never read identity from the payload.
pub(crate) struct HostCapabilityDispatch<'a> {
    pub scope: CommandScope,
    pub data: &'a Value,
    pub tray_notification: &'a TrayNotificationSeam,
}

/// A bridged command's synchronous answer. Host capabilities are
/// owner-loop compositions by construction: there is no deferred surface
/// here, so the outcome is either an immediate result event or a typed
/// rejection with the extension family's error-code contract.
pub(crate) enum HostCapabilityOutcome {
    /// Completed immediately; the value is the result event `data` JSON in
    /// the extension family's frozen event shape.
    Immediate(Value),
    /// Typed rejection: the wire error frame carries this code, message, and
    /// discriminated details payload, isomorphic to a DLL-side
    /// `TypedExtensionError` surfaced through the kernel's error mapping.
    Failed {
        code: String,
        message: String,
        details: Option<Value>,
    },
}

/// Extracts the command discriminator (`data.type`) the family's command DTOs
/// freeze. Envelopes without a string discriminator are not routable and stay
/// in the kernel/DLL domain.
fn command_type_of(data: &Value) -> Option<&str> {
    data.get("type").and_then(Value::as_str)
}

/// Composition pre-dispatch hook (add-ext-notification design section 2):
/// returns `Some(frames)` when a host-capability route answered the frame in
/// the broker composition layer, `None` when the frame must take the normal
/// kernel dispatch path. Generic over backend and loader so tests drive the
/// exact production logic with a fake backend.
pub(crate) fn compose_host_capability_frames<B: AppBackend, L: ExtensionLoader>(
    broker: &BrokerKernel<B, L>,
    session: &BrokerSession,
    frame: &ClientFrame,
    services: &HostServices,
    platform: HostPlatform,
) -> Option<Vec<ServerFrame>> {
    let ClientFrame::ExtCommand {
        request_id,
        app_id,
        tray_id,
        ext,
        data,
    } = frame
    else {
        return None;
    };
    let Some(command) = command_type_of(data) else {
        return None;
    };
    let Some(handler) = resolve_host_capability(ext, command, platform) else {
        return None;
    };

    // Kernel frame-law parity: broker commands require an accepted Init.
    let Some(session_id) = session.session_id().map(ToOwned::to_owned) else {
        return Some(vec![protocol_error_frame(
            Some(request_id.clone()),
            "not-initialized",
            "init must be accepted before broker commands",
        )]);
    };

    // Kernel authorization parity (harden-lifecycle-ownership D2): a tray
    // owned by another session can neither dispatch nor act through this
    // session's bridge. A tray with NO registered owner deliberately flows
    // on: the design's typed `notification_tray_absent` path owns "no
    // registered icon for this scope", mirroring the DLL's own typed
    // rejection surface, so the handler — not this generic layer — classifies
    // it.
    if let Some(owner) = broker.tray_owner(app_id, tray_id) {
        if owner != session_id {
            return Some(vec![protocol_error_frame(
                Some(request_id.clone()),
                "session-mismatch",
                format!("session {session_id} does not own tray {tray_id} of app {app_id}"),
            )]);
        }
    }

    // The bridge receives the same broker-injected scope the kernel derives
    // for extension dispatch (add-ext-dialog design section 5.5): session and
    // instance generation are host facts, never payload claims.
    let dispatch = HostCapabilityDispatch {
        scope: CommandScope {
            app_id: app_id.clone(),
            tray_id: tray_id.clone(),
            session_id,
            instance_generation: broker.operations().current_generation(app_id, ext),
        },
        data,
        tray_notification: &services.tray_notification,
    };
    Some(match handler(&dispatch) {
        HostCapabilityOutcome::Immediate(event_data) => {
            let event = ExtensionEnvelope {
                scope: ExtensionScope {
                    app_id: app_id.clone(),
                    tray_id: Some(tray_id.clone()),
                    ext: ext.clone(),
                },
                command_scope: None,
                data: event_data.clone(),
            };
            // Immediate keeps the exact kernel semantics: result envelopes in
            // one ExtCommandResult plus the event frames listeners consume.
            let mut frames = vec![ServerFrame::ExtCommandResult {
                request_id: request_id.clone(),
                events: vec![event],
            }];
            frames.push(ServerFrame::ExtEvent {
                app_id: app_id.clone(),
                tray_id: tray_id.clone(),
                ext: ext.clone(),
                data: event_data,
            });
            frames
        }
        HostCapabilityOutcome::Failed {
            code,
            message,
            details,
        } => vec![ServerFrame::Error {
            request_id: Some(request_id.clone()),
            code,
            message,
            details,
        }],
    })
}

fn protocol_error_frame(
    request_id: Option<String>,
    code: &str,
    message: impl Into<String>,
) -> ServerFrame {
    ServerFrame::Error {
        request_id,
        code: code.to_string(),
        message: message.into(),
        details: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_table_has_exactly_one_win32_notification_entry() {
        let entries = HOST_CAPABILITY_ROUTES
            .iter()
            .filter(|route| route.capability == "notification");
        let win32: Vec<_> = entries.filter(|route| route.platform == HostPlatform::Win32).collect();
        assert_eq!(win32.len(), 1);
        assert_eq!(win32[0].command, "notify");
        // darwin/linux register no notification route at all: the entry list
        // itself is the composition fact (zero broker-side notification
        // logic exists on those platforms).
        for platform in [HostPlatform::Darwin, HostPlatform::Linux] {
            assert!(
                !HOST_CAPABILITY_ROUTES
                    .iter()
                    .any(|route| route.capability == "notification" && route.platform == platform),
                "no notification route may exist for {platform:?}"
            );
        }
    }

    #[test]
    fn command_discriminator_requires_a_string_type_field() {
        assert_eq!(command_type_of(&serde_json::json!({"type": "notify"})), Some("notify"));
        assert_eq!(command_type_of(&serde_json::json!({"type": 7})), None);
        assert_eq!(command_type_of(&serde_json::json!({})), None);
    }
}
