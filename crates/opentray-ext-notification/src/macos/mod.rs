//! macOS notification surface (add-ext-notification design sections 2/4).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: OS
//! standard notifications through UNUserNotificationCenter, with
//! authorization read/request completing as the first non-modal
//! DeferredOperation use and no synchronous owner-loop wait):
//! 1. `post` builds `UNMutableNotificationContent` title/body/subtitle on
//!    the owner thread (zero raw `msg_send!`; typed objc2 bindings only),
//!    projects `silent` as the ABSENCE of the sound flag (default =
//!    `defaultSound`), and hands one uniquely identified
//!    `UNNotificationRequest` to the center. Acceptance = the add call
//!    issued (resolve-on-acceptance); user visibility and notification
//!    retention stay owned by system policy (v1 attaches no delegate).
//! 2. The query channel issues `getNotificationSettings…` /
//! `requestAuthorizationWithOptions:…` whose blocks fire on libdispatch
//!    queues; the block maps the UN enum to the neutral outcome and hops
//!    it onto the MAIN queue — the owner thread — so every ObjC touch
//!    after the call happens on the owner loop. The blocks carry only
//!    `Send` data (`ReplyToken` + the mapped outcome).
//! 3. The main-queue executor is the `OwnerExecutor`: `hop` =
//!    `dispatch_async(main)`, `arm_timeout` = `dispatch_after(10s, main)`
//!    — the frozen 10 s authorization budget (design section 4).
//! 4. Authorization is never queried synchronously (O2 ruling): the
//!    command answers Deferred and the outcome settles the one terminal
//!    through the deferred port on the owner thread.
//!
//! Compromise: `currentNotificationCenter()` is re-taken per call on the
//! owner thread instead of cached in the instance, because the center is
//! a process-wide singleton whose lifetime is system-owned and caching it
//! would only add an identity assumption the carrier law already covers.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_foundation::NSString;
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationContent, UNNotificationRequest, UNNotificationSound, UNUserNotificationCenter,
};

use opentray_spec::TypedExtensionError;

pub(crate) mod bridge;

use bridge::{spawn_bridge_notification, un_center_presentation_available};

use crate::auth::{
    hop_outcome, AuthOutcome, AuthQuery, AuthQueryChannel, OwnerExecutor, OwnerJob, PostSink,
    ReplyToken, AUTHORIZATION_TIMEOUT_SECS,
};
use crate::options::{self, error_code, transport_code, typed_error, NotifyContent};

/// Per-post request identifiers: unique within the process lifetime so
/// repeated notifications replace nothing by accident (the system keys
/// delivered-notification replacement on the identifier).
static NEXT_REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);

/// Notification dispatch requires the broker's GUI owner (main) thread:
/// UNUserNotificationCenter is owner-thread-bound by the design's carrier
/// law, and every AppKit-adjacent touch in this crate happens there.
/// This is a host-contract violation category, not one of the five frozen
/// notification product codes.
pub(crate) fn require_main_thread() -> Result<MainThreadMarker, TypedExtensionError> {
    MainThreadMarker::new().ok_or_else(|| {
        typed_error(
            transport_code::INVALID_DISPATCH_THREAD,
            "notification dispatch requires the broker main (owner-loop) thread",
        )
    })
}

/// The production `OwnerExecutor`: the main GCD queue is the owner loop's
/// scheduling surface (design section 4: the authorization callback wakes
/// the owner loop through main-thread dispatch).
pub(crate) struct MainQueueExecutor;

impl OwnerExecutor for MainQueueExecutor {
    fn hop(&self, job: OwnerJob) {
        DispatchQueue::main().exec_async(move || job());
    }

    fn arm_timeout(&self, job: OwnerJob) {
        let when = DispatchTime::try_from(Duration::from_secs(AUTHORIZATION_TIMEOUT_SECS))
            .expect("10s fits dispatch time");
        if let Err(error) = DispatchQueue::main().after(when, move || job()) {
            // Without the armed timeout the outcome hop is the only settle
            // path — a lost callback would hang the operation until
            // session close; degrade loudly instead of pretending.
            eprintln!(
                "opentray-ext-notification could not arm the authorization timeout: {error:?}"
            );
        }
    }
}

/// Maps the UN authorization status enum onto the frozen tri-state
/// (design section 1). Provisional/Ephemeral are granted-family
/// authorizations; an unknown future raw value is the honest typed
/// failure, never a guessed status.
fn map_status(status: UNAuthorizationStatus) -> AuthOutcome {
    match status {
        UNAuthorizationStatus::Authorized
        | UNAuthorizationStatus::Provisional
        | UNAuthorizationStatus::Ephemeral => {
            AuthOutcome::Status(options::AuthorizationStatus::Granted)
        }
        UNAuthorizationStatus::Denied => AuthOutcome::Status(options::AuthorizationStatus::Denied),
        UNAuthorizationStatus::NotDetermined => {
            AuthOutcome::Status(options::AuthorizationStatus::NotDetermined)
        }
        other => AuthOutcome::Failed(TypedExtensionError {
            code: error_code::FAILED.to_string(),
            message: format!(
                "UNUserNotificationCenter reported an unrecognized authorization status \
                 ({})",
                other.0
            ),
            details: Some(serde_json::json!({
                "reason": "authorization-status-unreadable",
                "rawStatus": other.0,
            })),
        }),
    }
}

/// The production `AuthQueryChannel`: real UNUserNotificationCenter calls.
/// Must be started on the owner thread; the completion blocks marshal the
/// mapped outcome back onto the owner thread through the executor.
pub(crate) struct UNQueryChannel;

impl AuthQueryChannel for UNQueryChannel {
    fn start(
        &self,
        query: AuthQuery,
        token: ReplyToken,
        _executor: &dyn OwnerExecutor,
    ) -> Result<(), TypedExtensionError> {
        // The owner-thread gate is the contract; the center call follows it.
        require_main_thread()?;
        let center = UNUserNotificationCenter::currentNotificationCenter();
        // The completion blocks must be 'static (the system holds them),
        // so they capture the stateless main-queue executor BY VALUE —
        // the production hop is the main queue no matter which executor
        // reference started the transaction (test fakes route their own
        // hops through `hop_outcome` instead).
        let executor = MainQueueExecutor;
        match query {
            AuthQuery::Status => {
                let block = RcBlock::new(
                    move |settings: std::ptr::NonNull<
                        objc2_user_notifications::UNNotificationSettings,
                    >| {
                        // Runs on a libdispatch queue: map now (ObjC touch
                        // on this queue only), hop the plain outcome.
                        let outcome =
                            map_status(unsafe { settings.as_ref().authorizationStatus() });
                        hop_outcome(token, outcome, &executor);
                    },
                );
                center.getNotificationSettingsWithCompletionHandler(&block);
                Ok(())
            }
            AuthQuery::Request => {
                // The standard alert triple: badge, sound, alert.
                let request_options = UNAuthorizationOptions::Badge
                    | UNAuthorizationOptions::Sound
                    | UNAuthorizationOptions::Alert;
                let block = RcBlock::new(
                    move |granted: objc2::runtime::Bool, error: *mut objc2_foundation::NSError| {
                        let outcome = if !error.is_null() {
                            let code = unsafe { (*error).code() };
                            AuthOutcome::Failed(TypedExtensionError {
                                code: error_code::FAILED.to_string(),
                                message: "requestAuthorization completed with an OS error"
                                    .to_string(),
                                details: Some(serde_json::json!({
                                    "reason": "authorization-request-failed",
                                    "nsErrorCode": code,
                                })),
                            })
                        } else {
                            AuthOutcome::Decision(bool::from(granted))
                        };
                        hop_outcome(token, outcome, &executor);
                    },
                );
                center.requestAuthorizationWithOptions_completionHandler(request_options, &block);
                Ok(())
            }
        }
    }
}

/// The owner-thread notification post (design section 2): one
/// `UNMutableNotificationContent` + one uniquely identified request, no
/// completion block (acceptance = the add call issued; the completion
/// channel is reserved for a future event surface and v1 has none).
pub(crate) fn post_notification(content: &NotifyContent) -> Result<(), TypedExtensionError> {
    require_main_thread()?;
    let center = UNUserNotificationCenter::currentNotificationCenter();

    let mutable = UNMutableNotificationContent::new();
    mutable.setTitle(&NSString::from_str(&content.title));
    if let Some(body) = content.body.as_deref() {
        mutable.setBody(&NSString::from_str(body));
    }
    if let Some(subtitle) = content.subtitle.as_deref() {
        mutable.setSubtitle(&NSString::from_str(subtitle));
    }
    // `silent` projection (design section 2): the default is the platform
    // default alert sound; silent = true leaves the sound flag unset.
    if !content.is_silent() {
        let sound = UNNotificationSound::defaultSound();
        mutable.setSound(Some(&sound));
    } else {
        mutable.setSound(None);
    }

    let sequence = NEXT_REQUEST_SEQ.fetch_add(1, Ordering::Relaxed);
    let identifier = NSString::from_str(&format!("opentray-notification-{sequence}"));
    let upcast: Retained<UNNotificationContent> = Retained::from(&mutable);
    let request =
        UNNotificationRequest::requestWithIdentifier_content_trigger(&identifier, &upcast, None);
    center.addNotificationRequest_withCompletionHandler(&request, None);
    Ok(())
}

/// The production `PostSink` for the owner-thread delivery path. Every
/// post triages the channel through the running process's code-signature
/// class (bridge module): a presentable signature posts through the UN
/// center; an unsigned/ad-hoc carrier — which macOS 26 refuses to
/// authorize in every launch shape — posts through the osascript bridge
/// so unsigned installs still present banners (Owner ruling 2026-09-19).
/// A DENIED snapshot never reaches this sink (the transaction rejects
/// first): the zero-delivery acceptance law is unchanged.
pub(crate) struct OwnerPost {
    /// Seam: the channel triage (production = the signature self-check).
    pub(crate) presentation_probe: fn() -> bool,
    /// Seam: the fallback delivery (production = the osascript spawn).
    pub(crate) bridge: fn(&NotifyContent) -> Result<(), TypedExtensionError>,
}

impl Default for OwnerPost {
    fn default() -> Self {
        Self {
            presentation_probe: un_center_presentation_available,
            bridge: spawn_bridge_notification,
        }
    }
}

impl PostSink for OwnerPost {
    fn post(&mut self, content: &NotifyContent) -> Result<(), TypedExtensionError> {
        if (self.presentation_probe)() {
            post_notification(content)
        } else {
            (self.bridge)(content)
        }
    }
}

#[cfg(test)]
mod owner_post_tests {
    use super::*;

    fn content() -> NotifyContent {
        NotifyContent {
            title: "t".to_string(),
            body: Some("b".to_string()),
            subtitle: None,
            silent: None,
        }
    }

    #[test]
    fn presentable_signature_posts_through_the_un_center() {
        let mut post = OwnerPost {
            presentation_probe: || true,
            bridge: |_| panic!("the bridge must not run when the UN center can present"),
        };
        // The UN post itself requires the owner thread; this test runs on
        // a harness thread, so the expected outcome is the honest typed
        // thread rejection — proving the UN path was taken, not the bridge.
        let error = post.post(&content()).unwrap_err();
        assert_eq!(error.code, "invalid_dispatch_thread");
    }

    #[test]
    fn unsigned_carrier_posts_through_the_bridge() {
        // OwnerPost carries plain fn pointers, so the fake captures through
        // a thread_local instead of a closure.
        thread_local! {
            static SINK: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
        }
        fn fake_bridge(content: &NotifyContent) -> Result<(), TypedExtensionError> {
            SINK.with(|sink| *sink.borrow_mut() = Some(content.title.clone()));
            Ok(())
        }
        let mut post = OwnerPost {
            presentation_probe: || false,
            bridge: fake_bridge,
        };
        post.post(&content()).expect("the fake bridge accepts");
        SINK.with(|sink| assert_eq!(sink.borrow().as_deref(), Some("t")));
    }
}
