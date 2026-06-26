mod common;

use opentray_backend_tray_icon::TrayIconBackend;
use opentray_core::{AppBackend, BackendError};

fn main() -> Result<(), BackendError> {
    let backend = TrayIconBackend::new();

    match backend.sync_app(common::surface_projection()) {
        Err(BackendError::Unsupported("tray_icon_runtime_unbound")) => {
            println!("ok: default tray-icon runtime is explicitly unbound");
            Ok(())
        }
        Err(error) => Err(error),
        Ok(()) => panic!("expected default tray-icon runtime to be unbound"),
    }
}
