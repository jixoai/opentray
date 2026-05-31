mod common;
mod native_runtime;

use std::time::Duration;

use native_runtime::{NativeTrayRuntime, QUIT_MENU_ID};
use opentray_backend_tray_icon::TrayIconBackend;
use opentray_core::SurfaceBackend;
use winit::application::ApplicationHandler;
use winit::event::{StartCause, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::WindowId;

#[derive(Debug, Clone)]
enum UserEvent {
    Menu(tray_icon::menu::MenuEvent),
    Exit,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let event_loop = EventLoop::<UserEvent>::with_user_event().build()?;
    event_loop.set_control_flow(ControlFlow::Wait);

    let proxy = event_loop.create_proxy();
    tray_icon::menu::MenuEvent::set_event_handler(Some(move |event| {
        let _ = proxy.send_event(UserEvent::Menu(event));
    }));

    if let Some(duration) = auto_exit_duration() {
        let proxy = event_loop.create_proxy();
        std::thread::spawn(move || {
            std::thread::sleep(duration);
            let _ = proxy.send_event(UserEvent::Exit);
        });
    }

    let mut app = NativeTrayApp {
        backend: TrayIconBackend::with_runtime(NativeTrayRuntime::default()),
        created: false,
    };
    event_loop.run_app(&mut app)?;

    Ok(())
}

struct NativeTrayApp {
    backend: TrayIconBackend<NativeTrayRuntime>,
    created: bool,
}

impl ApplicationHandler<UserEvent> for NativeTrayApp {
    fn new_events(&mut self, event_loop: &ActiveEventLoop, cause: StartCause) {
        if !matches!(cause, StartCause::Init) || self.created {
            return;
        }

        if let Err(error) = self.backend.sync_surface(common::surface_projection()) {
            eprintln!("failed to create native tray example: {error}");
            event_loop.exit();
            return;
        }

        self.created = true;
        println!("native tray created");
        println!("open the system tray item and choose \"Quit Example\" to exit");
    }

    fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Menu(event) => {
                let menu_id = event.id.0;
                println!("menu event: {menu_id}");

                if menu_id == QUIT_MENU_ID {
                    event_loop.exit();
                }
            }
            UserEvent::Exit => {
                println!("auto exit requested");
                event_loop.exit();
            }
        }
    }

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        _event: WindowEvent,
    ) {
    }
}

fn auto_exit_duration() -> Option<Duration> {
    std::env::var("OPENTRAY_EXAMPLE_EXIT_AFTER_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(Duration::from_millis)
}
