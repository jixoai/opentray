// Orthogonal intents (2026-07-21; original user requests: opening the stable
// app-mode entry launches the remembered command and leaves durable diagnostics):
// 1. Prove the shipped Darwin binary executes a valid descriptor without broker args.
// 2. Prove malformed launch state exits non-zero without invoking a consumer.
// 3. Prove carrier errors and early consumer stderr survive LaunchServices exit.

#![cfg(target_os = "macos")]

use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[test]
fn darwin_carrier_cold_launch_executes_the_persisted_vector_once() {
    let fixture = CarrierFixture::new("valid");
    let marker = fixture.root.join("consumer-started.log");
    let consumer = fixture.write_consumer_script();
    fixture.write_descriptor(serde_json::json!({
        "schemaVersion": 1,
        "command": consumer,
        "args": ["--from-dock", marker],
        "cwd": fixture.root,
    }));

    let status = Command::new(&fixture.executable)
        .status()
        .expect("run Darwin carrier");

    assert!(status.success());
    wait_for_file(&marker);
    assert_eq!(
        fs::read_to_string(&marker).expect("read consumer log"),
        format!(
            "--from-dock|{}\n",
            fixture
                .root
                .canonicalize()
                .expect("canonical fixture root")
                .display()
        )
    );
    wait_for_log(&fixture.log, "consumer stderr diagnostic");
    let log = fs::read_to_string(&fixture.log).expect("read carrier log");
    assert!(log.contains("consumer stderr diagnostic"));
    assert!(log.contains("consumer-spawned"));
    assert!(log.contains("\"pid\":"));
}

#[test]
fn darwin_carrier_cold_launch_rejects_unknown_descriptor_fields() {
    let fixture = CarrierFixture::new("invalid");
    let marker = fixture.root.join("consumer-must-not-start");
    fixture.write_descriptor(serde_json::json!({
        "schemaVersion": 1,
        "command": "/usr/bin/touch",
        "args": [marker],
        "cwd": fixture.root,
        "env": {},
    }));

    let output = Command::new(&fixture.executable)
        .output()
        .expect("run Darwin carrier");

    assert!(!output.status.success());
    assert!(!marker.exists());
    let log = fs::read_to_string(&fixture.log).expect("read carrier log");
    assert!(log.contains("opentray-launch.json"));
    assert!(log.contains("launch-error"));
}

#[test]
fn darwin_carrier_logs_a_missing_descriptor_without_a_terminal() {
    let fixture = CarrierFixture::new("missing");

    let output = Command::new(&fixture.executable)
        .output()
        .expect("run Darwin carrier");

    assert!(!output.status.success());
    let log = fs::read_to_string(&fixture.log).expect("read carrier log");
    assert!(log.contains("launch-error"));
    assert!(log.contains("opentray-launch.json"));
    assert!(!log.contains("processEnv"));
}

struct CarrierFixture {
    root: PathBuf,
    executable: PathBuf,
    descriptor: PathBuf,
    log: PathBuf,
}

impl CarrierFixture {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "opentray-app-launch-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        let executable = root.join("Test.app/Contents/MacOS/opentray");
        let descriptor = root.join("Test.app/Contents/Resources/opentray-launch.json");
        let log = root.join("Test.app/Contents/Resources/opentray-launch.log");
        fs::create_dir_all(executable.parent().expect("executable parent"))
            .expect("create carrier executable directory");
        fs::create_dir_all(descriptor.parent().expect("descriptor parent"))
            .expect("create carrier resource directory");
        fs::copy(env!("CARGO_BIN_EXE_opentray"), &executable).expect("copy carrier executable");
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
            .expect("mark carrier executable");
        Self {
            root,
            executable,
            descriptor,
            log,
        }
    }

    fn write_consumer_script(&self) -> PathBuf {
        let script = self.root.join("consumer.sh");
        fs::write(
            &script,
            "#!/bin/sh\nprintf '%s|%s\\n' \"$1\" \"$PWD\" >> \"$2\"\nprintf 'consumer stderr diagnostic\\n' >&2\n",
        )
        .expect("write consumer script");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755))
            .expect("mark consumer script executable");
        script
    }

    fn write_descriptor(&self, value: serde_json::Value) {
        fs::write(
            &self.descriptor,
            serde_json::to_vec(&value).expect("serialize launch descriptor"),
        )
        .expect("write launch descriptor");
    }
}

impl Drop for CarrierFixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).expect("remove carrier fixture");
    }
}

fn wait_for_file(path: &Path) {
    for _ in 0..50 {
        if path.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!("consumer marker was not created: {}", path.display());
}

fn wait_for_log(path: &Path, expected: &str) {
    for _ in 0..100 {
        if fs::read_to_string(path)
            .map(|value| value.contains(expected))
            .unwrap_or(false)
        {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!("carrier log did not contain {expected}: {}", path.display());
}
