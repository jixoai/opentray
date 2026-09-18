//! win32 clipboard discipline core (add-ext-clipboard task 3.2).
//!
//! Orthogonal intents (maintained 2026-09-18; original user requests: OS
//! clipboard text atoms with the frozen win32 lock-contention and HGLOBAL
//! ownership laws, host-testable through seams):
//! 1. The bounded `OpenClipboard` retry discipline is frozen (design
//!    section 2): a monotonic `Instant` deadline of 2000 ms from command
//!    dispatch, retries ONLY on `ACCESS_DENIED`, the backoff ladder
//!    10->20->40->80->160->200 ms capped (constant 200 ms afterwards),
//!    every sleep trimmed to the remaining budget, exhaustion into the
//!    typed `clipboard_locked` terminal with `attempts`/`elapsedMs`.
//! 2. The HGLOBAL ownership law is frozen (design section 2): a write
//!    allocates, hands the handle to `SetClipboardData` (success = the
//!    system owns it, NEVER freed) and reclaims every
//!    allocated-but-unhanded handle on any failure; a read treats the
//!    `GetClipboardData` handle as board-owned (lock-copy-unlock before
//!    close, never freed, never touched after close).
//! 3. `Open -> operation -> Close` closes inside one command; the handle
//!    never crosses commands (design section 4).
//!
//! Compromise: the flows and the retry driver are seam-driven
//! (`WinClipboard` + `RetryClock`) so spy tests run on every host; the
//! real user32/kernel32 surface lives in `native.rs` and compiles only on
//! Windows targets.

use std::time::{Duration, Instant};

use opentray_spec::TypedExtensionError;

use crate::options;

// The real user32/kernel32 seam implementation (static imports); the flows
// and spies in this module stay host-testable.
#[cfg(target_os = "windows")]
pub(crate) mod native;

/// Frozen total open budget (design section 2): 2000 ms from command
/// dispatch, `Instant`-based (monotonic).
pub(crate) const OPEN_RETRY_BUDGET_MS: u64 = 2000;

/// The frozen backoff ladder step (design section 2): 10->20->40->80->160
/// ms, capped at 200 ms from the sixth sleep on (constant afterwards).
pub(crate) fn backoff_delay(step: u32) -> Duration {
    match step {
        0 => Duration::from_millis(10),
        1 => Duration::from_millis(20),
        2 => Duration::from_millis(40),
        3 => Duration::from_millis(80),
        4 => Duration::from_millis(160),
        _ => Duration::from_millis(200),
    }
}

/// Injectable clock seam: monotonic now plus a sleep primitive. Production
/// uses the thread clock; spy tests use a virtual clock to assert the
/// exact ladder and trimming without real waiting.
pub(crate) trait RetryClock {
    fn now(&self) -> Instant;
    fn sleep(&self, duration: Duration);
}

/// Opaque extension-side global-memory id. The real Windows type is an
/// `HGLOBAL`; the id keeps the flow law testable on any host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GlobalMem(usize);

impl GlobalMem {
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub(crate) fn new(id: usize) -> Self {
        Self(id)
    }

    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    pub(crate) fn id(self) -> usize {
        self.0
    }
}

/// `OpenClipboard(NULL)` outcome: acquired, denied by another holder
/// (`ERROR_ACCESS_DENIED`), or failed with another OS error code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OpenOutcome {
    Opened,
    Denied,
    Failed(u32),
}

/// `GetClipboardData(CF_UNICODETEXT)` outcome: a board-owned handle, NULL
/// with `ERROR_SUCCESS` (no text on the board), or NULL with another last
/// error (design section 1 NULL discrimination).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum GetDataOutcome {
    Handle(GlobalMem),
    NullNoData,
    NullFailed(u32),
}

/// The win32 clipboard API seam. Ownership protocol (frozen law):
/// `alloc` returns an EXTENSION-owned handle; `set_data` success transfers
/// ownership to the system (the caller must never free it afterwards);
/// `get_data` handles stay BOARD-owned (lock-copy-unlock only, never
/// freed); `free` is `GlobalFree` and may only be called on
/// extension-owned, un-handed-off handles.
pub(crate) trait WinClipboard {
    fn open(&mut self) -> OpenOutcome;
    fn close(&mut self) -> Result<(), u32>;
    fn empty(&mut self) -> Result<(), u32>;
    fn alloc(&mut self, units: &[u16]) -> Result<GlobalMem, u32>;
    fn set_data(&mut self, mem: GlobalMem) -> Result<(), u32>;
    fn get_data(&mut self) -> GetDataOutcome;
    /// `GlobalLock` + copy `GlobalSize` units + `GlobalUnlock`.
    fn lock_copy_unlock(&mut self, mem: GlobalMem) -> Result<Vec<u16>, u32>;
    fn free(&mut self, mem: GlobalMem);
}

/// Applies the frozen bounded-open discipline. `Ok(())` = the clipboard is
/// open on this api (the caller owns closing it); `Err` = the typed
/// terminal (`clipboard_locked` with attempts counting the first attempt
/// and elapsedMs including native call time, or `clipboard_unavailable`
/// for any non-ACCESS_DENIED open failure — never retried).
pub(crate) fn open_bounded<T: WinClipboard, C: RetryClock>(
    api: &mut T,
    clock: &C,
) -> Result<(), TypedExtensionError> {
    let started = clock.now();
    let deadline = started + Duration::from_millis(OPEN_RETRY_BUDGET_MS);
    let mut attempts = 0u32;
    let mut step = 0u32;
    loop {
        attempts += 1;
        match api.open() {
            OpenOutcome::Opened => return Ok(()),
            OpenOutcome::Failed(code) => {
                // Only ACCESS_DENIED retries (frozen); any other error is the
                // immediate typed unavailable rejection.
                return Err(options::unavailable_error(code, "OpenClipboard"));
            }
            OpenOutcome::Denied => {
                let remaining = deadline.saturating_duration_since(clock.now());
                if remaining.is_zero() {
                    // Budget exhausted (or the next retry has no executable
                    // room): the frozen typed terminal.
                    let elapsed_ms = clock.now().duration_since(started).as_millis();
                    return Err(options::locked_error(attempts, elapsed_ms));
                }
                // Never sleep past the deadline: trim to the remaining budget.
                let desired = backoff_delay(step);
                step += 1;
                clock.sleep(desired.min(remaining));
            }
        }
    }
}

/// Write flow (design section 2): alloc -> bounded open -> EmptyClipboard
/// -> SetClipboardData -> CloseClipboard. On `SetClipboardData` success the
/// system owns the handle (never freed — a double-free-class error); any
/// failure before the handoff reclaims the handle through `free` before
/// the typed rejection surfaces.
pub(crate) fn flow_write_text<T: WinClipboard, C: RetryClock>(
    api: &mut T,
    clock: &C,
    units: &[u16],
) -> Result<(), TypedExtensionError> {
    let mem = api
        .alloc(units)
        .map_err(|code| options::unavailable_error(code, "GlobalAlloc"))?;
    if let Err(error) = open_bounded(api, clock) {
        // The open discipline failed: reclaim the un-handed-off handle (the
        // clipboard was never opened — no close).
        api.free(mem);
        return Err(error);
    }
    let mut handed_off = false;
    let operation: Result<(), TypedExtensionError> = match api
        .empty()
        .map_err(|code| options::unavailable_error(code, "EmptyClipboard"))
    {
        Err(error) => Err(error),
        Ok(()) => match api.set_data(mem) {
            Ok(()) => {
                // Ownership transferred to the system: from here the handle
                // is never freed, even if a later step fails.
                handed_off = true;
                Ok(())
            }
            Err(code) => Err(options::unavailable_error(code, "SetClipboardData")),
        },
    };
    // The command closes inside itself (design section 4 law): never hold
    // the clipboard handle across commands, whatever the operation outcome.
    let closed = api.close();
    let outcome = operation
        .and_then(|()| closed.map_err(|code| options::unavailable_error(code, "CloseClipboard")));
    if outcome.is_err() && !handed_off {
        // Frozen law: reclaim every allocated-but-unhanded HGLOBAL before
        // the typed rejection surfaces (including the EmptyClipboard and
        // SetClipboardData failure paths).
        api.free(mem);
    }
    outcome
}

/// Read flow (design section 2): bounded open -> GetClipboardData ->
/// lock-copy-unlock -> CloseClipboard -> decode. NULL+ERROR_SUCCESS reads
/// as `None` (the first-class empty state); the board-owned handle is
/// never freed and never touched after close; the deep copy is the only
/// retained memory.
pub(crate) fn flow_read_text<T: WinClipboard, C: RetryClock>(
    api: &mut T,
    clock: &C,
) -> Result<Option<String>, TypedExtensionError> {
    open_bounded(api, clock)?;
    // Copy-out under the open handle: lock-copy-unlock BEFORE close; the
    // decode happens after the handle is released.
    let copied: Result<Option<Vec<u16>>, TypedExtensionError> = match api.get_data() {
        GetDataOutcome::NullNoData => Ok(None),
        GetDataOutcome::NullFailed(code) => {
            Err(options::unavailable_error(code, "GetClipboardData"))
        }
        GetDataOutcome::Handle(mem) => api
            .lock_copy_unlock(mem)
            .map_err(|code| options::unavailable_error(code, "GlobalLock/GlobalSize"))
            .map(Some),
    };
    let closed = api.close();
    let units = copied.and_then(|units| {
        closed
            .map_err(|code| options::unavailable_error(code, "CloseClipboard"))
            .map(|()| units)
    })?;
    match units {
        None => Ok(None),
        Some(units) => options::decode_board_units(&units).map(Some),
    }
}

/// Clear flow (design section 2): bounded open -> EmptyClipboard ->
/// CloseClipboard. Deliberately distinct from an empty-string write (which
/// delivers bytes through SetClipboardData).
pub(crate) fn flow_clear<T: WinClipboard, C: RetryClock>(
    api: &mut T,
    clock: &C,
) -> Result<(), TypedExtensionError> {
    open_bounded(api, clock)?;
    let emptied = api
        .empty()
        .map_err(|code| options::unavailable_error(code, "EmptyClipboard"));
    // Close inside the command even when EmptyClipboard failed.
    let closed = api.close();
    emptied.and_then(|()| closed.map_err(|code| options::unavailable_error(code, "CloseClipboard")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    // -------------------------------------------------------------------------
    // Spy seam (design section 5: injectable open-failure sequences and a
    // virtual clock; asserts the exact ladder, trimming, retry gate, typed
    // terminals, and HGLOBAL ownership across all three flows).
    // -------------------------------------------------------------------------

    #[derive(Default)]
    struct SpyState {
        trace: Vec<String>,
        freed: Vec<usize>,
        allocated: Vec<usize>,
    }

    #[derive(Clone, Default)]
    struct FakeClockState {
        inner: Rc<RefCell<FakeInner>>,
    }

    #[derive(Default)]
    struct FakeInner {
        now: Option<Instant>,
        sleeps: Vec<Duration>,
        /// Virtual time each scripted DENIED open consumes (native call time
        /// must count inside the budget — design section 2).
        denied_open_cost: Duration,
    }

    struct FakeClock(FakeClockState);

    impl FakeClockState {
        fn new() -> Self {
            Self::default()
        }

        fn with_denied_open_cost(cost: Duration) -> Self {
            let state = Self::new();
            state.inner.borrow_mut().denied_open_cost = cost;
            state
        }

        fn now(&self) -> Instant {
            self.inner.borrow().now.unwrap_or_else(Instant::now)
        }

        fn advance(&self, duration: Duration) {
            let mut inner = self.inner.borrow_mut();
            let base = inner.now.unwrap_or_else(Instant::now);
            inner.now = Some(base + duration);
        }

        fn sleeps(&self) -> Vec<Duration> {
            self.inner.borrow().sleeps.clone()
        }
    }

    impl RetryClock for FakeClock {
        fn now(&self) -> Instant {
            self.0.now()
        }

        fn sleep(&self, duration: Duration) {
            let mut inner = self.0.inner.borrow_mut();
            inner.sleeps.push(duration);
            let base = inner.now.unwrap_or_else(Instant::now);
            inner.now = Some(base + duration);
        }
    }

    struct SpyClipboard {
        opens: Vec<OpenOutcome>,
        empty_result: Result<(), u32>,
        set_data_result: Result<(), u32>,
        get_data: GetDataOutcome,
        lock_units: Vec<u16>,
        lock_result: Result<(), u32>,
        close_result: Result<(), u32>,
        alloc_result: Result<(), u32>,
        clock: FakeClockState,
        state: Rc<RefCell<SpyState>>,
    }

    impl SpyClipboard {
        fn new() -> Self {
            Self {
                opens: Vec::new(),
                empty_result: Ok(()),
                set_data_result: Ok(()),
                get_data: GetDataOutcome::NullNoData,
                lock_units: Vec::new(),
                lock_result: Ok(()),
                close_result: Ok(()),
                alloc_result: Ok(()),
                clock: FakeClockState::new(),
                state: Rc::new(RefCell::new(SpyState::default())),
            }
        }

        fn opens(mut self, opens: Vec<OpenOutcome>) -> Self {
            self.opens = opens;
            self
        }

        fn set_data_fails(mut self, code: u32) -> Self {
            self.set_data_result = Err(code);
            self
        }

        fn empty_fails(mut self, code: u32) -> Self {
            self.empty_result = Err(code);
            self
        }

        fn close_fails(mut self, code: u32) -> Self {
            self.close_result = Err(code);
            self
        }

        fn get_data_handle(mut self, units: &[u16]) -> Self {
            self.get_data = GetDataOutcome::Handle(GlobalMem::new(0xAA));
            self.lock_units = units.to_vec();
            self
        }

        fn get_data_null_failed(mut self, code: u32) -> Self {
            self.get_data = GetDataOutcome::NullFailed(code);
            self
        }

        fn with_clock(mut self, clock: FakeClockState) -> Self {
            self.clock = clock;
            self
        }

        fn shared_state(&self) -> Rc<RefCell<SpyState>> {
            self.state.clone()
        }

        /// A clock bound to the SAME state the spy advances (denied-open
        /// native cost), so flows and assertions observe one timeline.
        fn run_clock(&self) -> FakeClock {
            FakeClock(self.clock.clone())
        }

        fn sleeps(&self) -> Vec<Duration> {
            self.clock.sleeps()
        }

        fn trace(&self) -> Vec<String> {
            self.state.borrow().trace.clone()
        }
    }

    impl WinClipboard for SpyClipboard {
        fn open(&mut self) -> OpenOutcome {
            let outcome = if self.opens.is_empty() {
                OpenOutcome::Opened
            } else {
                self.opens.remove(0)
            };
            self.state.borrow_mut().trace.push(match outcome {
                OpenOutcome::Opened => "open:opened".to_string(),
                OpenOutcome::Denied => "open:denied".to_string(),
                OpenOutcome::Failed(code) => format!("open:failed({code})"),
            });
            if outcome == OpenOutcome::Denied {
                let cost = self.clock.inner.borrow().denied_open_cost;
                if cost > Duration::ZERO {
                    self.clock.advance(cost);
                }
            }
            outcome
        }

        fn close(&mut self) -> Result<(), u32> {
            self.state.borrow_mut().trace.push("close".to_string());
            self.close_result
        }

        fn empty(&mut self) -> Result<(), u32> {
            self.state.borrow_mut().trace.push("empty".to_string());
            self.empty_result
        }

        fn alloc(&mut self, units: &[u16]) -> Result<GlobalMem, u32> {
            let id = 0x10 + self.state.borrow().allocated.len();
            let mut state = self.state.borrow_mut();
            state.trace.push(format!("alloc({id}, {}u)", units.len()));
            state.allocated.push(id);
            match self.alloc_result {
                Ok(()) => Ok(GlobalMem::new(id)),
                Err(code) => Err(code),
            }
        }

        fn set_data(&mut self, mem: GlobalMem) -> Result<(), u32> {
            self.state
                .borrow_mut()
                .trace
                .push(format!("set({})", mem.id()));
            self.set_data_result
        }

        fn get_data(&mut self) -> GetDataOutcome {
            let label = match &self.get_data {
                GetDataOutcome::Handle(_) => "get:handle".to_string(),
                GetDataOutcome::NullNoData => "get:null-no-data".to_string(),
                GetDataOutcome::NullFailed(code) => format!("get:null-failed({code})"),
            };
            self.state.borrow_mut().trace.push(label);
            self.get_data.clone()
        }

        fn lock_copy_unlock(&mut self, mem: GlobalMem) -> Result<Vec<u16>, u32> {
            self.state
                .borrow_mut()
                .trace
                .push(format!("lock-copy-unlock({})", mem.id()));
            match self.lock_result {
                Ok(()) => Ok(self.lock_units.clone()),
                Err(code) => Err(code),
            }
        }

        fn free(&mut self, mem: GlobalMem) {
            self.state
                .borrow_mut()
                .trace
                .push(format!("free({})", mem.id()));
            self.state.borrow_mut().freed.push(mem.id());
        }
    }

    fn units(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Sleep assertions at rounded-millisecond granularity: trimmed sleeps
    /// derive from Instant subtraction, which quantizes to the platform
    /// tick (about 42 ns on darwin) and can land a few microseconds under
    /// the exact value (89.998959 ms for a 90 ms remainder).
    fn millis(durations: &[Duration]) -> Vec<u128> {
        durations
            .iter()
            .map(|duration| (duration.as_secs_f64() * 1000.0).round() as u128)
            .collect()
    }

    /// The frozen ladder: 10->20->40->80->160, capped at 200 afterwards.
    #[test]
    fn backoff_ladder_is_frozen() {
        let expected = [10, 20, 40, 80, 160, 200, 200, 200, 200, 200, 200, 200, 200];
        for (step, millis) in expected.iter().enumerate() {
            assert_eq!(backoff_delay(step as u32), Duration::from_millis(*millis));
        }
        assert_eq!(OPEN_RETRY_BUDGET_MS, 2000);
    }

    #[test]
    fn a_first_open_success_never_sleeps() {
        let mut api = SpyClipboard::new();
        let clock = api.run_clock();
        let state = api.shared_state();
        let result = flow_clear(&mut api, &clock);
        assert_eq!(result, Ok(()));
        assert_eq!(api.sleeps(), Vec::<Duration>::new());
        assert_eq!(state.borrow().trace, vec!["open:opened", "empty", "close"]);
    }

    /// Contention then success within the budget resolves normally with the
    /// exact frozen trajectory (spec scenario).
    #[test]
    fn denied_then_success_follows_the_ladder() {
        let mut api = SpyClipboard::new().opens(vec![
            OpenOutcome::Denied,
            OpenOutcome::Denied,
            OpenOutcome::Opened,
        ]);
        let clock = api.run_clock();
        let state = api.shared_state();
        let result = flow_clear(&mut api, &clock);
        assert_eq!(result, Ok(()));
        assert_eq!(millis(&api.sleeps()), vec![10, 20]);
        assert_eq!(
            state.borrow().trace,
            vec![
                "open:denied",
                "open:denied",
                "open:opened",
                "empty",
                "close"
            ]
        );
    }

    /// Persistent lock exhausts into the typed terminal (spec scenario):
    /// sleeps walk the whole ladder with the final sleep trimmed to the
    /// 90 ms remainder; attempts count every real open including the
    /// first; elapsedMs spans native time to typed-error construction.
    #[test]
    fn persistent_denial_exhausts_the_budget_into_typed_locked() {
        let mut api = SpyClipboard::new();
        api.opens = vec![OpenOutcome::Denied; 64];
        let clock = api.run_clock();
        let error = flow_clear(&mut api, &clock).unwrap_err();
        assert_eq!(error.code, options::error_code::LOCKED);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "attempts": 15, "elapsedMs": 2000 })
        );
        let mut expected: Vec<Duration> = [10u64, 20, 40, 80, 160]
            .iter()
            .map(|ms| Duration::from_millis(*ms))
            .collect();
        for _ in 0..8 {
            expected.push(Duration::from_millis(200));
        }
        // The last sleep is trimmed: 90 ms remain when the ladder wants 200.
        expected.push(Duration::from_millis(90));
        assert_eq!(millis(&api.sleeps()), millis(&expected));
        // 14 sleeps + the first attempt = 15 opens recorded in the trace.
        assert_eq!(
            api.trace()
                .iter()
                .filter(|entry| *entry == "open:denied")
                .count(),
            15
        );
        // The lock terminal is typed: empty/close never ran.
        assert!(!api
            .trace()
            .iter()
            .any(|entry| entry == "empty" || entry == "close"));
    }

    /// A non-ACCESS_DENIED open failure never retries (spec scenario) and
    /// carries the OS error code.
    #[test]
    fn non_access_denied_failures_reject_immediately_with_the_os_error_code() {
        let mut api = SpyClipboard::new().opens(vec![OpenOutcome::Failed(6)]);
        let clock = api.run_clock();
        let error = flow_read_text(&mut api, &clock).unwrap_err();
        assert_eq!(error.code, options::error_code::UNAVAILABLE);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "osErrorCode": 6 })
        );
        assert_eq!(api.sleeps(), Vec::<Duration>::new());
        assert_eq!(api.trace(), vec!["open:failed(6)"]);

        // ACCESS_DENIED retries, but a later different error still surfaces
        // the unavailable code with zero further retries.
        let mut api = SpyClipboard::new().opens(vec![OpenOutcome::Denied, OpenOutcome::Failed(87)]);
        let clock = api.run_clock();
        let error = flow_clear(&mut api, &clock).unwrap_err();
        assert_eq!(error.code, options::error_code::UNAVAILABLE);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "osErrorCode": 87 })
        );
        assert_eq!(api.sleeps(), vec![Duration::from_millis(10)]);
    }

    /// Native open time counts inside the budget and sleeps trim to the
    /// remainder: with 1990 ms consumed by the first denied native call,
    /// only one trimmed ladder step still fits.
    #[test]
    fn native_call_time_counts_and_sleeps_trim_to_the_remaining_budget() {
        let clock_state = FakeClockState::with_denied_open_cost(Duration::from_millis(1990));
        let mut api = SpyClipboard::new()
            .opens(vec![OpenOutcome::Denied; 8])
            .with_clock(clock_state.clone());
        let clock = FakeClock(clock_state.clone());
        let error = flow_clear(&mut api, &clock).unwrap_err();
        assert_eq!(error.code, options::error_code::LOCKED);
        // attempt 1 at t=0 (denied, native cost -> t=1990), sleep 10 ->
        // t=2000, attempt 2 at the deadline (denied, native cost ->
        // t=3990): remaining is zero, terminal.
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "attempts": 2, "elapsedMs": 3990 })
        );
        assert_eq!(millis(&clock_state.sleeps()), vec![10]);
    }

    /// Successful handoff: SetClipboardData success transfers ownership —
    /// the handle is NEVER freed afterwards (spec scenario).
    #[test]
    fn write_success_hands_the_handle_off_and_never_frees() {
        let mut api = SpyClipboard::new();
        let clock = api.run_clock();
        let state = api.shared_state();
        let result = flow_write_text(&mut api, &clock, &units("hello"));
        assert_eq!(result, Ok(()));
        let trace = api.trace();
        assert_eq!(
            trace,
            vec!["alloc(16, 6u)", "open:opened", "empty", "set(16)", "close",]
        );
        assert!(state.borrow().freed.is_empty(), "never free after handoff");
    }

    /// Failure paths reclaim the un-handed-off handle (spec scenario):
    /// SetClipboardData, EmptyClipboard, and the locked-open path all free
    /// before surfacing the typed rejection.
    #[test]
    fn write_failures_reclaim_the_unhanded_handle() {
        // SetClipboardData failure.
        let mut api = SpyClipboard::new().set_data_fails(5);
        let clock = api.run_clock();
        let state = api.shared_state();
        let error = flow_write_text(&mut api, &clock, &units("hello")).unwrap_err();
        assert_eq!(error.code, options::error_code::UNAVAILABLE);
        assert_eq!(state.borrow().freed, vec![16]);
        assert_eq!(
            api.trace(),
            vec![
                "alloc(16, 6u)",
                "open:opened",
                "empty",
                "set(16)",
                "close",
                "free(16)"
            ]
        );

        // EmptyClipboard failure (the frozen explicit path).
        let mut api = SpyClipboard::new().empty_fails(1412);
        let clock = api.run_clock();
        let error = flow_write_text(&mut api, &clock, &units("hello")).unwrap_err();
        assert_eq!(error.code, options::error_code::UNAVAILABLE);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "osErrorCode": 1412 })
        );
        assert_eq!(api.trace().last().unwrap(), "free(16)");

        // The open discipline itself fails after allocation (persistent lock).
        let mut api = SpyClipboard::new();
        api.opens = vec![OpenOutcome::Denied; 64];
        let clock = api.run_clock();
        let error = flow_write_text(&mut api, &clock, &units("hello")).unwrap_err();
        assert_eq!(error.code, options::error_code::LOCKED);
        assert_eq!(api.trace().last().unwrap(), "free(16)");
    }

    /// After a successful handoff, a later CloseClipboard failure must NOT
    /// free the system-owned handle (a double-free-class error).
    #[test]
    fn close_failure_after_handoff_never_frees_the_system_owned_handle() {
        let mut api = SpyClipboard::new().close_fails(6);
        let clock = api.run_clock();
        let state = api.shared_state();
        let error = flow_write_text(&mut api, &clock, &units("hello")).unwrap_err();
        assert_eq!(error.code, options::error_code::UNAVAILABLE);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "osErrorCode": 6 })
        );
        assert!(
            state.borrow().freed.is_empty(),
            "the handle was handed off; close failure must not free it"
        );
    }

    /// An empty-string write still delivers bytes through SetClipboardData
    /// — the one-unit zero terminator — and is never coerced into the
    /// clear path (design section 1: two operations, never merged).
    #[test]
    fn empty_string_write_is_a_set_string_delivery_not_a_clear() {
        let mut api = SpyClipboard::new();
        let clock = api.run_clock();
        let result = flow_write_text(&mut api, &clock, &units(""));
        assert_eq!(result, Ok(()));
        assert_eq!(
            api.trace(),
            vec!["alloc(16, 1u)", "open:opened", "empty", "set(16)", "close"]
        );

        let mut clear = SpyClipboard::new();
        let clear_clock = clear.run_clock();
        let result = flow_clear(&mut clear, &clear_clock);
        assert_eq!(result, Ok(()));
        assert_eq!(clear.trace(), vec!["open:opened", "empty", "close"]);
    }

    /// NULL with ERROR_SUCCESS reads as the null empty state (spec
    /// scenario); NULL with another last error is typed unavailable.
    #[test]
    fn read_null_discriminates_no_data_from_os_failure() {
        let mut api = SpyClipboard::new();
        let clock = api.run_clock();
        let result = flow_read_text(&mut api, &clock);
        assert_eq!(result, Ok(None));
        assert_eq!(
            api.trace(),
            vec!["open:opened", "get:null-no-data", "close"]
        );

        let mut api = SpyClipboard::new().get_data_null_failed(6);
        let clock = api.run_clock();
        let error = flow_read_text(&mut api, &clock).unwrap_err();
        assert_eq!(error.code, options::error_code::UNAVAILABLE);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "osErrorCode": 6 })
        );
        assert_eq!(
            api.trace(),
            vec!["open:opened", "get:null-failed(6)", "close"]
        );
    }

    /// Reads copy through lock before close, never free the board-owned
    /// handle, and decode (truncation + lone-surrogate law) runs after the
    /// handle is released (spec scenario).
    #[test]
    fn read_copies_through_lock_before_close_and_never_frees() {
        let board: Vec<u16> = "\u{1F600} hi"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut api = SpyClipboard::new().get_data_handle(&board);
        let clock = api.run_clock();
        let state = api.shared_state();
        let result = flow_read_text(&mut api, &clock);
        assert_eq!(result, Ok(Some("\u{1F600} hi".to_string())));
        assert_eq!(
            api.trace(),
            vec![
                "open:opened",
                "get:handle",
                "lock-copy-unlock(170)",
                "close"
            ]
        );
        assert!(state.borrow().freed.is_empty());

        // Foreign lone-surrogate bytes surface the typed payload rejection.
        let malformed = vec![0xD83D, 0xDE00, 0xD83D, 0];
        let mut api = SpyClipboard::new().get_data_handle(&malformed);
        let clock = api.run_clock();
        let error = flow_read_text(&mut api, &clock).unwrap_err();
        assert_eq!(error.code, options::error_code::PAYLOAD_INVALID);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "reason": "lone-surrogate", "index": 2 })
        );

        // A GlobalLock failure is typed unavailable after close.
        let mut api = SpyClipboard::new();
        api.lock_result = Err(8);
        api.get_data = GetDataOutcome::Handle(GlobalMem::new(0xAA));
        let clock = api.run_clock();
        let error = flow_read_text(&mut api, &clock).unwrap_err();
        assert_eq!(error.code, options::error_code::UNAVAILABLE);
        assert_eq!(
            error.details.as_ref().unwrap(),
            &serde_json::json!({ "osErrorCode": 8 })
        );
    }

    /// Reads follow the same frozen retry discipline on open.
    #[test]
    fn read_open_contention_retries_within_the_ladder() {
        let mut api = SpyClipboard::new().opens(vec![OpenOutcome::Denied, OpenOutcome::Opened]);
        let board: Vec<u16> = "ok".encode_utf16().chain(std::iter::once(0)).collect();
        api.get_data = GetDataOutcome::Handle(GlobalMem::new(0xAA));
        api.lock_units = board;
        let clock = api.run_clock();
        let result = flow_read_text(&mut api, &clock);
        assert_eq!(result, Ok(Some("ok".to_string())));
        assert_eq!(millis(&api.sleeps()), vec![10]);
    }
}
