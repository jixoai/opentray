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

use crate::{opentray_ext_abi_version, LynxCommand, LynxRuntimeError};

const STAGED_EXTERNAL_DIR: &str = "opentray-external";
const STAGED_EXTERNAL_BUNDLE_NAME: &str = "main.lynx.bundle";
const LYNX_RUNTIME_ZIP_ENV: &str = "OPENTRAY_LYNX_RUNTIME_ZIP";
const LAUNCH_STABILITY_WINDOW_MS: u64 = 300;

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
}

impl MacosLynxRuntime {
    pub(crate) fn handle(
        &mut self,
        tray_id: &str,
        command: LynxCommand,
    ) -> Result<Value, LynxRuntimeError> {
        match command {
            LynxCommand::Show { bundle_path } => self.show(tray_id, &bundle_path),
            LynxCommand::Hide => self.hide(tray_id),
        }
    }

    pub(crate) fn lease_closed(&mut self, _lease_id: &str) {
        self.close_all();
    }

    fn show(&mut self, tray_id: &str, bundle_path: &str) -> Result<Value, LynxRuntimeError> {
        let _ = self.hide(tray_id);

        let prepared = PreparedLaunch::prepare(bundle_path)?;
        let mut child = spawn_runtime(&prepared.runtime_executable, &prepared.launch_url)?;

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
    fn prepare(bundle_path: &str) -> Result<Self, LynxRuntimeError> {
        let bundle_path = canonicalize_bundle(bundle_path)?;
        let runtime_zip = resolve_runtime_zip()?;
        let launch_root = fresh_launch_root()?;
        extract_runtime_zip(&runtime_zip, &launch_root)?;
        let app_bundle = launch_root.join("LynxExplorer.app");
        let relative_bundle_path = stage_external_bundle(&bundle_path, &app_bundle)?;
        let runtime_executable = app_bundle.join("Contents/MacOS/LynxExplorer");
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
                "{LYNX_RUNTIME_ZIP_ENV} must point to LynxExplorer.app.zip: {}",
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
    // the broker binary never becomes the storage location for Lynx Explorer.
    library_file
        .parent()
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("."))
        .join("runtime/LynxExplorer.app.zip")
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

fn spawn_runtime(runtime_executable: &Path, launch_url: &str) -> Result<Child, LynxRuntimeError> {
    let mut command = Command::new(runtime_executable);
    command
        .arg(format!("--url={launch_url}"))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
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
        close_slot, default_runtime_zip_path, legacy_local_bundle_url, resolve_runtime_zip,
        stage_external_bundle, LynxRuntimeError, LynxSlot, MacosLynxRuntime,
        STAGED_EXTERNAL_BUNDLE_NAME, STAGED_EXTERNAL_DIR,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn default_runtime_zip_is_package_adjacent() {
        let library_file =
            PathBuf::from("/tmp/node_modules/@opentray/ext-lynx-darwin-arm64/lib/libopentray_ext_lynx.dylib");
        assert_eq!(
            default_runtime_zip_path(&library_file),
            PathBuf::from(
                "/tmp/node_modules/@opentray/ext-lynx-darwin-arm64/runtime/LynxExplorer.app.zip"
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
        let app_bundle = temp_root.join("LynxExplorer.app");
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
        let missing = test_dir("missing-runtime").join("LynxExplorer.app.zip");
        unsafe {
            std::env::set_var(super::LYNX_RUNTIME_ZIP_ENV, &missing);
        }

        let error = resolve_runtime_zip().expect_err("missing override should fail");
        assert!(matches!(error, LynxRuntimeError::Rejected(message) if message.contains(super::LYNX_RUNTIME_ZIP_ENV)));

        unsafe {
            std::env::remove_var(super::LYNX_RUNTIME_ZIP_ENV);
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
    fn lease_cleanup_closes_all_slots() {
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

        runtime.lease_closed("lease-1");

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
