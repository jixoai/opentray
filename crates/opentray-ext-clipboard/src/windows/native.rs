//! Real win32 clipboard surface (add-ext-clipboard task 3.2).
//!
//! user32 clipboard (OpenClipboard/EmptyClipboard/SetClipboardData/
//! GetClipboardData/CloseClipboard) plus kernel32 global memory
//! (GlobalAlloc/GlobalLock/GlobalUnlock/GlobalSize/GlobalFree) behind the
//! `WinClipboard`/`RetryClock` seams; every flow law (retry discipline,
//! HGLOBAL ownership, single-command close) lives in `super` and is
//! exercised by the host spy tests. `GetClipboardData(CF_UNICODETEXT)`
//! NULL discrimination and the ERROR_ACCESS_DENIED retry gate read
//! `GetLastError()` exactly where the frozen design places them.

use std::ffi::c_void;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::HGLOBAL;
use windows_sys::Win32::Foundation::{
    GetLastError, GlobalFree, ERROR_ACCESS_DENIED, ERROR_SUCCESS,
};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows_sys::Win32::System::Ole::CF_UNICODETEXT;

use opentray_spec::TypedExtensionError;

use super::{
    flow_clear, flow_read_text, flow_write_text, GetDataOutcome, GlobalMem, OpenOutcome,
    RetryClock, WinClipboard,
};
use crate::options;

/// The production clock: real monotonic instants and real thread sleeps.
pub(crate) struct ThreadClock;

impl RetryClock for ThreadClock {
    fn now(&self) -> Instant {
        Instant::now()
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

/// The production user32/kernel32 seam implementation.
pub(crate) struct Win32Clipboard;

impl WinClipboard for Win32Clipboard {
    fn open(&mut self) -> OpenOutcome {
        // SAFETY: OpenClipboard(NULL) associates the clipboard with the
        // calling task; no window handle is retained.
        if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
            OpenOutcome::Opened
        } else {
            match unsafe { GetLastError() } {
                ERROR_ACCESS_DENIED => OpenOutcome::Denied,
                code => OpenOutcome::Failed(code),
            }
        }
    }

    fn close(&mut self) -> Result<(), u32> {
        // SAFETY: plain BOOL close of the task's open clipboard.
        if unsafe { CloseClipboard() } != 0 {
            Ok(())
        } else {
            Err(unsafe { GetLastError() })
        }
    }

    fn empty(&mut self) -> Result<(), u32> {
        // SAFETY: plain BOOL empty of the task's open clipboard.
        if unsafe { EmptyClipboard() } != 0 {
            Ok(())
        } else {
            Err(unsafe { GetLastError() })
        }
    }

    fn alloc(&mut self, units: &[u16]) -> Result<GlobalMem, u32> {
        // SAFETY: GMEM_MOVEABLE allocation of exactly the zero-terminated
        // payload; the lock/unlock pair brackets the copy on this thread.
        let bytes = units.len() * std::mem::size_of::<u16>();
        let handle: HGLOBAL = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes) };
        if handle.is_null() {
            return Err(unsafe { GetLastError() });
        }
        let pointer = unsafe { GlobalLock(handle) };
        if pointer.is_null() {
            let code = unsafe { GetLastError() };
            // The allocation is still ours: reclaim it before surfacing.
            unsafe { GlobalFree(handle) };
            return Err(code);
        }
        unsafe {
            std::ptr::copy_nonoverlapping(units.as_ptr(), pointer.cast::<u16>(), units.len());
            GlobalUnlock(handle);
        }
        Ok(GlobalMem::new(handle as usize))
    }

    fn set_data(&mut self, mem: GlobalMem) -> Result<(), u32> {
        // SAFETY: the handle was allocated by `alloc` on this thread and is
        // handed to the system here; on success the caller must never free
        // it (the flow law tracks the handoff).
        let result = unsafe { SetClipboardData(CF_UNICODETEXT as u32, mem.id() as *mut c_void) };
        if result.is_null() {
            Err(unsafe { GetLastError() })
        } else {
            Ok(())
        }
    }

    fn get_data(&mut self) -> GetDataOutcome {
        // SAFETY: plain handle query of the task's open clipboard; the
        // returned handle stays board-owned (lock-copy-unlock only).
        let handle = unsafe { GetClipboardData(CF_UNICODETEXT as u32) };
        if !handle.is_null() {
            GetDataOutcome::Handle(GlobalMem::new(handle as usize))
        } else {
            match unsafe { GetLastError() } {
                // Frozen NULL discrimination (design section 1): success
                // last error = no text on the board (null, not an error).
                ERROR_SUCCESS => GetDataOutcome::NullNoData,
                code => GetDataOutcome::NullFailed(code),
            }
        }
    }

    fn lock_copy_unlock(&mut self, mem: GlobalMem) -> Result<Vec<u16>, u32> {
        let handle = mem.id() as HGLOBAL;
        // SAFETY: lock/copy/unlock of the board-owned GMEM_MOVEABLE block
        // while the clipboard is open; the deep copy is the only retained
        // memory and the handle is never freed nor touched after close.
        let size = unsafe { GlobalSize(handle) };
        let pointer = unsafe { GlobalLock(handle) };
        if pointer.is_null() {
            return Err(unsafe { GetLastError() });
        }
        let unit_count = size / std::mem::size_of::<u16>();
        let mut units = vec![0u16; unit_count];
        unsafe {
            std::ptr::copy_nonoverlapping(pointer.cast::<u16>(), units.as_mut_ptr(), unit_count);
            GlobalUnlock(handle);
        }
        Ok(units)
    }

    fn free(&mut self, mem: GlobalMem) {
        // SAFETY: only ever invoked by the flow law on extension-owned,
        // un-handed-off handles.
        unsafe { GlobalFree(mem.id() as HGLOBAL) };
    }
}

/// `writeText` (design section 2): facade preflight owns the primary UTF-16
/// gates; this native re-validation is defense in depth. The payload is
/// encoded zero-terminated and delivered through the frozen write flow.
pub(crate) fn write_text(text: &str) -> Result<(), TypedExtensionError> {
    options::validate_write_text(text)?;
    let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let mut api = Win32Clipboard;
    flow_write_text(&mut api, &ThreadClock, &units)
}

/// `readText` (design section 2): bounded open, deep copy, immediate close.
pub(crate) fn read_text() -> Result<Option<String>, TypedExtensionError> {
    let mut api = Win32Clipboard;
    flow_read_text(&mut api, &ThreadClock)
}

/// `clear` (design section 2): bounded open, empty, close.
pub(crate) fn clear() -> Result<(), TypedExtensionError> {
    let mut api = Win32Clipboard;
    flow_clear(&mut api, &ThreadClock)
}
