//! Per-owner bounded STA workers (add-ext-dialog design section 5.3,
//! task 3.3 — frozen numerics).
//!
//! One worker thread per active dialog: the thread initializes COM with
//! `COINIT_APARTMENTTHREADED`, creates a message-only dispatcher window
//! (the `WM_APP + ordinal` close channel), runs the native modal call, and
//! submits the single terminal through the deferred port. COM objects are
//! created, used, and released on that worker thread only; the only values
//! crossing threads are copyable request data, the Send port shim, and
//! atomics — never the instance pointer, never a COM interface.
//!
//! The dispatcher window exists because every Win32 modal pump
//! (`TaskDialogIndirect`, `IFileDialog::Show`, `MessageBoxW`) dispatches
//! messages for all windows of its thread: a `WM_APP` message posted to the
//! dispatcher is delivered inside the modal pump, ON the worker thread, so
//! the close path never touches COM objects from a foreign thread. There is
//! intentionally no standalone `GetMessage` loop — the modal pumps are the
//! loop; a separate blocking loop would keep the thread from exiting after
//! the modal returns.

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::Com::COINIT_APARTMENTTHREADED;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, EnumThreadWindows, GetWindowLongPtrW,
    PostMessageW, RegisterClassW, SetWindowLongPtrW, CREATESTRUCTW, GWLP_USERDATA, WNDCLASSW,
    WM_CLOSE, WM_NCCREATE, WS_OVERLAPPED,
};

use super::ffi::{wide, DISPATCHER_CLASS_NAME, HWND_MESSAGE, WM_APP_DIALOG_CLOSE};

/// What the worker is currently showing. Guarded by the worker-shared
/// mutex; every variant's native handles are owned by the worker thread and
/// only ever touched from the dispatcher `WndProc` (which runs on the
/// worker thread inside the modal pump).
#[derive(Debug, Clone, Copy)]
pub(crate) enum DialogTarget {
    /// Constructing; nothing dismissible yet (the early-close flag covers
    /// this window).
    None,
    TaskDialog { hwnd: HWND },
    FileDialog { dialog: *mut c_void },
    MessageBox,
}

// The raw IFileDialog pointer crosses no thread: `DialogTarget` lives in
// `WorkerShared` whose close path only ever executes on the worker thread
// (dispatcher WndProc / worker body). The Send impl exists solely so the
// shared state can sit in an Arc; the pointer is never dereferenced
// off-thread. The assertion lives in `close_from_worker_thread`.
unsafe impl Send for DialogTarget {}

/// The worker-thread half of the entry handshake and the close channel.
/// All fields are atomics/mutexes: the broker's command thread reads and
/// posts, the worker thread owns the COM side. The entry sender lives here
/// (not only in the worker body) because the TaskDialog presentation
/// evidence fires inside the `TDN_CREATED` callback, which receives only
/// the callback data pointer.
pub(crate) struct WorkerShared {
    pub(crate) ordinal: usize,
    /// Host-side early close (pre-Accept timeout abandon, or a close that
    /// raced construction): the worker must not enter its modal.
    pub(crate) close_requested: AtomicBool,
    /// Session-close revocation: finish with the cancel-branch payload.
    pub(crate) revoked: AtomicBool,
    /// The command call already returned `dialog_presentation_failed`:
    /// never submit a terminal for this worker.
    pub(crate) abandoned: AtomicBool,
    /// True once the worker entered its native modal call (the `Entered`
    /// handshake fired: `TDN_CREATED`, `Show` entry, or MessageBox entry).
    /// This is the single pre/post-entry authority: every failure path
    /// branches on it — a worker that never entered must answer with the
    /// synchronous typed error and never submit a terminal (design section
    /// 5.3's pre-Accept transaction).
    pub(crate) entered: AtomicBool,
    /// The TaskDialog HWND, published at `TDN_CREATED`.
    pub(crate) dialog_hwnd: AtomicIsize,
    /// The dispatcher message-only window, published after creation.
    pub(crate) dispatcher_hwnd: AtomicIsize,
    /// The owning worker thread id (diagnostics + MessageBox close search).
    pub(crate) thread_id: AtomicU32,
    pub(crate) target: Mutex<DialogTarget>,
    /// The one-shot pre-Accept entry handshake sender. Taken (dropped) by
    /// the worker body when the handshake completes.
    pub(crate) entry: Mutex<Option<Sender<EntryOutcome>>>,
}

impl WorkerShared {
    pub(crate) fn new(ordinal: usize) -> Arc<Self> {
        Arc::new(Self {
            ordinal,
            close_requested: AtomicBool::new(false),
            revoked: AtomicBool::new(false),
            abandoned: AtomicBool::new(false),
            entered: AtomicBool::new(false),
            dialog_hwnd: AtomicIsize::new(0),
            dispatcher_hwnd: AtomicIsize::new(0),
            thread_id: AtomicU32::new(0),
            target: Mutex::new(DialogTarget::None),
            entry: Mutex::new(None),
        })
    }

    /// True once the worker published its dispatcher window: the point from
    /// which a posted close is deliverable. Diagnostic surface (asserted by
    /// the shared-state test).
    #[allow(dead_code)]
    pub(crate) fn dispatcher_ready(&self) -> bool {
        self.dispatcher_hwnd.load(Ordering::Acquire) != 0
    }

    /// Installs the entry-sender half of the handshake (worker spawn time).
    pub(crate) fn install_entry(&self, entry: Sender<EntryOutcome>) {
        *self
            .entry
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(entry);
    }

    /// Sends one entry outcome through the handshake channel. Returns
    /// false when the receiving side is gone (the command call already
    /// returned) — the worker then finishes without a terminal.
    pub(crate) fn send_entry(&self, outcome: EntryOutcome) -> bool {
        let guard = self.entry.lock().unwrap_or_else(|error| error.into_inner());
        match guard.as_ref() {
            Some(sender) => sender.send(outcome).is_ok(),
            None => false,
        }
    }

    /// Fires the `Entered` handshake AND records the entered state (the
    /// pre/post-entry authority). The state records even when the receiving
    /// half is already gone (the host answered with the synchronous
    /// timeout error): the worker still entered its native modal, and the
    /// terminal gate consults `abandoned` for exactly that race.
    pub(crate) fn send_entry_entered(&self, evidence: &'static str) -> bool {
        self.entered.store(true, Ordering::Release);
        self.send_entry(EntryOutcome::Entered { evidence })
    }

    /// Takes the handshake sender away (the worker body calls this after
    /// the modal returns; no further entry signals are expressible).
    pub(crate) fn take_entry(&self) {
        *self
            .entry
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
    }

    /// Posts the `WM_APP + ordinal` close message. Callable from any
    /// thread (posting is thread-safe); the handling stays on the worker.
    pub(crate) fn request_close(&self) {
        self.close_requested.store(true, Ordering::Release);
        let dispatcher = self.dispatcher_hwnd.load(Ordering::Acquire) as HWND;
        if !dispatcher.is_null() {
            // SAFETY: a published, valid dispatcher HWND; PostMessageW only
            // enqueues.
            unsafe {
                PostMessageW(
                    dispatcher,
                    WM_APP_DIALOG_CLOSE.wrapping_add(self.ordinal as u32 & 0xFFFF),
                    0,
                    0,
                );
            }
        }
    }
}

/// The pre-Accept entry handshake outcome, sent exactly once per worker.
pub(crate) enum EntryOutcome {
    /// The worker entered its native modal call. `evidence` names the
    /// presentation signal (`TDN_CREATED` for TaskDialog; `Show` entry for
    /// IFileDialog/MessageBox).
    Entered { evidence: &'static str },
    /// Pre-entry failure: the command must answer with a synchronous typed
    /// error (original requestId path) and no operation may exist.
    Failed { error: opentray_spec::TypedExtensionError },
}

// ---------------------------------------------------------------------------
// Dispatcher window
// ---------------------------------------------------------------------------

/// The registered dispatcher class atom, installed once per process.
static DISPATCHER_CLASS: std::sync::OnceLock<u16> = std::sync::OnceLock::new();

fn register_dispatcher_class() -> u16 {
    *DISPATCHER_CLASS.get_or_init(|| {
        let class_name = wide(DISPATCHER_CLASS_NAME);
        // SAFETY: GetModuleHandleW with a null name returns this module's
        // instance handle; the WNDCLASSW outlives the call.
        let instance = unsafe { GetModuleHandleW(std::ptr::null()) };
        let class = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(dispatcher_proc),
            cbClsExtra: 0,
            // One pointer slot for the worker-shared Arc, installed at
            // WM_NCCREATE from the CreateWindowExW lpParam.
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };
        // SAFETY: valid WNDCLASSW for the duration of the call.
        unsafe { RegisterClassW(&class) }
    })
}

/// The dispatcher window procedure. Runs on the WORKER thread (inside the
/// modal pump); the only handled message is the close request, which is
/// projected onto the current dialog target entirely on this thread.
unsafe extern "system" fn dispatcher_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        // lpParam carried the Arc<WorkerShared>; keep it in GWLP_USERDATA.
        // SAFETY: WM_NCCREATE arrives before any other message; lparam
        // points at the CREATESTRUCTW whose lpCreateParams is our value.
        let create = lparam as *mut CREATESTRUCTW;
        let param = unsafe { (*create).lpCreateParams };
        // SAFETY: the caller (worker body) leaked an Arc reference count
        // into the create params; the window keeps that count until
        // destroy_dispatcher_window reclaims it after DestroyWindow.
        unsafe {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, param as isize);
        }
        return unsafe { DefWindowProcW(hwnd, message, wparam, lparam) };
    }
    if (WM_APP_DIALOG_CLOSE..=WM_APP_DIALOG_CLOSE.wrapping_add(0xFFFF)).contains(&message) {
        let shared = user_data_shared(hwnd);
        if let Some(shared) = shared {
            close_from_worker_thread(&shared);
        }
        return 0;
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

fn user_data_shared(hwnd: HWND) -> Option<Arc<WorkerShared>> {
    // SAFETY: reading the GWLP_USERDATA slot installed at WM_NCCREATE; the
    // Arc count held by the window is cloned for the handler.
    let value = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const WorkerShared;
    if value.is_null() {
        return None;
    }
    // SAFETY: the pointer came from an Arc whose reference the window owns;
    // clone it for this call (the window's count is dropped by the worker
    // body after DestroyWindow returns).
    Some(unsafe { Arc::increment_strong_count(value); Arc::from_raw(value) })
}

/// The close projection — must run on the worker thread only (the
/// dispatcher WndProc guarantees that).
fn close_from_worker_thread(shared: &WorkerShared) {
    debug_assert_eq!(
        shared.thread_id.load(Ordering::Relaxed),
        unsafe { GetCurrentThreadId() },
        "dialog close must be projected on the owning worker thread"
    );
    let target = *shared
        .target
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    match target {
        DialogTarget::None => {
            // Pre-entry: the early-close flag makes the worker body skip
            // the modal entirely (already set by request_close).
        }
        DialogTarget::TaskDialog { hwnd } => {
            // SAFETY: the TaskDialog HWND was published by this thread's
            // TDN_CREATED callback; WM_CLOSE on a TaskDialog takes the
            // cancellation path (returns IDCANCEL).
            unsafe {
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
            }
        }
        DialogTarget::FileDialog { dialog } => {
            // SAFETY: the interface pointer is owned by this thread (STA);
            // Close() is the documented cross-modal dismissal and the
            // vtable call stays on the apartment thread.
            unsafe {
                super::file_dialog::close_on_worker_thread(dialog);
            }
        }
        DialogTarget::MessageBox => {
            close_message_box_on_worker_thread(shared);
        }
    }
}

/// Finds the MessageBox window of this thread and posts `WM_CLOSE`.
/// MessageBoxW has no API handle, but it is the only other visible
/// top-level window the worker thread owns (the dispatcher is message-only
/// and parented to HWND_MESSAGE), so an enumeration scoped to the thread
/// identifies it without touching foreign windows.
fn close_message_box_on_worker_thread(shared: &WorkerShared) {
    struct EnumState {
        dispatcher: HWND,
        posted: bool,
    }
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
        let state = unsafe { &mut *(lparam as *mut EnumState) };
        if hwnd == state.dispatcher {
            // Keep enumerating: the dispatcher is ours but not the dialog.
            return 1;
        }
        // SAFETY: PostMessageW only enqueues; any HWND from the thread
        // enumeration is valid for posting.
        unsafe {
            PostMessageW(hwnd, WM_CLOSE, 0, 0);
        }
        state.posted = true;
        0 // done: the message box is the first non-dispatcher window
    }
    let mut state = EnumState {
        dispatcher: shared.dispatcher_hwnd.load(Ordering::Acquire) as HWND,
        posted: false,
    };
    let thread_id = shared.thread_id.load(Ordering::Relaxed);
    // SAFETY: the callback only reads the EnumState through the lparam the
    // caller owns; enumeration runs synchronously on this thread.
    unsafe {
        EnumThreadWindows(thread_id, Some(enum_proc), &mut state as *mut EnumState as LPARAM);
    }
}

/// Creates the message-only dispatcher window on the current (worker)
/// thread. The window holds one leaked Arc reference (released by
/// [`destroy_dispatcher_window`]).
///
/// # Safety
///
/// Must be called on the worker thread with COM already initialized STA;
/// `shared` must stay alive until the matching destroy call.
pub(super) unsafe fn create_dispatcher_window(shared: &Arc<WorkerShared>) -> Result<HWND, String> {
    let atom = register_dispatcher_class();
    if atom == 0 {
        return Err("RegisterClassW for the dialog dispatcher failed".to_string());
    }
    // The window owns one Arc reference count until destroy.
    let leaked = Arc::into_raw(shared.clone()) as *mut c_void;
    let class_name = wide(DISPATCHER_CLASS_NAME);
    // SAFETY: the class is registered; the leaked Arc outlives the call and
    // is reclaimed by destroy_dispatcher_window.
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class_name.as_ptr(),
            class_name.as_ptr(),
            WS_OVERLAPPED, // unused for message-only windows
            0,
            0,
            0,
            0,
            HWND_MESSAGE, // message-only: no z-order, no visibility
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            leaked,
        )
    };
    if hwnd.is_null() {
        // Reclaim the never-installed reference.
        drop(unsafe { Arc::from_raw(leaked) });
        return Err("CreateWindowExW for the dialog dispatcher failed".to_string());
    }
    shared
        .dispatcher_hwnd
        .store(hwnd as isize, Ordering::Release);
    shared
        .thread_id
        .store(unsafe { GetCurrentThreadId() }, Ordering::Release);
    Ok(hwnd)
}

/// Destroys the dispatcher window and reclaims its Arc reference.
///
/// # Safety
///
/// Must be called on the worker thread that created the window; no close
/// message may be in flight afterwards.
pub(super) unsafe fn destroy_dispatcher_window(shared: &WorkerShared) {
    let hwnd = shared.dispatcher_hwnd.swap(0, Ordering::AcqRel) as HWND;
    if hwnd.is_null() {
        return;
    }
    // Reclaim the reference the window holds BEFORE destroying it: the
    // window data (GWLP_USERDATA) is gone once DestroyWindow returns.
    let value = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *const WorkerShared;
    // SAFETY: the window was created by this thread; DestroyWindow must be
    // called from the owning thread (it is).
    unsafe {
        DestroyWindow(hwnd);
    }
    if !value.is_null() {
        drop(unsafe { Arc::from_raw(value) });
    }
}

/// Initializes COM STA on the worker thread. Returns Err(message) when the
/// apartment could not be entered (a pre-entry failure).
pub(super) fn initialize_sta() -> Result<StaGuard, String> {
    // SAFETY: CoInitializeEx(null, APARTMENTTHREADED) on the current
    // thread; the guard unbalances with CoUninitialize exactly once.
    // (COINIT is an i32-typed constant; the windows-sys entry takes u32.)
    let hr = unsafe {
        windows_sys::Win32::System::Com::CoInitializeEx(
            std::ptr::null(),
            COINIT_APARTMENTTHREADED as u32,
        )
    };
    // RPC_E_CHANGED_MODE (-2147417850): the thread already hosts an STA —
    // a configuration this extension never creates; treat as failure
    // instead of calling CoUninitialize on a apartment we do not own.
    if hr != 0 {
        return Err(format!("CoInitializeEx(APARTMENTTHREADED) returned {hr:#010x}"));
    }
    Ok(StaGuard)
}

/// Balances one successful `CoInitializeEx`.
pub(super) struct StaGuard;

impl Drop for StaGuard {
    fn drop(&mut self) {
        // SAFETY: paired with the successful initializing call; runs on the
        // same worker thread (the guard never crosses threads).
        unsafe { windows_sys::Win32::System::Com::CoUninitialize() };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_message_keeps_the_frozen_wire_form() {
        assert_eq!(WM_APP_DIALOG_CLOSE, 0x8000);
        // The close range reserves the full low word for ordinals (cap 8 in
        // practice, the whole range by contract).
        assert!(DISPATCHER_CLASS_NAME.starts_with("OpentrayExtDialog"));
    }

    #[test]
    fn shared_state_starts_unpublished() {
        let shared = WorkerShared::new(3);
        assert!(!shared.dispatcher_ready());
        assert!(!shared.close_requested.load(Ordering::Relaxed));
        assert!(!shared.revoked.load(Ordering::Relaxed));
        assert!(!shared.abandoned.load(Ordering::Relaxed));
        assert!(!shared.entered.load(Ordering::Relaxed));
        assert!(matches!(
            *shared.target.lock().unwrap(),
            DialogTarget::None
        ));
    }
}
