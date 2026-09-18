//! Notification instance state (add-ext-notification design sections 3-4).
//!
//! Orthogonal intents (maintained 2026-09-17; original user requests: a
//! session-scoped notification atom whose darwin authorization surface
//! completes through the existing deferred transaction, with identity and
//! DTO obligations identical on every platform):
//! 1. The deferred port is stored BY VALUE (only `port_data` + `submit`
//!    are kept — dialog family law); the host guarantees the
//!    process-lifetime of `port_data`, never of the struct. The copy is
//!    cloneable so an owner-thread hop can submit while the engine borrow
//!    is live (the clone is the same honest pair).
//! 2. The instance core (port + authorization engine) is owner-thread
//!    confined; the FFI instance owns it through an `Rc` also registered
//!    in the owner-thread registry so production GCD hops can reach it
//!    with plain `Send` data only.
//! 3. Deinit marks the core closed and clears the engine WITHOUT
//!    terminals (the host revokes the port first — the dialog family's
//!    deinit law); late hops become stateless no-ops.
//!
//! Compromise: the core lives behind `Rc<RefCell<…>>` instead of plain
//! fields because the registry and the FFI instance must alias the same
//! owner-thread state; splitting them would duplicate the authorization
//! truth. Nothing ever crosses threads.

use std::cell::RefCell;
use std::ffi::c_void;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

use opentray_spec::{
    ExtDeferredPortSubmitV1, ExtDeferredPortV1, ExtOperationPayload, TypedExtensionError,
    EXTENSION_EVENT_RECORD_MAX_BYTES, EXT_DEFERRED_PORT_ABI_V1,
};

use crate::auth::NotificationCore;

/// Process-unique instance keys: the `Send` half of the owner-thread
/// registry lookup. Allocation is atomic because `init` may run on any
/// thread; the core itself is only ever touched on the owner thread.
static NEXT_INSTANCE_KEY: AtomicU64 = AtomicU64::new(1);

pub(crate) fn next_instance_key() -> u64 {
    NEXT_INSTANCE_KEY.fetch_add(1, Ordering::Relaxed)
}

/// A by-value copy of the attached deferred port (dialog family law):
/// only `port_data` and the `submit` entry point are retained. Cloning
/// copies the same broker-owned pair — used by the owner-thread delivery
/// path, never across threads.
pub(crate) struct DeferredPortCopy {
    port_data: *mut c_void,
    submit: ExtDeferredPortSubmitV1,
}

// SAFETY-shaped note: the copy never crosses threads in this crate (the
// darwin delivery path runs on the owner thread); the raw pointer pair is
// broker-owned process-lifetime state. Clone is the same honest pair.
impl Clone for DeferredPortCopy {
    fn clone(&self) -> Self {
        DeferredPortCopy {
            port_data: self.port_data,
            submit: self.submit,
        }
    }
}

impl DeferredPortCopy {
    /// Validates the host-provided port (nested ABI version + struct
    /// size) before copying it. A mismatch is a typed rejection, never a
    /// silent downgrade (EventPort-family law).
    pub(crate) fn from_port(port: &ExtDeferredPortV1) -> Result<Self, TypedExtensionError> {
        if port.abi_version != EXT_DEFERRED_PORT_ABI_V1 {
            return Err(crate::options::typed_error(
                "deferred_port_abi_incompatible",
                format!(
                    "deferred port ABI version {} does not match {}",
                    port.abi_version, EXT_DEFERRED_PORT_ABI_V1
                ),
            ));
        }
        if port.struct_size as usize != std::mem::size_of::<ExtDeferredPortV1>() {
            return Err(crate::options::typed_error(
                "deferred_port_abi_incompatible",
                format!(
                    "deferred port struct size {} does not match {}",
                    port.struct_size,
                    std::mem::size_of::<ExtDeferredPortV1>()
                ),
            ));
        }
        if port.port_data.is_null() {
            return Err(crate::options::typed_error(
                "deferred_port_abi_incompatible",
                "deferred port carries a null port_data pointer",
            ));
        }
        Ok(Self {
            port_data: port.port_data,
            submit: port.submit,
        })
    }

    /// Submits the single terminal payload for one operation handle.
    /// Returns the raw FFI result code; every caller treats non-OK codes
    /// as an already-diagnosed host decision (the port was revoked or the
    /// operation ended with the transport) and never retries.
    pub(crate) fn submit(&self, handle: u64, payload: &ExtOperationPayload) -> i32 {
        let Ok(bytes) = serde_json::to_vec(payload) else {
            return opentray_spec::EXT_ERR_INTERNAL;
        };
        if bytes.len() > EXTENSION_EVENT_RECORD_MAX_BYTES {
            return opentray_spec::EXT_ERR_OVERSIZED;
        }
        unsafe { (self.submit)(self.port_data, handle, bytes.as_ptr(), bytes.len()) }
    }
}

/// Per-mount notification instance created by `opentray_ext_init`. The
/// platform surface touches only the owner thread; `macos` registers the
/// core lazily on the first owner-thread command (init itself may run
/// elsewhere).
pub(crate) struct NotificationInstance {
    pub(crate) instance_key: u64,
    pub(crate) core: Rc<RefCell<NotificationCore>>,
}

impl NotificationInstance {
    pub(crate) fn new() -> Self {
        let core = Rc::new(RefCell::new(NotificationCore::new()));
        Self {
            instance_key: next_instance_key(),
            core,
        }
    }

    /// Registers the core in THIS thread's owner registry (idempotent).
    /// Called on the owner thread; production win32 never registers
    /// (zero deferred frames), darwin registers on the first owner-thread
    /// command and session-close/deinit re-register harmlessly.
    pub(crate) fn ensure_owner_registered(&self) {
        crate::auth::register_owner_instance(self.instance_key, &self.core);
    }
}

impl Default for NotificationInstance {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for NotificationInstance {
    fn drop(&mut self) {
        // Deinit law: mark closed first (a late hop may still hold the Rc),
        // clear the engine without terminals, then release this thread's
        // registry alias. A registry entry on a different thread's view
        // dies with that thread-local; the closed flag is the guard.
        {
            let mut core = self.core.borrow_mut();
            core.closed = true;
            core.port = None;
            core.engine.clear_without_terminals();
        }
        crate::auth::unregister_owner_instance(self.instance_key);
    }
}
