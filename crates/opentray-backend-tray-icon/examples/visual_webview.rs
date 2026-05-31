mod common;

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod visual {
    use std::time::Duration;

    use opentray_backend_tray_icon::{NativeTrayIconRuntime, TrayIconBackend};
    use opentray_core::SurfaceBackend;
    use winit::application::ApplicationHandler;
    use winit::dpi::LogicalSize;
    use winit::event::WindowEvent;
    use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
    use winit::window::{Window, WindowId};
    use wry::{WebView, WebViewBuilder};

    use crate::common;

    const OPEN_MENU_ID: &str = "opentray:human-check:status:42";
    const QUIT_MENU_ID: &str = "opentray:human-check:status:99";

    #[derive(Debug, Clone)]
    enum UserEvent {
        Menu(tray_icon::menu::MenuEvent),
        Exit,
    }

    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
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

        let mut app = VisualWebviewApp {
            backend: TrayIconBackend::with_runtime(NativeTrayIconRuntime::default()),
            webview: None,
            window: None,
            created: false,
        };
        event_loop.run_app(&mut app)?;

        Ok(())
    }

    struct VisualWebviewApp {
        backend: TrayIconBackend<NativeTrayIconRuntime>,
        webview: Option<WebView>,
        window: Option<Window>,
        created: bool,
    }

    impl VisualWebviewApp {
        fn create_visual_surface(
            &mut self,
            event_loop: &ActiveEventLoop,
        ) -> Result<(), Box<dyn std::error::Error>> {
            self.backend.sync_surface(common::surface_projection())?;

            let window = event_loop.create_window(
                Window::default_attributes()
                    .with_title("OpenTray Visual WebView Example")
                    .with_inner_size(LogicalSize::new(520.0, 380.0))
                    .with_visible(true),
            )?;
            let webview = WebViewBuilder::new()
                .with_html(visual_html())
                .build(&window)?;

            self.webview = Some(webview);
            self.window = Some(window);
            self.created = true;

            println!("visual webview created");
            println!("you should see a native window with OpenTray WebView content");
            println!(
                "use the tray menu \"Open Panel\" to show it again, or \"Quit Example\" to exit"
            );
            Ok(())
        }

        fn show_window(&self) {
            if let Some(window) = &self.window {
                window.set_visible(true);
                window.focus_window();
                println!("visual webview window shown");
            }
        }
    }

    impl ApplicationHandler<UserEvent> for VisualWebviewApp {
        fn resumed(&mut self, event_loop: &ActiveEventLoop) {
            if self.created {
                return;
            }

            if let Err(error) = self.create_visual_surface(event_loop) {
                eprintln!("failed to create visual webview example: {error}");
                event_loop.exit();
            }
        }

        fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
            match event {
                UserEvent::Menu(event) => {
                    let menu_id = event.id.0;
                    println!("menu event: {menu_id}");
                    if let Some(event) = self.backend.menu_event(&menu_id) {
                        println!("opentray event: {event:?}");
                    }

                    match menu_id.as_str() {
                        OPEN_MENU_ID => self.show_window(),
                        QUIT_MENU_ID => event_loop.exit(),
                        _ => {}
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
            event: WindowEvent,
        ) {
            if matches!(event, WindowEvent::CloseRequested) {
                if let Some(window) = &self.window {
                    window.set_visible(false);
                    println!("visual webview window hidden; use tray menu to show it again");
                }
            }
        }
    }

    fn auto_exit_duration() -> Option<Duration> {
        std::env::var("OPENTRAY_EXAMPLE_EXIT_AFTER_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_millis)
    }

    fn visual_html() -> &'static str {
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
        font-family: ui-rounded, "SF Pro Rounded", "Segoe UI", sans-serif;
        background: #0f1c17;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 20% 20%, rgba(71, 222, 159, 0.28), transparent 34%),
          linear-gradient(145deg, #0f1c17 0%, #142a22 45%, #e7f9c8 100%);
      }
      main {
        width: min(82vw, 390px);
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 28px;
        padding: 28px;
        color: #f7ffe8;
        background: rgba(10, 24, 19, 0.72);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
        backdrop-filter: blur(22px);
      }
      .eyebrow {
        color: #9ff0bf;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      h1 {
        margin: 10px 0 12px;
        font-size: 34px;
        line-height: 0.98;
      }
      p {
        margin: 0;
        color: rgba(247, 255, 232, 0.78);
        font-size: 15px;
      }
      .badge {
        display: inline-grid;
        margin-top: 22px;
        border-radius: 999px;
        padding: 10px 14px;
        color: #102018;
        background: #b8ff76;
        font-size: 13px;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">OpenTray visual smoke</div>
      <h1>WebView atom is visible.</h1>
      <p>This window is rendered by a real native WebView example, while the tray icon is applied through the injected tray-icon runtime atom.</p>
      <div class="badge">human-verifiable</div>
    </main>
  </body>
</html>"#
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    visual::run()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn main() {
    eprintln!("visual_webview uses wry and is currently enabled for macOS and Windows examples");
}
