#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("windows_vibrancy_probe is only supported on Windows.");
}

#[cfg(target_os = "windows")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use tao::dpi::LogicalSize;
    use tao::event::{ElementState, Event, MouseButton, WindowEvent};
    use tao::event_loop::{ControlFlow, EventLoop};
    use tao::platform::windows::{WindowBuilderExtWindows, WindowExtWindows};
    use tao::window::WindowBuilder;
    use window_vibrancy::{apply_acrylic, apply_mica, apply_tabbed};

    let options = ProbeOptions::parse(std::env::args().skip(1))
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    if options.help {
        print_usage();
        return Ok(());
    }

    let event_loop = EventLoop::new();
    let mut builder = WindowBuilder::new()
        .with_title(options.title())
        .with_inner_size(LogicalSize::new(720.0, 420.0))
        .with_min_inner_size(LogicalSize::new(420.0, 240.0))
        .with_decorations(options.decorated)
        .with_transparent(true);

    if !options.decorated {
        builder = builder.with_undecorated_shadow(false);
    }

    let window = builder.build(&event_loop)?;
    match options.material {
        ProbeMaterial::None => {}
        ProbeMaterial::Mica => apply_mica(&window, options.dark)?,
        ProbeMaterial::Acrylic => apply_acrylic(&window, None)?,
        ProbeMaterial::Tabbed => apply_tabbed(&window, options.dark)?,
    }

    if !options.decorated {
        window.set_undecorated_shadow(true);
    }
    window.set_focus();

    println!(
        "windows_vibrancy_probe material={} decorated={} dark={}",
        options.material.as_str(),
        options.decorated,
        match options.dark {
            Some(true) => "true",
            Some(false) => "false",
            None => "system",
        }
    );
    println!("Drag the frameless window with left mouse button. Close the window to exit.");

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control_flow = ControlFlow::Exit,
            Event::WindowEvent {
                event:
                    WindowEvent::MouseInput {
                        state: ElementState::Pressed,
                        button: MouseButton::Left,
                        ..
                    },
                ..
            } if !options.decorated => {
                if let Err(error) = window.drag_window() {
                    eprintln!("drag_window failed: {error}");
                }
            }
            _ => {}
        }
    });
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProbeMaterial {
    None,
    Mica,
    Acrylic,
    Tabbed,
}

#[cfg(target_os = "windows")]
impl ProbeMaterial {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "none" => Ok(Self::None),
            "mica" => Ok(Self::Mica),
            "acrylic" => Ok(Self::Acrylic),
            "tabbed" => Ok(Self::Tabbed),
            other => Err(format!(
                "unknown material {other}; expected none, mica, acrylic, or tabbed"
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Mica => "mica",
            Self::Acrylic => "acrylic",
            Self::Tabbed => "tabbed",
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug)]
struct ProbeOptions {
    material: ProbeMaterial,
    decorated: bool,
    dark: Option<bool>,
    help: bool,
}

#[cfg(target_os = "windows")]
impl ProbeOptions {
    fn parse(args: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let mut options = Self {
            material: ProbeMaterial::Mica,
            decorated: false,
            dark: None,
            help: false,
        };
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "-h" | "--help" => options.help = true,
                "--material" => {
                    let value = args
                        .next()
                        .ok_or_else(|| "--material requires a value".to_string())?;
                    options.material = ProbeMaterial::parse(&value)?;
                }
                "--decorated" => options.decorated = true,
                "--frameless" => options.decorated = false,
                "--dark" => options.dark = Some(true),
                "--light" => options.dark = Some(false),
                value if !value.starts_with('-') => {
                    options.material = ProbeMaterial::parse(value)?;
                }
                other => return Err(format!("unknown argument {other}")),
            }
        }
        Ok(options)
    }

    fn title(self) -> String {
        format!("OpenTray Vibrancy Probe - {}", self.material.as_str())
    }
}

#[cfg(target_os = "windows")]
fn print_usage() {
    println!(
        "Usage: cargo run -p opentray-ext-webview --example windows_vibrancy_probe -- [material] [--dark|--light] [--decorated|--frameless]\n\n\
Materials: none, mica, acrylic, tabbed\n\
Examples:\n  cargo run -p opentray-ext-webview --example windows_vibrancy_probe -- mica\n  cargo run -p opentray-ext-webview --example windows_vibrancy_probe -- acrylic\n  cargo run -p opentray-ext-webview --example windows_vibrancy_probe -- tabbed --dark"
    );
}
