use opentray_spec::{ServerFrame, PROTOCOL_VERSION};

fn main() {
    let _backend = default_backend_name();
    let ready = ServerFrame::Ready {
        version: PROTOCOL_VERSION,
    };
    println!("{}", serde_json::to_string(&ready).expect("ready frame"));
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn default_backend_name() -> &'static str {
    let _backend = opentray_backend_tray_icon::TrayIconBackend::new();
    "tray-icon"
}

#[cfg(target_os = "linux")]
fn default_backend_name() -> &'static str {
    let _backend = opentray_backend_ksni::KsniBackend::new();
    "ksni"
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn default_backend_name() -> &'static str {
    "unsupported"
}
