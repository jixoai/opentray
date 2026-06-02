mod common;

use std::cell::RefCell;
use std::rc::Rc;

use opentray_backend_tray_icon::{TrayIconBackend, TrayIconProjection, TrayIconRuntime};
use opentray_core::{BackendError, SurfaceBackend};

fn main() -> Result<(), BackendError> {
    let runtime = RecordingRuntime::default();
    let projections = runtime.projections();
    let backend = TrayIconBackend::with_runtime(runtime);

    backend.sync_surface(common::surface_projection())?;

    let projections = projections.borrow();
    let projection = projections.last().expect("projection applied");
    println!("applied projections: {}", projections.len());
    println!("space: {}", projection.space_id);

    for tray in &projection.trays {
        println!(
            "tray: {} title={} menu_entries={}",
            tray.tray_id,
            tray.title,
            tray.menu.entries.len()
        );
    }

    let event = projection
        .routes
        .menu_event("opentray:human-check:status:42")
        .expect("menu route");
    println!("route opentray:human-check:status:42 => {event:?}");

    Ok(())
}

#[derive(Clone, Default)]
struct RecordingRuntime {
    projections: Rc<RefCell<Vec<TrayIconProjection>>>,
}

impl RecordingRuntime {
    fn projections(&self) -> Rc<RefCell<Vec<TrayIconProjection>>> {
        self.projections.clone()
    }
}

impl TrayIconRuntime for RecordingRuntime {
    fn apply_projection(&self, projection: TrayIconProjection) -> Result<(), BackendError> {
        self.projections.borrow_mut().push(projection);
        Ok(())
    }
}
