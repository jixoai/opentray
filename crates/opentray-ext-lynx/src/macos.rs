use std::{
    collections::HashMap,
    env,
    ffi::CStr,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use libc::{c_void, dladdr, Dl_info};
use serde_json::{json, Value};

use crate::{
    opentray_ext_abi_version,
    protocol::{LynxCommand, LynxLaunchConfig},
    LynxRuntimeError,
};

const STAGED_EXTERNAL_DIR: &str = "opentray-external";
const STAGED_EXTERNAL_BUNDLE_NAME: &str = "main.lynx.bundle";
const LYNX_RUNTIME_ZIP_ENV: &str = "OPENTRAY_LYNX_RUNTIME_ZIP";
const LYNX_RUNTIME_STDIO_ENV: &str = "OPENTRAY_LYNX_RUNTIME_STDIO";
const LYNX_WINDOW_CONFIG_ENV: &str = "OPENTRAY_LYNX_WINDOW_CONFIG_JSON";
const LAUNCH_STABILITY_WINDOW_MS: u64 = 300;
const RUNTIME_APP_NAME: &str = "OpenTrayLynxRuntime";
const RUNTIME_APP_BUNDLE_NAME: &str = "OpenTrayLynxRuntime.app";
const RUNTIME_ZIP_NAME: &str = "OpenTrayLynxRuntime.app.zip";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RuntimeStdioMode {
    Quiet,
    Inherit,
}

#[derive(Default)]
pub(crate) struct MacosLynxRuntime {
    slots: HashMap<String, LynxSlot>,
}

struct LynxSlot {
    child: Child,
    launch_root: PathBuf,
}

struct PreparedLaunch {
    bundle_path: PathBuf,
    launch_root: PathBuf,
    runtime_executable: PathBuf,
    launch_url: String,
    runtime_zip: PathBuf,
    launch: LynxLaunchConfig,
}

impl MacosLynxRuntime {
    pub(crate) fn handle(
        &mut self,
        tray_id: &str,
        command: LynxCommand,
    ) -> Result<Value, LynxRuntimeError> {
        match command {
            LynxCommand::Show {
                bundle_path,
                launch,
            } => self.show(tray_id, &bundle_path, launch),
            LynxCommand::Hide => self.hide(tray_id),
        }
    }

    pub(crate) fn session_closed(&mut self, _session_id: &str) {
        self.close_all();
    }

    fn show(
        &mut self,
        tray_id: &str,
        bundle_path: &str,
        launch: LynxLaunchConfig,
    ) -> Result<Value, LynxRuntimeError> {
        let _ = self.hide(tray_id);

        let prepared = PreparedLaunch::prepare(bundle_path, launch)?;
        let mut child = spawn_runtime(
            &prepared.runtime_executable,
            &prepared.launch_url,
            &prepared.launch,
        )?;

        if let Err(error) = verify_stability(&mut child, LAUNCH_STABILITY_WINDOW_MS) {
            cleanup_launch_root(&prepared.launch_root);
            return Err(error);
        }

        let pid = child.id();
        self.slots.insert(
            tray_id.to_string(),
            LynxSlot {
                child,
                launch_root: prepared.launch_root.clone(),
            },
        );

        Ok(json!({
            "type": "shown",
            "bundlePath": prepared.bundle_path.display().to_string(),
            "launchUrl": prepared.launch_url,
            "pid": pid,
            "runtimeZip": prepared.runtime_zip.display().to_string(),
            "nativeWindowApi": prepared.launch.native_window_api,
        }))
    }

    fn hide(&mut self, tray_id: &str) -> Result<Value, LynxRuntimeError> {
        if let Some(mut slot) = self.slots.remove(tray_id) {
            close_slot(&mut slot)?;
        }
        Ok(json!({ "type": "hidden" }))
    }

    fn close_all(&mut self) {
        let tray_ids = self.slots.keys().cloned().collect::<Vec<_>>();
        for tray_id in tray_ids {
            let _ = self.hide(&tray_id);
        }
    }
}

impl Drop for MacosLynxRuntime {
    fn drop(&mut self) {
        self.close_all();
    }
}

impl PreparedLaunch {
    fn prepare(bundle_path: &str, launch: LynxLaunchConfig) -> Result<Self, LynxRuntimeError> {
        let bundle_path = canonicalize_bundle(bundle_path)?;
        let runtime_zip = resolve_runtime_zip()?;
        let launch_root = fresh_launch_root()?;
        extract_runtime_zip(&runtime_zip, &launch_root)?;
        let app_bundle = launch_root.join(RUNTIME_APP_BUNDLE_NAME);
        let relative_bundle_path = stage_external_bundle(&bundle_path, &app_bundle)?;
        let runtime_executable = app_bundle.join(format!("Contents/MacOS/{RUNTIME_APP_NAME}"));
        if !runtime_executable.is_file() {
            cleanup_launch_root(&launch_root);
            return Err(LynxRuntimeError::Internal(format!(
                "lynx runtime executable missing at {}",
                runtime_executable.display()
            )));
        }

        Ok(Self {
            bundle_path,
            launch_root,
            runtime_executable,
            launch_url: legacy_local_bundle_url(&relative_bundle_path),
            runtime_zip,
            launch,
        })
    }
}

fn canonicalize_bundle(bundle_path: &str) -> Result<PathBuf, LynxRuntimeError> {
    let path = PathBuf::from(bundle_path);
    let canonical = path.canonicalize().map_err(|error| {
        LynxRuntimeError::Rejected(format!(
            "lynx bundle path does not resolve: {} ({error})",
            path.display()
        ))
    })?;
    if !canonical.is_file() {
        return Err(LynxRuntimeError::Rejected(format!(
            "lynx bundle must be a file: {}",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn resolve_runtime_zip() -> Result<PathBuf, LynxRuntimeError> {
    if let Some(value) = env::var_os(LYNX_RUNTIME_ZIP_ENV) {
        let path = PathBuf::from(value);
        let canonical = path.canonicalize().map_err(|error| {
            LynxRuntimeError::Rejected(format!(
                "{LYNX_RUNTIME_ZIP_ENV} does not resolve: {} ({error})",
                path.display()
            ))
        })?;
        if !canonical.is_file() {
            return Err(LynxRuntimeError::Rejected(format!(
                "{LYNX_RUNTIME_ZIP_ENV} must point to {RUNTIME_ZIP_NAME}: {}",
                canonical.display()
            )));
        }
        return Ok(canonical);
    }

    let library_file = resolve_current_library_file()?;
    let runtime_zip = default_runtime_zip_path(&library_file);
    if !runtime_zip.is_file() {
        return Err(LynxRuntimeError::Unsupported(format!(
            "lynx runtime sidecar not found next to {}: {}",
            library_file.display(),
            runtime_zip.display()
        )));
    }
    Ok(runtime_zip)
}

fn resolve_current_library_file() -> Result<PathBuf, LynxRuntimeError> {
    let mut info = std::mem::MaybeUninit::<Dl_info>::zeroed();
    let symbol = opentray_ext_abi_version as *const () as *const c_void;
    let found = unsafe { dladdr(symbol, info.as_mut_ptr()) };
    if found == 0 {
        return Err(LynxRuntimeError::Internal(
            "failed to resolve current lynx extension library path with dladdr".into(),
        ));
    }

    let info = unsafe { info.assume_init() };
    if info.dli_fname.is_null() {
        return Err(LynxRuntimeError::Internal(
            "dladdr returned no library file for lynx extension".into(),
        ));
    }

    let path = unsafe { CStr::from_ptr(info.dli_fname) }
        .to_string_lossy()
        .into_owned();
    let canonical = PathBuf::from(path).canonicalize().map_err(|error| {
        LynxRuntimeError::Internal(format!(
            "failed to canonicalize lynx extension library path: {error}"
        ))
    })?;
    Ok(canonical)
}

fn default_runtime_zip_path(library_file: &Path) -> PathBuf {
    // The runtime stays owned by the platform package atom beside the dylib;
    // the broker binary never becomes the storage location for the host app.
    library_file
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("."))
        .join(format!("runtime/{RUNTIME_ZIP_NAME}"))
}

fn fresh_launch_root() -> Result<PathBuf, LynxRuntimeError> {
    let launch_root = env::temp_dir()
        .join("opentray-ext-lynx")
        .join(unique_launch_id());
    fs::create_dir_all(&launch_root).map_err(|error| {
        LynxRuntimeError::Internal(format!(
            "failed to create lynx launch root {}: {error}",
            launch_root.display()
        ))
    })?;
    Ok(launch_root)
}

fn unique_launch_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}-{millis}", std::process::id())
}

fn extract_runtime_zip(runtime_zip: &Path, launch_root: &Path) -> Result<(), LynxRuntimeError> {
    let status = Command::new("/usr/bin/ditto")
        .arg("-x")
        .arg("-k")
        .arg(runtime_zip)
        .arg(launch_root)
        .status()
        .map_err(|error| {
            LynxRuntimeError::Internal(format!(
                "failed to launch ditto for {}: {error}",
                runtime_zip.display()
            ))
        })?;
    if !status.success() {
        return Err(LynxRuntimeError::Internal(format!(
            "failed to extract lynx runtime zip {}",
            runtime_zip.display()
        )));
    }
    Ok(())
}

fn stage_external_bundle(
    source_bundle: &Path,
    app_bundle: &Path,
) -> Result<String, LynxRuntimeError> {
    let resource_dir = app_bundle
        .join("Contents/Resources/Resource")
        .join(STAGED_EXTERNAL_DIR);
    fs::create_dir_all(&resource_dir).map_err(|error| {
        LynxRuntimeError::Internal(format!(
            "failed to create lynx runtime resource dir {}: {error}",
            resource_dir.display()
        ))
    })?;

    let staged_bundle = resource_dir.join(STAGED_EXTERNAL_BUNDLE_NAME);
    fs::copy(source_bundle, &staged_bundle).map_err(|error| {
        LynxRuntimeError::Internal(format!(
            "failed to stage lynx bundle {} into {}: {error}",
            source_bundle.display(),
            staged_bundle.display()
        ))
    })?;

    Ok(format!(
        "{STAGED_EXTERNAL_DIR}/{STAGED_EXTERNAL_BUNDLE_NAME}"
    ))
}

fn legacy_local_bundle_url(relative_bundle_path: &str) -> String {
    format!("file://lynx?local://{relative_bundle_path}")
}

fn resolve_runtime_stdio_mode() -> Result<RuntimeStdioMode, LynxRuntimeError> {
    let Some(value) = env::var_os(LYNX_RUNTIME_STDIO_ENV) else {
        return Ok(RuntimeStdioMode::Quiet);
    };
    let normalized = value.to_string_lossy().trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" | "quiet" | "null" => Ok(RuntimeStdioMode::Quiet),
        "inherit" => Ok(RuntimeStdioMode::Inherit),
        _ => Err(LynxRuntimeError::Rejected(format!(
            "{LYNX_RUNTIME_STDIO_ENV} must be one of: inherit, quiet, null"
        ))),
    }
}

fn spawn_runtime(
    runtime_executable: &Path,
    launch_url: &str,
    launch: &LynxLaunchConfig,
) -> Result<Child, LynxRuntimeError> {
    let mut command = Command::new(runtime_executable);
    let launch_json = serde_json::to_string(launch).map_err(|error| {
        LynxRuntimeError::Internal(format!(
            "failed to serialize lynx launch config for child process: {error}"
        ))
    })?;
    let stdio_mode = resolve_runtime_stdio_mode()?;
    command
        .arg(format!("--url={launch_url}"))
        .env(LYNX_WINDOW_CONFIG_ENV, launch_json);
    match stdio_mode {
        RuntimeStdioMode::Quiet => {
            command.stdout(Stdio::null()).stderr(Stdio::null());
        }
        RuntimeStdioMode::Inherit => {
            command.stdout(Stdio::inherit()).stderr(Stdio::inherit());
        }
    }
    command.spawn().map_err(|error| {
        LynxRuntimeError::Internal(format!(
            "failed to start lynx runtime {}: {error}",
            runtime_executable.display()
        ))
    })
}

fn verify_stability(child: &mut Child, window_ms: u64) -> Result<(), LynxRuntimeError> {
    thread::sleep(Duration::from_millis(window_ms));
    match child.try_wait().map_err(|error| {
        LynxRuntimeError::Internal(format!(
            "failed to inspect lynx runtime process {}: {error}",
            child.id()
        ))
    })? {
        Some(status) => Err(LynxRuntimeError::Internal(format!(
            "lynx runtime exited before launch stabilized: {status}"
        ))),
        None => Ok(()),
    }
}

fn close_slot(slot: &mut LynxSlot) -> Result<(), LynxRuntimeError> {
    match slot.child.try_wait().map_err(|error| {
        LynxRuntimeError::Internal(format!(
            "failed to inspect lynx runtime process {}: {error}",
            slot.child.id()
        ))
    })? {
        Some(_) => {}
        None => {
            slot.child.kill().map_err(|error| {
                LynxRuntimeError::Internal(format!(
                    "failed to stop lynx runtime process {}: {error}",
                    slot.child.id()
                ))
            })?;
            let _ = slot.child.wait();
        }
    }
    cleanup_launch_root(&slot.launch_root);
    Ok(())
}

fn cleanup_launch_root(launch_root: &Path) {
    if launch_root.exists() {
        let _ = fs::remove_dir_all(launch_root);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        close_slot, default_runtime_zip_path, legacy_local_bundle_url, resolve_runtime_stdio_mode,
        resolve_runtime_zip, spawn_runtime, stage_external_bundle, LynxRuntimeError, LynxSlot,
        MacosLynxRuntime, RuntimeStdioMode, RUNTIME_APP_BUNDLE_NAME, RUNTIME_ZIP_NAME,
        STAGED_EXTERNAL_BUNDLE_NAME, STAGED_EXTERNAL_DIR,
    };
    use crate::protocol::{LynxLaunchConfig, LynxWindowStyleConfig};
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::{LazyLock, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[test]
    fn default_runtime_zip_is_package_adjacent() {
        let library_file = PathBuf::from(
            "/tmp/node_modules/@opentray/ext-lynx-darwin-arm64/lib/libopentray_ext_lynx.dylib",
        );
        assert_eq!(
            default_runtime_zip_path(&library_file),
            PathBuf::from(
                "/tmp/node_modules/@opentray/ext-lynx-darwin-arm64/runtime/OpenTrayLynxRuntime.app.zip"
            )
        );
    }

    #[test]
    fn legacy_bundle_launch_uses_lynx_local_scheme() {
        let relative_path = format!("{STAGED_EXTERNAL_DIR}/{STAGED_EXTERNAL_BUNDLE_NAME}");
        assert_eq!(
            legacy_local_bundle_url(&relative_path),
            format!("file://lynx?local://{relative_path}")
        );
    }

    #[test]
    fn stages_external_bundle_into_runtime_resources() {
        let temp_root = test_dir("stage-external-bundle");
        let source_bundle = temp_root.join("external.lynx.bundle");
        let app_bundle = temp_root.join(RUNTIME_APP_BUNDLE_NAME);
        let resource_dir = app_bundle.join("Contents/Resources/Resource");

        fs::create_dir_all(&resource_dir).expect("create resource dir");
        fs::write(&source_bundle, b"bundle-bytes").expect("write source bundle");

        let relative_path =
            stage_external_bundle(&source_bundle, &app_bundle).expect("stage bundle");
        let staged_bundle = resource_dir
            .join(STAGED_EXTERNAL_DIR)
            .join(STAGED_EXTERNAL_BUNDLE_NAME);

        assert_eq!(
            relative_path,
            format!("{STAGED_EXTERNAL_DIR}/{STAGED_EXTERNAL_BUNDLE_NAME}")
        );
        assert_eq!(
            fs::read(&staged_bundle).expect("read staged bundle"),
            b"bundle-bytes"
        );

        fs::remove_dir_all(&temp_root).expect("cleanup temp dir");
    }

    #[test]
    fn missing_runtime_override_path_is_rejected_explicitly() {
        let _lock = ENV_LOCK.lock().expect("env lock");
        let missing = test_dir("missing-runtime").join(RUNTIME_ZIP_NAME);
        unsafe {
            std::env::set_var(super::LYNX_RUNTIME_ZIP_ENV, &missing);
        }

        let error = resolve_runtime_zip().expect_err("missing override should fail");
        assert!(
            matches!(error, LynxRuntimeError::Rejected(message) if message.contains(super::LYNX_RUNTIME_ZIP_ENV))
        );

        unsafe {
            std::env::remove_var(super::LYNX_RUNTIME_ZIP_ENV);
        }
    }

    #[test]
    fn runtime_stdio_defaults_to_quiet() {
        let _lock = ENV_LOCK.lock().expect("env lock");
        unsafe {
            std::env::remove_var(super::LYNX_RUNTIME_STDIO_ENV);
        }

        assert_eq!(
            resolve_runtime_stdio_mode().expect("default stdio mode"),
            RuntimeStdioMode::Quiet
        );
    }

    #[test]
    fn runtime_stdio_accepts_inherit() {
        let _lock = ENV_LOCK.lock().expect("env lock");
        unsafe {
            std::env::set_var(super::LYNX_RUNTIME_STDIO_ENV, "inherit");
        }

        assert_eq!(
            resolve_runtime_stdio_mode().expect("inherit stdio mode"),
            RuntimeStdioMode::Inherit
        );

        unsafe {
            std::env::remove_var(super::LYNX_RUNTIME_STDIO_ENV);
        }
    }

    #[test]
    fn invalid_runtime_stdio_mode_is_rejected_explicitly() {
        let _lock = ENV_LOCK.lock().expect("env lock");
        unsafe {
            std::env::set_var(super::LYNX_RUNTIME_STDIO_ENV, "verbose");
        }

        let error = resolve_runtime_stdio_mode().expect_err("invalid stdio mode should fail");
        assert!(
            matches!(error, LynxRuntimeError::Rejected(message) if message.contains(super::LYNX_RUNTIME_STDIO_ENV))
        );

        unsafe {
            std::env::remove_var(super::LYNX_RUNTIME_STDIO_ENV);
        }
    }

    #[test]
    fn hide_closes_active_slot_and_cleans_launch_root() {
        let launch_root = test_dir("hide-slot");
        fs::create_dir_all(&launch_root).expect("create launch root");
        let child = Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleep");

        let mut runtime = MacosLynxRuntime::default();
        runtime.slots.insert(
            "tray-1".into(),
            LynxSlot {
                child,
                launch_root: launch_root.clone(),
            },
        );

        let event = runtime.hide("tray-1").expect("hide succeeds");
        assert_eq!(event["type"], "hidden");
        assert!(!runtime.slots.contains_key("tray-1"));
        assert!(!launch_root.exists());
    }

    #[test]
    fn session_cleanup_closes_all_slots() {
        let mut runtime = MacosLynxRuntime::default();
        for tray_id in ["tray-1", "tray-2"] {
            let launch_root = test_dir(tray_id);
            fs::create_dir_all(&launch_root).expect("create launch root");
            let child = Command::new("sleep")
                .arg("30")
                .spawn()
                .expect("spawn sleep");
            runtime.slots.insert(
                tray_id.into(),
                LynxSlot {
                    child,
                    launch_root: launch_root.clone(),
                },
            );
        }

        runtime.session_closed("session-1");

        assert!(runtime.slots.is_empty());
    }

    #[test]
    fn close_slot_removes_launch_root() {
        let launch_root = test_dir("close-slot");
        fs::create_dir_all(&launch_root).expect("create launch root");
        let child = Command::new("sleep")
            .arg("30")
            .spawn()
            .expect("spawn sleep");
        let mut slot = LynxSlot {
            child,
            launch_root: launch_root.clone(),
        };

        close_slot(&mut slot).expect("close slot");

        assert!(!launch_root.exists());
    }

    #[test]
    fn spawn_runtime_injects_launch_config_environment() {
        let script_path = test_dir("spawn-runtime-env-script");
        let output_path = test_dir("spawn-runtime-env-output");
        fs::write(
            &script_path,
            format!(
                "#!/bin/sh\nprintf '%s' \"$OPENTRAY_LYNX_WINDOW_CONFIG_JSON\" > \"{}\"\nsleep 1\n",
                output_path.display()
            ),
        )
        .expect("write script");
        Command::new("chmod")
            .arg("+x")
            .arg(&script_path)
            .status()
            .expect("chmod script");

        let launch = LynxLaunchConfig {
            width: Some(520),
            height: None,
            min_width: Some(320),
            min_height: Some(180),
            max_width: None,
            max_height: None,
            native_window_api: true,
            bind_window_globals: false,
            native_screen_api: true,
            bind_screen_globals: true,
            title: Some("OpenTray Lynx".into()),
            icon: Some(crate::protocol::LynxWindowIconConfig::Href {
                href: "data:image/png;base64,AAAA".into(),
            }),
            style: LynxWindowStyleConfig {
                frameless: Some(true),
            },
        };
        let mut child = spawn_runtime(
            &script_path,
            "file://lynx?local://opentray-external/main.lynx.bundle",
            &launch,
        )
        .expect("spawn script runtime");
        let _ = child.wait();

        let serialized = fs::read_to_string(&output_path).expect("read output");
        let parsed: LynxLaunchConfig =
            serde_json::from_str(&serialized).expect("parse serialized launch config");
        assert_eq!(parsed, launch);
    }

    fn test_dir(label: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_millis();
        std::env::temp_dir().join(format!(
            "opentray-ext-lynx-tests-{label}-{}-{millis}",
            std::process::id()
        ))
    }
}
