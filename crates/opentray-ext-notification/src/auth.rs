//! The deferred authorization transaction engine (add-ext-notification
//! design section 4, O2 ruling frozen).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests:
//! darwin's UNUserNotificationCenter authorization read/request must
//! complete without a synchronous owner-loop wait, reusing the existing
//! DeferredOperation transaction and completion port):
//! 1. `getAuthorizationStatus`/`requestAuthorization` answer the seeded
//!    `ExtCommandDispositionV1` with Deferred (kept exactly as seeded) and
//!    settle later through ONE terminal on the deferred port — the first
//!    NON-MODAL use of the deferred infrastructure (no new ABI symbols, no
//!    poll owner: the transaction is callback-driven).
//! 2. Every settle path — authorization outcome, the 10s timeout, and the
//!    session-close cancel branch — races for one one-shot CAS
//!    (`settle_once`); exactly one terminal is ever submitted per accepted
//!    operation (mirroring opentray-core's DeferredOperationRegistry
//!    settlement law; the broker's own settlement CAS stays the second
//!    line of defense).
//! 3. `notify` acceptance linearizes denial in one owner-loop frame
//!    (design section 4): the cached last authorization snapshot decides
//!    before any native post — a denied snapshot is a typed
//!    `notification_denied` with ZERO post calls; a snapshot-less first
//!    notify defers through the SAME transaction machinery (auth preflight
//!    inside the 10s budget, then post).
//! 4. The snapshot cache keys on the full `(appId, trayId, sessionId,
//!    instanceGeneration)` scope and is never trusted across sessions;
//!    session close removes its session's snapshots.
//!
//! Compromise: the engine is platform-neutral and owner-thread-confined
//! (production: the broker's main thread; tests: the harness thread plays
//! owner through the same code path), while the two native seams — the
//! UNUserNotificationCenter query channel and the owner-hop/timeout
//! scheduler — are traits so the darwin production adapters in
//! `macos/mod.rs` and the injected fakes never diverge in law. The native
//! blocks run on libdispatch queues and therefore carry only plain
//! `Send` data (`ReplyToken` + mapped outcome); every ObjC touch happens
//! on the owner thread.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use opentray_spec::{CommandScope, ExtOperationPayload, TypedExtensionError};
use serde_json::Value;

use crate::options::{
    self, authorization_decision_result, authorization_status_result, denied_error,
    failed_reason_error, notify_accepted_result, AuthorizationStatus, NotifyContent,
    REASON_AUTHORIZATION_SESSION_CLOSED, REASON_AUTHORIZATION_TIMEOUT,
};

/// The frozen authorization budget (design section 4): a callback that
/// never arrives times out after 10 seconds into the typed
/// `notification_failed` (reason `authorization-timeout`).
pub(crate) const AUTHORIZATION_TIMEOUT_SECS: u64 = 10;

/// Which query a deferred authorization transaction runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthQuery {
    /// `getNotificationSettingsWithCompletionHandler` → status.
    Status,
    /// `requestAuthorizationWithOptions` → granted bool.
    Request,
}

/// What a deferred transaction is FOR. A first snapshot-less `notify`
/// rides the same machinery as an explicit authorization command: the
/// authorization preflight runs inside the 10s budget, then the post (or
/// the typed denial, with zero posts) settles the notify operation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AuthKind {
    Status,
    Request,
    NotifyPreflight { content: NotifyContent },
}

impl AuthKind {
    /// The snapshot provenance label recorded when this transaction's
    /// outcome populates the cache (design section 4: the typed error and
    /// backend log name the snapshot source).
    fn provenance(&self) -> &'static str {
        match self {
            Self::Status => "getAuthorizationStatus",
            Self::Request => "requestAuthorization",
            Self::NotifyPreflight { .. } => "notify-preflight",
        }
    }
}

/// The mapped reply of one native authorization query. Mapping from the
/// UN enum happens at the seam boundary (off the owner thread) so the
/// engine never touches ObjC types; an unmappable raw value arrives as
/// the honest typed failure instead of a guessed status.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AuthOutcome {
    Status(AuthorizationStatus),
    Decision(bool),
    Failed(TypedExtensionError),
}

/// What may settle one transaction. Exactly one of these wins the CAS.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AuthEvent {
    Outcome(AuthOutcome),
    Timeout,
    SessionClosed,
}

/// Identifies one in-flight transaction to a hop closure: plain `Send`
/// data (a process-unique instance key plus the broker-issued operation
/// handle). This is the ONLY state a libdispatch block is allowed to
/// carry across threads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ReplyToken {
    pub instance_key: u64,
    pub handle: u64,
}

/// One deferred authorization transaction. The `settled` CAS is the
/// extension-side exactly-once law: the first of {outcome, timeout,
/// session close} to run `settle_once` owns the single terminal.
pub(crate) struct AuthTransaction {
    pub handle: u64,
    pub scope: CommandScope,
    pub kind: AuthKind,
    settled: Cell<bool>,
}

impl AuthTransaction {
    pub(crate) fn settle_once(&self) -> bool {
        !self.settled.replace(true)
    }
}

/// The cached last authorization snapshot (design section 4) plus its
/// provenance. Keyed by the full command scope; never trusted across
/// sessions. `Copy` so dispatch can lift it out of the engine borrow in
/// one owner-loop frame.
#[derive(Debug, Clone, Copy)]
pub(crate) struct AuthSnapshot {
    pub status: AuthorizationStatus,
    pub provenance: &'static str,
}

// ---------------------------------------------------------------------------
// Seams: owner-thread scheduler and native query channel
// ---------------------------------------------------------------------------

/// A unit of settlement work destined for the owner thread. `Send` by
/// construction — this is what crosses from a libdispatch queue callback
/// back to the owner loop.
pub(crate) type OwnerJob = Box<dyn FnOnce() + Send>;

/// Schedules settlement work onto the owner thread. Production (darwin):
/// the main GCD queue — `hop` is `dispatch_async(main)`, `arm_timeout` is
/// `dispatch_after(10s, main)`. Tests inject synchronous or manual
/// schedulers; the engine never knows which. No Send/Sync bound: the
/// executor is used on the owner thread only, and production blocks
/// capture the stateless `MainQueueExecutor` by value, never the
/// reference.
pub(crate) trait OwnerExecutor {
    fn hop(&self, job: OwnerJob);
    fn arm_timeout(&self, job: OwnerJob);
}

/// Starts one native authorization query. The implementation issues the
/// UNUserNotificationCenter call on the owner thread and arranges for the
/// reply to reach `deliver_auth_event` ON the owner thread (production
/// marshals through `OwnerExecutor::hop`; the fake records the issued
/// query and fires replies explicitly). A `start` that returns an error
/// is a synchronous typed rejection on the original command (pre-Accept:
/// no transaction exists yet).
pub(crate) trait AuthQueryChannel {
    fn start(
        &self,
        query: AuthQuery,
        token: ReplyToken,
        executor: &dyn OwnerExecutor,
    ) -> Result<(), TypedExtensionError>;
}

/// The native notification post seam (resolve-on-acceptance): `Ok` means
/// the native delivery request was accepted. The denied-linearization
/// law guarantees this sink is NEVER invoked for a denied snapshot.
pub(crate) trait PostSink {
    fn post(&mut self, content: &NotifyContent) -> Result<(), TypedExtensionError>;
}

/// Builds and hops the outcome job for one token — the single code path
/// both the production UN block and the test fakes use to marshal a
/// reply onto the owner thread.
#[cfg_attr(all(not(target_os = "macos"), not(test)), allow(dead_code))]
pub(crate) fn hop_outcome(token: ReplyToken, outcome: AuthOutcome, executor: &dyn OwnerExecutor) {
    executor.hop(Box::new(move || {
        deliver_auth_event(
            token.instance_key,
            token.handle,
            AuthEvent::Outcome(outcome),
        );
    }));
}

/// Builds and arms the 10s timeout job for one token. Whichever of the
/// timeout and the outcome lands first wins the CAS; the loser is a
/// stateless no-op.
pub(crate) fn arm_outcome_timeout(token: ReplyToken, executor: &dyn OwnerExecutor) {
    executor.arm_timeout(Box::new(move || {
        deliver_auth_event(token.instance_key, token.handle, AuthEvent::Timeout);
    }));
}

// ---------------------------------------------------------------------------
// Settlement law (pure)
// ---------------------------------------------------------------------------

/// What the winner of a transaction's CAS must do. `PostThenSubmit` is
/// the notify-preflight acceptance ordering: the native post IS the
/// acceptance, so it runs before the terminal; a post failure replaces
/// the ok terminal with the typed error.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Settlement {
    Submit(ExtOperationPayload),
    PostThenSubmit {
        content: NotifyContent,
        ok: ExtOperationPayload,
    },
}

fn result_payload(value: Value) -> ExtOperationPayload {
    ExtOperationPayload::Result { value }
}

fn error_payload(error: TypedExtensionError) -> ExtOperationPayload {
    ExtOperationPayload::Error { error }
}

fn timeout_payload() -> ExtOperationPayload {
    error_payload(failed_reason_error(
        REASON_AUTHORIZATION_TIMEOUT,
        "the authorization callback never arrived within the 10s budget",
    ))
}

fn session_closed_payload() -> ExtOperationPayload {
    error_payload(failed_reason_error(
        REASON_AUTHORIZATION_SESSION_CLOSED,
        "the owning session closed and revoked the in-flight authorization callback",
    ))
}

fn reply_mismatch_payload(expected: &str) -> ExtOperationPayload {
    error_payload(failed_reason_error(
        "authorization-reply-mismatch",
        format!("the authorization reply shape does not match the {expected} transaction"),
    ))
}

/// Maps one winning event to the transaction's settlement (design
/// sections 1/4). The pure law:
///
/// - `Status` + status reply → the `{"type":"authorization"}` result.
/// - `Request` + decision reply → the `{"type":"authorizationDecision"}`
///   result.
/// - `NotifyPreflight` + denied → the typed `notification_denied` result
///   error — ZERO posts (the PostSink is never reached on this path).
/// - `NotifyPreflight` + granted/notDetermined → post first (the system
///   implicitly presents the authorization prompt under notDetermined —
///   documented darwin behavior), then the acceptance terminal.
/// - Timeout → `notification_failed`/`authorization-timeout`.
/// - SessionClosed → the cancel branch
///   (`notification_failed`/`authorization-session-closed`), exactly once.
/// - Cross-shape replies and mapped failures are honest typed errors.
pub(crate) fn settlement_for(kind: &AuthKind, event: &AuthEvent) -> Settlement {
    match event {
        AuthEvent::SessionClosed => return Settlement::Submit(session_closed_payload()),
        AuthEvent::Timeout => return Settlement::Submit(timeout_payload()),
        AuthEvent::Outcome(outcome) => match (kind, outcome) {
            (AuthKind::Status, AuthOutcome::Status(status)) => {
                Settlement::Submit(result_payload(authorization_status_result(*status)))
            }
            (AuthKind::Request, AuthOutcome::Decision(granted)) => {
                Settlement::Submit(result_payload(authorization_decision_result(*granted)))
            }
            (AuthKind::NotifyPreflight { content }, AuthOutcome::Status(status)) => match status {
                AuthorizationStatus::Denied => {
                    Settlement::Submit(error_payload(denied_error(*status, kind.provenance())))
                }
                AuthorizationStatus::Granted | AuthorizationStatus::NotDetermined => {
                    Settlement::PostThenSubmit {
                        content: content.clone(),
                        ok: result_payload(notify_accepted_result()),
                    }
                }
            },
            (_, AuthOutcome::Failed(error)) => Settlement::Submit(error_payload(error.clone())),
            (AuthKind::Status, AuthOutcome::Decision(_))
            | (AuthKind::Request, AuthOutcome::Status(_))
            | (AuthKind::NotifyPreflight { .. }, AuthOutcome::Decision(_)) => {
                Settlement::Submit(reply_mismatch_payload(match kind {
                    AuthKind::Status => "getAuthorizationStatus",
                    AuthKind::Request => "requestAuthorization",
                    AuthKind::NotifyPreflight { .. } => "notify-preflight",
                }))
            }
        },
    }
}

// ---------------------------------------------------------------------------
// The notify acceptance law (design section 4, denied linearization)
// ---------------------------------------------------------------------------

/// The immediate-notify decision computed inside one owner-loop frame
/// from the cached snapshot.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum NotifyImmediate {
    /// Snapshot says denied: the typed rejection — the post sink is NEVER
    /// called (zero native posts).
    Denied(TypedExtensionError),
    /// Snapshot allows delivery: the post already ran through the sink;
    /// `Ok` carries the immediate result event value, `Err` the post's
    /// typed rejection.
    Posted(Result<Value, TypedExtensionError>),
    /// No snapshot: the command defers through the authorization
    /// preflight (zero posts on this path too).
    DeferPreflight,
}

/// The notify acceptance transaction (design section 4): acceptance =
/// authorization snapshot + delivery acceptance, sequenced in the same
/// owner-loop frame. A denied snapshot rejects BEFORE the sink exists on
/// the path — the zero-post law. granted/notDetermined snapshots post
/// immediately (notDetermined lets the system implicitly present the
/// authorization prompt — documented darwin behavior); a missing
/// snapshot defers to the preflight.
pub(crate) fn immediate_notify_transaction(
    snapshot: Option<&AuthSnapshot>,
    content: &NotifyContent,
    post: &mut dyn PostSink,
) -> NotifyImmediate {
    match snapshot {
        Some(snapshot) => match snapshot.status {
            AuthorizationStatus::Denied => NotifyImmediate::Denied(denied_error(
                AuthorizationStatus::Denied,
                snapshot.provenance,
            )),
            AuthorizationStatus::Granted | AuthorizationStatus::NotDetermined => {
                NotifyImmediate::Posted(post.post(content).map(|()| notify_accepted_result()))
            }
        },
        None => NotifyImmediate::DeferPreflight,
    }
}

// ---------------------------------------------------------------------------
// Engine: transactions + snapshots (owner-thread confined)
// ---------------------------------------------------------------------------

/// Per-instance authorization state. Every method runs on the owner
/// thread (the same thread that received `opentray_ext_command_v2`);
/// nothing crosses threads except the `Send` hop jobs.
#[derive(Default)]
pub(crate) struct AuthEngine {
    transactions: HashMap<u64, AuthTransaction>,
    snapshots: HashMap<CommandScope, AuthSnapshot>,
}

impl AuthEngine {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Test/diagnostic accessor.
    #[cfg(test)]
    pub(crate) fn active_count(&self) -> usize {
        self.transactions.len()
    }

    pub(crate) fn snapshot(&self, scope: &CommandScope) -> Option<&AuthSnapshot> {
        self.snapshots.get(scope)
    }

    fn record_snapshot(
        &mut self,
        scope: &CommandScope,
        status: AuthorizationStatus,
        provenance: &'static str,
    ) {
        self.snapshots
            .insert(scope.clone(), AuthSnapshot { status, provenance });
    }

    /// Registers the transaction the broker seeded (the handle crosses
    /// the FFI only through the seeded disposition struct).
    pub(crate) fn register(&mut self, handle: u64, scope: CommandScope, kind: AuthKind) {
        self.transactions.insert(
            handle,
            AuthTransaction {
                handle,
                scope,
                kind,
                settled: Cell::new(false),
            },
        );
    }

    /// Begins one deferred authorization command: register, issue the
    /// native query, arm the timeout. Caller has already validated the
    /// handle and the port. A `start` error rolls the registration back —
    /// pre-Accept, no transaction may survive.
    pub(crate) fn begin(
        &mut self,
        handle: u64,
        scope: CommandScope,
        kind: AuthKind,
        query: AuthQuery,
        token: ReplyToken,
        channel: &dyn AuthQueryChannel,
        executor: &dyn OwnerExecutor,
    ) -> Result<(), TypedExtensionError> {
        self.register(handle, scope, kind);
        if let Err(error) = channel.start(query, token, executor) {
            self.transactions.remove(&handle);
            return Err(error);
        }
        arm_outcome_timeout(token, executor);
        Ok(())
    }

    /// Delivers one event to one transaction: the one-shot CAS decides
    /// the winner; the winner updates the snapshot cache (real outcomes
    /// only) and executes the settlement through the port. Unknown or
    /// already-settled transactions are stateless no-ops. Returns the
    /// settled handle when the CAS won.
    pub(crate) fn deliver(
        &mut self,
        handle: u64,
        event: AuthEvent,
        port: &mut dyn TerminalSink,
        post: &mut dyn PostSink,
    ) -> Option<u64> {
        let Some(transaction) = self.transactions.get(&handle) else {
            return None;
        };
        if !transaction.settle_once() {
            return None;
        }
        let scope = transaction.scope.clone();
        let kind = transaction.kind.clone();
        // Real authorization outcomes refresh the snapshot cache with
        // their provenance (design section 4). Timeout/session-close
        // carry no authorization fact and MUST NOT poison the cache.
        match &event {
            AuthEvent::Outcome(AuthOutcome::Status(status)) => {
                self.record_snapshot(&scope, *status, kind.provenance());
            }
            AuthEvent::Outcome(AuthOutcome::Decision(granted)) => {
                let status = if *granted {
                    AuthorizationStatus::Granted
                } else {
                    AuthorizationStatus::Denied
                };
                self.record_snapshot(&scope, status, kind.provenance());
            }
            AuthEvent::Outcome(AuthOutcome::Failed(_))
            | AuthEvent::Timeout
            | AuthEvent::SessionClosed => {}
        }
        let settlement = settlement_for(&kind, &event);
        self.transactions.remove(&handle);
        execute_settlement(handle, settlement, port, post);
        Some(handle)
    }

    /// Session-close revocation (design section 4): every in-flight
    /// transaction of the session settles through the cancel branch
    /// exactly once, and the session's snapshots are removed (no
    /// cross-session trust). Returns the settled handles, ascending.
    pub(crate) fn revoke_session(
        &mut self,
        session_id: &str,
        port: &mut dyn TerminalSink,
    ) -> Vec<u64> {
        let mut handles: Vec<u64> = self
            .transactions
            .values()
            .filter(|transaction| transaction.scope.session_id == session_id)
            .map(|transaction| transaction.handle)
            .collect();
        handles.sort_unstable();
        let settled: Vec<u64> = handles
            .into_iter()
            // The cancel branch never posts: authorization is dead with
            // the session, so the null post sink is the honest sink.
            .filter_map(|handle| self.deliver(handle, AuthEvent::SessionClosed, port, &mut NoPost))
            .collect();
        self.snapshots
            .retain(|scope, _| scope.session_id != session_id);
        settled
    }

    /// Deinit teardown: clear everything WITHOUT submitting terminals.
    /// The host revokes the deferred port before deinit, so a submit here
    /// could only observe PORT_CLOSED; skipping it keeps teardown
    /// side-effect free (the dialog family's deinit law).
    pub(crate) fn clear_without_terminals(&mut self) {
        self.transactions.clear();
        self.snapshots.clear();
    }

    /// Test support: seed the snapshot cache directly (production writes
    /// happen only through real outcomes on the owner thread).
    #[cfg(test)]
    pub(crate) fn seed_snapshot(
        &mut self,
        scope: &CommandScope,
        status: AuthorizationStatus,
        provenance: &'static str,
    ) {
        self.record_snapshot(scope, status, provenance);
    }
}

/// Where terminals go. Production: the deferred port copy (non-OK codes
/// are logged host decisions, never retried). Tests: a recording spy.
pub(crate) trait TerminalSink {
    fn submit(&mut self, handle: u64, payload: &ExtOperationPayload);
}

/// The no-op terminal sink: used when no port was ever attached (a
/// production impossibility for live transactions — deferred begins
/// require the port — and the safe cleanup fallback otherwise).
pub(crate) struct NullSink;

impl TerminalSink for NullSink {
    fn submit(&mut self, _handle: u64, _payload: &ExtOperationPayload) {}
}

/// The owner-thread post surface for platforms with no native
/// notification channel: every post is the typed platform failure.
/// Unreachable in production (only darwin settles notify-preflight
/// transactions); the honest guard for stray states.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) struct UnavailablePost;

impl PostSink for UnavailablePost {
    fn post(&mut self, _content: &NotifyContent) -> Result<(), TypedExtensionError> {
        Err(options::platform_unsupported_error())
    }
}

/// Executes one settlement: the notify-preflight acceptance posts FIRST
/// (a post failure replaces the ok terminal), then the single terminal
/// travels through the sink.
pub(crate) fn execute_settlement(
    handle: u64,
    settlement: Settlement,
    port: &mut dyn TerminalSink,
    post: &mut dyn PostSink,
) {
    match settlement {
        Settlement::Submit(payload) => port.submit(handle, &payload),
        Settlement::PostThenSubmit { content, ok } => {
            let payload = match post.post(&content) {
                Ok(()) => ok,
                Err(error) => ExtOperationPayload::Error { error },
            };
            port.submit(handle, &payload);
        }
    }
}

/// The cancel-branch post sink: revocation never delivers notifications.
struct NoPost;

impl PostSink for NoPost {
    fn post(&mut self, _content: &NotifyContent) -> Result<(), TypedExtensionError> {
        Err(options::typed_error(
            options::transport_code::INVALID_NOTIFICATION_COMMAND,
            "a revoked transaction must never post",
        ))
    }
}

// ---------------------------------------------------------------------------
// Owner-thread instance registry
// ---------------------------------------------------------------------------

/// The shared mutable core one instance owns. `closed` marks deinit: a
/// late hop after deinit finds the registry entry gone (or closed) and
/// becomes a stateless no-op — the port is revoked by then, so no
/// terminal may ever be submitted.
pub(crate) struct NotificationCore {
    pub closed: bool,
    pub port: Option<crate::state::DeferredPortCopy>,
    pub engine: AuthEngine,
}

impl NotificationCore {
    pub(crate) fn new() -> Self {
        Self {
            closed: false,
            port: None,
            engine: AuthEngine::new(),
        }
    }
}

impl Default for NotificationCore {
    fn default() -> Self {
        Self::new()
    }
}

thread_local! {
    /// Owner-thread registry of live instance cores, keyed by the
    /// process-unique instance key. Production hops (GCD main queue)
    /// discover their instance here; each test thread plays owner with
    /// its own registry view. Lazily initialized (HashMap::new is not a
    /// const constructor on this toolchain).
    static OWNER_INSTANCES: RefCell<HashMap<u64, Rc<RefCell<NotificationCore>>>> =
        RefCell::new(HashMap::new());
}

pub(crate) fn register_owner_instance(key: u64, core: &Rc<RefCell<NotificationCore>>) {
    OWNER_INSTANCES.with(|instances| {
        instances.borrow_mut().insert(key, core.clone());
    });
}

pub(crate) fn unregister_owner_instance(key: u64) {
    OWNER_INSTANCES.with(|instances| {
        instances.borrow_mut().remove(&key);
    });
}

/// The production TerminalSink: submits through the attached deferred
/// port copy, logging (never panicking on) non-OK host decisions —
/// PORT_CLOSED / INVALID_HANDLE / duplicate settlement are host
/// decisions; exactly-once is the CAS above plus the broker's settlement
/// CAS, not a retry concern.
#[cfg_attr(all(not(target_os = "macos"), not(test)), allow(dead_code))]
pub(crate) struct PortSink<'a>(pub &'a crate::state::DeferredPortCopy);

impl TerminalSink for PortSink<'_> {
    fn submit(&mut self, handle: u64, payload: &ExtOperationPayload) {
        let code = self.0.submit(handle, payload);
        if code != opentray_spec::EXT_OK {
            eprintln!(
                "opentray-ext-notification terminal submit for handle {handle:#018x} \
                 returned {code} (host decision; no retry)"
            );
        }
    }
}

/// The delivery entry a hop job runs ON the owner thread: find the
/// instance core, CAS the transaction, settle. Unknown instance (never
/// registered, or deinit'd) is a stateless no-op.
pub(crate) fn deliver_auth_event(instance_key: u64, handle: u64, event: AuthEvent) {
    OWNER_INSTANCES.with(|instances| {
        let Some(core) = instances.borrow().get(&instance_key).cloned() else {
            return;
        };
        let mut borrowed = core.borrow_mut();
        if borrowed.closed {
            return;
        }
        let Some(port) = borrowed.port.clone() else {
            return;
        };
        // The notify-preflight post runs through the platform owner-thread
        // post surface (darwin: UNUserNotificationCenter on main).
        let mut post = crate::platform_owner_post();
        borrowed
            .engine
            .deliver(handle, event, &mut PortSink(&port), &mut *post);
    });
}

// ---------------------------------------------------------------------------
// Engine suite: the authorization state machine through injected seams.
// The harness thread plays the owner thread; the manual executor models
// delayed/never callbacks and the timeout race explicitly (design
// section 5: the fake outcome family granted/denied/notDetermined/
// delayed/never-callback/session-close/double-fire).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    use opentray_spec::AppId;

    fn scope(session: &str) -> CommandScope {
        CommandScope {
            app_id: AppId::from("app-1"),
            tray_id: "tray-1".to_string(),
            session_id: session.to_string(),
            instance_generation: 1,
        }
    }

    /// Terminal recorder.
    struct SinkSpy {
        terminals: Vec<(u64, ExtOperationPayload)>,
    }

    impl TerminalSink for SinkSpy {
        fn submit(&mut self, handle: u64, payload: &ExtOperationPayload) {
            self.terminals.push((handle, payload.clone()));
        }
    }

    /// Post recorder with an injectable native result (the zero-post law
    /// asserts on the call log).
    struct SpyPost {
        posts: Vec<NotifyContent>,
        result: Result<(), TypedExtensionError>,
    }

    impl SpyPost {
        fn accepting() -> Self {
            Self {
                posts: Vec::new(),
                result: Ok(()),
            }
        }
    }

    impl PostSink for SpyPost {
        fn post(&mut self, content: &NotifyContent) -> Result<(), TypedExtensionError> {
            self.posts.push(content.clone());
            self.result.clone()
        }
    }

    /// Manual owner executor: hops and timeouts queue separately so a
    /// test decides the race (delayed outcome, never-callback, timeout
    /// first, outcome first).
    struct ManualExecutor {
        hops: std::cell::RefCell<Vec<OwnerJob>>,
        timeouts: std::cell::RefCell<Vec<OwnerJob>>,
    }

    impl ManualExecutor {
        fn new() -> Self {
            Self {
                hops: std::cell::RefCell::new(Vec::new()),
                timeouts: std::cell::RefCell::new(Vec::new()),
            }
        }

        fn queued(&self) -> (usize, usize) {
            (self.hops.borrow().len(), self.timeouts.borrow().len())
        }
    }

    impl OwnerExecutor for ManualExecutor {
        fn hop(&self, job: OwnerJob) {
            self.hops.borrow_mut().push(job);
        }
        fn arm_timeout(&self, job: OwnerJob) {
            self.timeouts.borrow_mut().push(job);
        }
    }

    /// Fake query channel: records queries; optionally fails `start`
    /// (the pre-Accept rollback case).
    struct FakeChannel {
        queries: std::cell::RefCell<Vec<AuthQuery>>,
        fail_start: bool,
    }

    impl FakeChannel {
        fn recording() -> Self {
            Self {
                queries: std::cell::RefCell::new(Vec::new()),
                fail_start: false,
            }
        }
    }

    impl AuthQueryChannel for FakeChannel {
        fn start(
            &self,
            query: AuthQuery,
            _token: ReplyToken,
            _executor: &dyn OwnerExecutor,
        ) -> Result<(), TypedExtensionError> {
            if self.fail_start {
                return Err(options::typed_error(
                    options::error_code::FAILED,
                    "the fake channel refused to start",
                ));
            }
            self.queries.borrow_mut().push(query);
            Ok(())
        }
    }

    struct Rig {
        engine: AuthEngine,
        sink: SinkSpy,
        post: SpyPost,
        channel: FakeChannel,
        executor: ManualExecutor,
    }

    impl Rig {
        fn new() -> Self {
            Self {
                engine: AuthEngine::new(),
                sink: SinkSpy {
                    terminals: Vec::new(),
                },
                post: SpyPost::accepting(),
                channel: FakeChannel::recording(),
                executor: ManualExecutor::new(),
            }
        }

        fn token(&self, handle: u64) -> ReplyToken {
            ReplyToken {
                instance_key: 9001,
                handle,
            }
        }

        fn begin_status(&mut self, handle: u64) {
            self.engine
                .begin(
                    handle,
                    scope("session-1"),
                    AuthKind::Status,
                    AuthQuery::Status,
                    self.token(handle),
                    &self.channel,
                    &self.executor,
                )
                .expect("begin");
        }

        /// Delivers an outcome at the engine seam (the settlement law).
        /// The queued-hop/registry route is driven end-to-end by the
        /// lib.rs full-stack suite through the REAL `hop_outcome` path.
        fn deliver_outcome(&mut self, handle: u64, outcome: AuthOutcome) {
            assert_eq!(
                self.engine.deliver(
                    handle,
                    AuthEvent::Outcome(outcome),
                    &mut self.sink,
                    &mut self.post
                ),
                Some(handle),
                "the first outcome wins the CAS"
            );
        }

        /// Delivers the armed timeout at the engine seam.
        fn deliver_timeout(&mut self, handle: u64) {
            assert_eq!(
                self.engine
                    .deliver(handle, AuthEvent::Timeout, &mut self.sink, &mut self.post),
                Some(handle),
                "the first timeout wins the CAS"
            );
        }

        /// A loser event (already settled): the CAS rejects it.
        fn deliver_loser(&mut self, handle: u64, event: AuthEvent) {
            assert!(
                self.engine
                    .deliver(handle, event, &mut self.sink, &mut self.post)
                    .is_none(),
                "a settled transaction accepts no second terminal"
            );
        }
    }

    #[test]
    fn the_authorization_budget_is_the_frozen_ten_seconds() {
        assert_eq!(AUTHORIZATION_TIMEOUT_SECS, 10);
    }

    /// granted / denied / notDetermined statuses each settle the Status
    /// transaction with the exact wire terminal and record the snapshot
    /// with the command's provenance.
    #[test]
    fn status_outcomes_settle_the_frozen_terminals_and_record_snapshots() {
        for status in [
            AuthorizationStatus::Granted,
            AuthorizationStatus::Denied,
            AuthorizationStatus::NotDetermined,
        ] {
            let mut rig = Rig::new();
            rig.begin_status(71);
            assert_eq!(
                rig.channel.queries.borrow().last().copied(),
                Some(AuthQuery::Status),
                "the native status query was issued"
            );
            rig.deliver_outcome(71, AuthOutcome::Status(status));

            assert_eq!(rig.sink.terminals.len(), 1);
            match &rig.sink.terminals[0].1 {
                ExtOperationPayload::Result { value } => assert_eq!(
                    value,
                    &serde_json::json!({ "type": "authorization", "status": status.wire() })
                ),
                other => panic!("status outcome is a result terminal: {other:?}"),
            }
            assert_eq!(rig.sink.terminals[0].0, 71);
            let snapshot = rig.engine.snapshot(&scope("session-1")).expect("snapshot");
            assert_eq!(snapshot.status, status);
            assert_eq!(snapshot.provenance, "getAuthorizationStatus");
            assert_eq!(
                rig.engine.active_count(),
                0,
                "the settled transaction is gone"
            );
        }
    }

    /// requestAuthorization: granted/declined decisions settle the
    /// boolean terminal and record the corresponding snapshot (a declined
    /// prompt IS the denied system fact).
    #[test]
    fn request_decisions_settle_the_boolean_terminal_and_snapshots() {
        for (granted, expected) in [
            (true, AuthorizationStatus::Granted),
            (false, AuthorizationStatus::Denied),
        ] {
            let mut rig = Rig::new();
            rig.engine
                .begin(
                    81,
                    scope("session-1"),
                    AuthKind::Request,
                    AuthQuery::Request,
                    rig.token(81),
                    &rig.channel,
                    &rig.executor,
                )
                .expect("begin");
            assert_eq!(
                rig.channel.queries.borrow().last().copied(),
                Some(AuthQuery::Request)
            );
            rig.deliver_outcome(81, AuthOutcome::Decision(granted));

            assert_eq!(rig.sink.terminals.len(), 1);
            match &rig.sink.terminals[0].1 {
                ExtOperationPayload::Result { value } => assert_eq!(
                    value,
                    &serde_json::json!({ "type": "authorizationDecision", "granted": granted })
                ),
                other => panic!("decision outcome is a result terminal: {other:?}"),
            }
            assert_eq!(
                rig.engine.snapshot(&scope("session-1")).unwrap().status,
                expected
            );
        }
    }

    /// The never-callback family member: only the armed timeout drains —
    /// typed `notification_failed` / `authorization-timeout`, and the
    /// timeout carries NO authorization fact (the snapshot cache stays
    /// untouched).
    #[test]
    fn never_callback_times_out_typed_without_poisoning_the_snapshot() {
        let mut rig = Rig::new();
        rig.begin_status(91);
        let (hops, timeouts) = rig.executor.queued();
        assert_eq!(
            (hops, timeouts),
            (0, 1),
            "no callback yet, one armed timeout"
        );
        rig.deliver_timeout(91);

        assert_eq!(rig.sink.terminals.len(), 1);
        match &rig.sink.terminals[0].1 {
            ExtOperationPayload::Error { error } => {
                assert_eq!(error.code, options::error_code::FAILED);
                assert_eq!(
                    error.details.as_ref().unwrap()["reason"],
                    options::REASON_AUTHORIZATION_TIMEOUT
                );
            }
            other => panic!("timeout is the typed error terminal: {other:?}"),
        }
        assert!(
            rig.engine.snapshot(&scope("session-1")).is_none(),
            "a timeout is not an authorization fact"
        );
        assert_eq!(rig.post.posts.len(), 0);
    }

    /// The one-shot CAS law across the race orders: outcome-first then a
    /// stale timeout, and timeout-first then a stale outcome — exactly
    /// one terminal in both orders.
    #[test]
    fn outcome_and_timeout_race_produces_exactly_one_terminal_in_both_orders() {
        // Outcome first.
        let mut rig = Rig::new();
        rig.begin_status(101);
        rig.deliver_outcome(101, AuthOutcome::Status(AuthorizationStatus::Granted));
        rig.deliver_loser(101, AuthEvent::Timeout); // The stale loser.
        assert_eq!(rig.sink.terminals.len(), 1);
        assert!(
            matches!(&rig.sink.terminals[0].1, ExtOperationPayload::Result { .. }),
            "the outcome won"
        );

        // Timeout first.
        let mut rig = Rig::new();
        rig.begin_status(102);
        rig.deliver_timeout(102);
        rig.deliver_loser(
            102,
            AuthEvent::Outcome(AuthOutcome::Status(AuthorizationStatus::Denied)),
        );
        assert_eq!(rig.sink.terminals.len(), 1);
        assert!(
            matches!(&rig.sink.terminals[0].1, ExtOperationPayload::Error { .. }),
            "the timeout won"
        );
        // The stale denied outcome must not write a snapshot either.
        assert!(rig.engine.snapshot(&scope("session-1")).is_none());
    }

    /// The delayed family member: begin arms exactly one timeout and no
    /// callback; nothing settles while the owner loop is busy; the first
    /// delivery wins and the stale armed timeout is a stateless no-op.
    /// (The QUEUED-hop drain route runs end-to-end in the lib.rs
    /// full-stack suite through the real `hop_outcome` path.)
    #[test]
    fn nothing_settles_until_the_owner_loop_delivers() {
        let mut rig = Rig::new();
        rig.begin_status(111);
        assert_eq!(
            rig.executor.queued(),
            (0, 1),
            "no callback yet; one armed timeout"
        );
        assert!(rig.sink.terminals.is_empty());
        assert_eq!(rig.engine.active_count(), 1);
        rig.deliver_outcome(111, AuthOutcome::Status(AuthorizationStatus::Granted));
        assert_eq!(rig.sink.terminals.len(), 1);
        assert_eq!(rig.engine.active_count(), 0);
        // The stale armed timeout eventually fires: the CAS rejects it.
        rig.deliver_loser(111, AuthEvent::Timeout);
        assert_eq!(rig.sink.terminals.len(), 1);
    }

    /// Session close revokes an in-flight transaction with the
    /// cancel-branch terminal exactly once; a second close, a late
    /// outcome, and a late timeout are all stateless; the session's
    /// snapshots are removed while another session's survive.
    #[test]
    fn session_close_cancels_in_flight_exactly_once_and_scopes_snapshots() {
        let mut rig = Rig::new();
        // Snapshot owned by the closing session + one by another session.
        rig.engine
            .seed_snapshot(&scope("session-1"), AuthorizationStatus::Granted, "seed");
        rig.engine
            .seed_snapshot(&scope("session-2"), AuthorizationStatus::Granted, "seed");
        rig.begin_status(121); // session-1 transaction
        rig.engine
            .begin(
                122,
                scope("session-2"),
                AuthKind::Status,
                AuthQuery::Status,
                rig.token(122),
                &rig.channel,
                &rig.executor,
            )
            .expect("begin");

        let settled = {
            let mut sink = SinkSpy {
                terminals: Vec::new(),
            };
            let settled = rig.engine.revoke_session("session-1", &mut sink);
            rig.sink.terminals.extend(sink.terminals);
            settled
        };
        assert_eq!(settled, vec![121]);
        assert_eq!(rig.sink.terminals.len(), 1);
        match &rig.sink.terminals[0].1 {
            ExtOperationPayload::Error { error } => {
                assert_eq!(error.code, options::error_code::FAILED);
                assert_eq!(
                    error.details.as_ref().unwrap()["reason"],
                    options::REASON_AUTHORIZATION_SESSION_CLOSED
                );
            }
            other => panic!("session close is the cancel branch: {other:?}"),
        }

        // Second close: nothing left to settle (exactly-once).
        {
            let mut sink = SinkSpy {
                terminals: Vec::new(),
            };
            let settled = rig.engine.revoke_session("session-1", &mut sink);
            assert!(settled.is_empty());
            assert!(sink.terminals.is_empty());
        }
        // The late outcome and the armed timeout for the revoked handle
        // are stateless no-ops.
        rig.deliver_loser(
            121,
            AuthEvent::Outcome(AuthOutcome::Status(AuthorizationStatus::Denied)),
        );
        rig.deliver_loser(121, AuthEvent::Timeout);
        assert_eq!(rig.sink.terminals.len(), 1);
        // Snapshot scoping: session-1's snapshot is gone, session-2's
        // survives (and its transaction is untouched).
        assert!(rig.engine.snapshot(&scope("session-1")).is_none());
        assert!(rig.engine.snapshot(&scope("session-2")).is_some());
        assert_eq!(rig.engine.active_count(), 1);
    }

    /// The notify-preflight family: denied → typed notification_denied
    /// with ZERO posts (the zero-post law); granted/notDetermined → post
    /// then acceptance terminal; post failure → the typed error terminal;
    /// timeout → typed timeout with zero posts.
    #[test]
    fn notify_preflight_denies_with_zero_posts_and_posts_on_grant() {
        let content = || NotifyContent {
            title: "Build finished".to_string(),
            body: Some("all green".to_string()),
            subtitle: Some("ci".to_string()),
            silent: None,
        };

        // denied: typed rejection, ZERO native posts.
        let mut rig = Rig::new();
        rig.engine
            .begin(
                131,
                scope("session-1"),
                AuthKind::NotifyPreflight { content: content() },
                AuthQuery::Status,
                rig.token(131),
                &rig.channel,
                &rig.executor,
            )
            .expect("begin");
        rig.deliver_outcome(131, AuthOutcome::Status(AuthorizationStatus::Denied));
        assert_eq!(rig.post.posts.len(), 0, "denied means ZERO post calls");
        assert_eq!(rig.sink.terminals.len(), 1);
        match &rig.sink.terminals[0].1 {
            ExtOperationPayload::Error { error } => {
                assert_eq!(error.code, options::error_code::DENIED);
                assert_eq!(error.details.as_ref().unwrap()["status"], "denied");
                assert!(
                    error.message.contains("snapshot"),
                    "the rejection names the snapshot provenance"
                );
            }
            other => panic!("denied preflight is the typed error terminal: {other:?}"),
        }
        assert_eq!(
            rig.engine.snapshot(&scope("session-1")).unwrap().status,
            AuthorizationStatus::Denied
        );

        // granted: post first, then the acceptance terminal.
        let mut rig = Rig::new();
        rig.engine
            .begin(
                132,
                scope("session-1"),
                AuthKind::NotifyPreflight { content: content() },
                AuthQuery::Status,
                rig.token(132),
                &rig.channel,
                &rig.executor,
            )
            .expect("begin");
        rig.deliver_outcome(132, AuthOutcome::Status(AuthorizationStatus::Granted));
        assert_eq!(rig.post.posts.len(), 1, "granted posts exactly once");
        assert_eq!(rig.post.posts[0].title, "Build finished");
        match &rig.sink.terminals[0].1 {
            ExtOperationPayload::Result { value } => {
                assert_eq!(
                    value,
                    &serde_json::json!({ "type": "result", "op": "notify" })
                )
            }
            other => panic!("granted preflight is the acceptance terminal: {other:?}"),
        }

        // notDetermined: also posts (the system presents the implicit
        // authorization prompt — documented darwin behavior).
        let mut rig = Rig::new();
        rig.engine
            .begin(
                133,
                scope("session-1"),
                AuthKind::NotifyPreflight { content: content() },
                AuthQuery::Status,
                rig.token(133),
                &rig.channel,
                &rig.executor,
            )
            .expect("begin");
        rig.deliver_outcome(133, AuthOutcome::Status(AuthorizationStatus::NotDetermined));
        assert_eq!(rig.post.posts.len(), 1);

        // post failure: the typed post error replaces the ok terminal.
        let mut rig = Rig::new();
        rig.post.result = Err(options::platform_unsupported_error());
        rig.engine
            .begin(
                134,
                scope("session-1"),
                AuthKind::NotifyPreflight { content: content() },
                AuthQuery::Status,
                rig.token(134),
                &rig.channel,
                &rig.executor,
            )
            .expect("begin");
        rig.deliver_outcome(134, AuthOutcome::Status(AuthorizationStatus::Granted));
        assert_eq!(rig.post.posts.len(), 1, "the post was attempted");
        match &rig.sink.terminals[0].1 {
            ExtOperationPayload::Error { error } => {
                assert_eq!(error.code, options::error_code::PLATFORM_UNSUPPORTED)
            }
            other => panic!("a failed post is the typed error terminal: {other:?}"),
        }

        // timeout before any outcome: zero posts.
        let mut rig = Rig::new();
        rig.engine
            .begin(
                135,
                scope("session-1"),
                AuthKind::NotifyPreflight { content: content() },
                AuthQuery::Status,
                rig.token(135),
                &rig.channel,
                &rig.executor,
            )
            .expect("begin");
        rig.deliver_timeout(135);
        assert_eq!(rig.post.posts.len(), 0, "timeout means zero posts");
        match &rig.sink.terminals[0].1 {
            ExtOperationPayload::Error { error } => {
                assert_eq!(
                    error.details.as_ref().unwrap()["reason"],
                    options::REASON_AUTHORIZATION_TIMEOUT
                )
            }
            other => panic!("timeout preflight is the typed timeout terminal: {other:?}"),
        }
    }

    /// The notify immediate law (design section 4): the cached snapshot
    /// decides in one frame — denied → typed rejection with ZERO posts;
    /// granted/notDetermined → one post; missing → defer with zero posts.
    #[test]
    fn immediate_notify_linearizes_on_the_snapshot_with_zero_posts_on_denial() {
        let content = NotifyContent {
            title: "t".to_string(),
            body: None,
            subtitle: None,
            silent: Some(true),
        };

        // denied snapshot: typed rejection, ZERO post calls.
        let mut post = SpyPost::accepting();
        let snapshot = AuthSnapshot {
            status: AuthorizationStatus::Denied,
            provenance: "requestAuthorization",
        };
        match immediate_notify_transaction(Some(&snapshot), &content, &mut post) {
            NotifyImmediate::Denied(error) => {
                assert_eq!(error.code, options::error_code::DENIED);
                assert_eq!(error.details.as_ref().unwrap()["status"], "denied");
                assert_eq!(
                    error.details.as_ref().unwrap()["snapshotSource"],
                    "requestAuthorization"
                );
            }
            other => panic!("denied snapshot is the typed rejection: {other:?}"),
        }
        assert!(
            post.posts.is_empty(),
            "denied: the post sink was never called"
        );

        // granted snapshot: one post, the acceptance value.
        let mut post = SpyPost::accepting();
        let snapshot = AuthSnapshot {
            status: AuthorizationStatus::Granted,
            provenance: "getAuthorizationStatus",
        };
        match immediate_notify_transaction(Some(&snapshot), &content, &mut post) {
            NotifyImmediate::Posted(Ok(value)) => {
                assert_eq!(
                    value,
                    serde_json::json!({ "type": "result", "op": "notify" })
                )
            }
            other => panic!("granted snapshot posts: {other:?}"),
        }
        assert_eq!(post.posts.len(), 1);

        // notDetermined snapshot: posts too (implicit system prompt).
        let snapshot = AuthSnapshot {
            status: AuthorizationStatus::NotDetermined,
            provenance: "getAuthorizationStatus",
        };
        let mut post = SpyPost::accepting();
        assert!(matches!(
            immediate_notify_transaction(Some(&snapshot), &content, &mut post),
            NotifyImmediate::Posted(Ok(_))
        ));
        assert_eq!(post.posts.len(), 1);

        // no snapshot: defer, zero posts.
        let mut post = SpyPost::accepting();
        assert!(matches!(
            immediate_notify_transaction(None, &content, &mut post),
            NotifyImmediate::DeferPreflight
        ));
        assert!(post.posts.is_empty());

        // post failure surfaces the typed rejection.
        let mut post = SpyPost {
            posts: Vec::new(),
            result: Err(options::platform_unsupported_error()),
        };
        let snapshot = AuthSnapshot {
            status: AuthorizationStatus::Granted,
            provenance: "getAuthorizationStatus",
        };
        match immediate_notify_transaction(Some(&snapshot), &content, &mut post) {
            NotifyImmediate::Posted(Err(error)) => {
                assert_eq!(error.code, options::error_code::PLATFORM_UNSUPPORTED)
            }
            other => panic!("a failed post is the typed rejection: {other:?}"),
        }
    }

    /// An unknown handle (never registered, already settled, or forged)
    /// is a stateless no-op on every deliver path.
    #[test]
    fn unknown_handles_are_stateless_no_ops() {
        let mut rig = Rig::new();
        rig.begin_status(151);
        let settled = rig.engine.deliver(
            0xDEAD_BEEF,
            AuthEvent::Outcome(AuthOutcome::Status(AuthorizationStatus::Granted)),
            &mut rig.sink,
            &mut rig.post,
        );
        assert!(settled.is_none());
        assert!(rig.sink.terminals.is_empty());
        assert_eq!(
            rig.engine.active_count(),
            1,
            "the live transaction is untouched"
        );
        // Same for a replayed handle after its settlement.
        rig.deliver_outcome(151, AuthOutcome::Status(AuthorizationStatus::Denied));
        assert!(rig
            .engine
            .deliver(151, AuthEvent::Timeout, &mut rig.sink, &mut rig.post)
            .is_none());
        assert_eq!(rig.sink.terminals.len(), 1);
    }

    /// A failed query start rolls the registration back: pre-Accept, no
    /// transaction survives (the command rejects synchronously instead).
    #[test]
    fn failed_query_start_rolls_back_the_registration() {
        let mut rig = Rig::new();
        let channel = FakeChannel {
            queries: std::cell::RefCell::new(Vec::new()),
            fail_start: true,
        };
        let result = rig.engine.begin(
            161,
            scope("session-1"),
            AuthKind::Status,
            AuthQuery::Status,
            rig.token(161),
            &channel,
            &rig.executor,
        );
        assert!(result.is_err());
        assert_eq!(rig.engine.active_count(), 0, "no transaction survived");
        let (hops, timeouts) = rig.executor.queued();
        assert_eq!((hops, timeouts), (0, 0), "no timeout was armed either");
    }

    /// Mapped failures and reply-shape mismatches settle as honest typed
    /// errors (never guessed statuses, never drops).
    #[test]
    fn failures_and_mismatched_replies_settle_typed() {
        // A mapped failure (e.g. an unrecognized raw status).
        let mut rig = Rig::new();
        rig.begin_status(171);
        rig.deliver_outcome(
            171,
            AuthOutcome::Failed(TypedExtensionError {
                code: options::error_code::FAILED.to_string(),
                message: "unrecognized".to_string(),
                details: Some(serde_json::json!({ "reason": "authorization-status-unreadable" })),
            }),
        );
        match &rig.sink.terminals[0].1 {
            ExtOperationPayload::Error { error } => {
                assert_eq!(error.code, options::error_code::FAILED)
            }
            other => panic!("mapped failures are typed error terminals: {other:?}"),
        }
        // The failure does NOT write a snapshot.
        assert!(rig.engine.snapshot(&scope("session-1")).is_none());

        // A decision reply arriving on a status transaction: the honest
        // mismatch error.
        let mut rig = Rig::new();
        rig.begin_status(172);
        rig.deliver_outcome(172, AuthOutcome::Decision(true));
        match &rig.sink.terminals[0].1 {
            ExtOperationPayload::Error { error } => {
                assert_eq!(error.code, options::error_code::FAILED);
                assert_eq!(
                    error.details.as_ref().unwrap()["reason"],
                    "authorization-reply-mismatch"
                );
            }
            other => panic!("mismatch is the typed error terminal: {other:?}"),
        }
    }
}
