const MANIFEST: &str = include_str!("../Cargo.toml");

#[test]
fn linux_default_uses_ksni_without_tray_icon_dependency() {
    let linux_section = target_section("cfg(target_os = \"linux\")");

    assert!(linux_section.contains("opentray-backend-ksni.workspace = true"));
    assert!(!linux_section.contains("opentray-backend-tray-icon"));
}

#[test]
fn tray_icon_backend_is_mac_windows_only() {
    let desktop_section =
        target_section("cfg(any(target_os = \"macos\", target_os = \"windows\"))");

    assert!(desktop_section.contains("opentray-backend-tray-icon.workspace = true"));
    assert!(!desktop_section.contains("opentray-backend-ksni"));
}

fn target_section(header: &str) -> &str {
    let start_marker = format!("[target.'{header}'.dependencies]");
    let start = MANIFEST
        .find(&start_marker)
        .unwrap_or_else(|| panic!("missing target section: {header}"));
    let section = &MANIFEST[start + start_marker.len()..];
    let end = section.find("\n[").unwrap_or(section.len());
    &section[..end]
}
