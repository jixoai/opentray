#[cfg(target_os = "macos")]
mod macos {
    use std::env;
    use std::error::Error;
    use std::ffi::OsString;
    use std::fs::{self, File};
    use std::io::{self, Write};
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use url::Url;

    #[derive(Debug, Default)]
    struct Cli {
        app: Option<PathBuf>,
        bundle: Option<PathBuf>,
        url: Option<String>,
        runtime_zip: Option<PathBuf>,
        launch_log_out: Option<PathBuf>,
        process_snapshot_out: Option<PathBuf>,
        resolved_url_out: Option<PathBuf>,
        stability_window_ms: Option<u64>,
        kill_after_stability_window: bool,
    }

    pub fn run() -> Result<(), Box<dyn Error>> {
        let cli = Cli::parse(env::args_os().skip(1))?;
        let launch_url = cli.launch_url()?;
        if let Some(path) = &cli.resolved_url_out {
            write_text(path, &(launch_url.clone() + "\n"))?;
        }

        let runtime_executable = cli.resolve_runtime_executable()?;
        let mut child = cli.spawn_runtime(&runtime_executable, &launch_url)?;

        match cli.stability_window_ms {
            None => Ok(()),
            Some(window_ms) => cli.verify_stability(&mut child, window_ms),
        }
    }

    impl Cli {
        fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Self, Box<dyn Error>> {
            let mut cli = Self::default();
            let mut iter = args.into_iter();

            while let Some(arg) = iter.next() {
                let arg = arg.to_string_lossy();
                match arg.as_ref() {
                    "--help" | "-h" => {
                        print_help();
                        std::process::exit(0);
                    }
                    "--app" => cli.app = Some(next_path(&mut iter, "--app")?),
                    "--bundle" => cli.bundle = Some(next_path(&mut iter, "--bundle")?),
                    "--url" => cli.url = Some(next_string(&mut iter, "--url")?),
                    "--runtime-zip" => {
                        cli.runtime_zip = Some(next_path(&mut iter, "--runtime-zip")?)
                    }
                    "--launch-log-out" => {
                        cli.launch_log_out = Some(next_path(&mut iter, "--launch-log-out")?)
                    }
                    "--process-snapshot-out" => {
                        cli.process_snapshot_out =
                            Some(next_path(&mut iter, "--process-snapshot-out")?)
                    }
                    "--resolved-url-out" => {
                        cli.resolved_url_out = Some(next_path(&mut iter, "--resolved-url-out")?)
                    }
                    "--stability-window-ms" => {
                        cli.stability_window_ms =
                            Some(next_string(&mut iter, "--stability-window-ms")?.parse()?)
                    }
                    "--kill-after-stability-window" => cli.kill_after_stability_window = true,
                    other => {
                        return Err(format!("unrecognized argument: {other}").into());
                    }
                }
            }

            let has_bundle = cli.bundle.is_some();
            let has_url = cli.url.is_some();
            if has_bundle == has_url {
                return Err("exactly one of --bundle or --url is required".into());
            }

            Ok(cli)
        }

        fn launch_url(&self) -> Result<String, Box<dyn Error>> {
            if let Some(url) = &self.url {
                return Ok(url.clone());
            }

            let bundle = self
                .bundle
                .as_ref()
                .expect("validated bundle/url exclusivity");
            let bundle = bundle.canonicalize()?;
            Url::from_file_path(&bundle)
                .map(|url| url.to_string())
                .map_err(|()| {
                    format!(
                        "failed to convert bundle path to file URL: {}",
                        bundle.display()
                    )
                    .into()
                })
        }

        fn resolve_runtime_executable(&self) -> Result<PathBuf, Box<dyn Error>> {
            if let Some(path) = &self.app {
                return app_executable_path(path);
            }

            let current_exe = env::current_exe()?;
            let exe_dir = current_exe
                .parent()
                .ok_or("current executable has no parent directory")?;

            let sibling_app = exe_dir.join("LynxExplorer.app");
            if sibling_app.is_dir() {
                return app_executable_path(&sibling_app);
            }

            let runtime_zip = self
                .runtime_zip
                .clone()
                .unwrap_or_else(|| exe_dir.join("LynxExplorer.app.zip"));
            if runtime_zip.is_file() {
                return extract_runtime_zip(&runtime_zip);
            }

            Err(format!(
                "could not resolve Lynx runtime; checked --app, {} and {}",
                sibling_app.display(),
                runtime_zip.display()
            )
            .into())
        }

        fn spawn_runtime(
            &self,
            runtime_executable: &Path,
            launch_url: &str,
        ) -> Result<Child, Box<dyn Error>> {
            let mut command = Command::new(runtime_executable);
            command.arg(format!("--url={launch_url}"));

            if let Some(log_path) = &self.launch_log_out {
                if let Some(parent) = log_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let log_file = File::create(log_path)?;
                let log_file_err = log_file.try_clone()?;
                command.stdout(Stdio::from(log_file));
                command.stderr(Stdio::from(log_file_err));
            }

            Ok(command.spawn()?)
        }

        fn verify_stability(
            &self,
            child: &mut Child,
            window_ms: u64,
        ) -> Result<(), Box<dyn Error>> {
            thread::sleep(Duration::from_millis(window_ms));

            if let Some(status) = child.try_wait()? {
                return Err(format!(
                    "Lynx runtime exited before stability window with status {status}"
                )
                .into());
            }

            if let Some(path) = &self.process_snapshot_out {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let output = Command::new("/bin/ps")
                    .arg("-p")
                    .arg(child.id().to_string())
                    .arg("-o")
                    .arg("pid=,etime=,command=")
                    .output()?;
                if !output.status.success() {
                    return Err("failed to collect process snapshot with ps".into());
                }
                fs::write(path, output.stdout)?;
            }

            if self.kill_after_stability_window {
                child.kill()?;
                let _ = child.wait()?;
            }

            Ok(())
        }
    }

    fn app_executable_path(path: &Path) -> Result<PathBuf, Box<dyn Error>> {
        if path.is_file() {
            return Ok(path.to_path_buf());
        }

        let executable = path.join("Contents/MacOS/LynxExplorer");
        if executable.is_file() {
            return Ok(executable);
        }

        Err(format!(
            "expected Lynx app bundle or executable, got {}",
            path.display()
        )
        .into())
    }

    fn extract_runtime_zip(runtime_zip: &Path) -> Result<PathBuf, Box<dyn Error>> {
        let launch_root = env::temp_dir()
            .join("opentray-lynx-window-cli")
            .join(unique_launch_id());
        fs::create_dir_all(&launch_root)?;

        let status = Command::new("/usr/bin/ditto")
            .arg("-x")
            .arg("-k")
            .arg(runtime_zip)
            .arg(&launch_root)
            .status()?;
        if !status.success() {
            return Err(format!("failed to extract {}", runtime_zip.display()).into());
        }

        let app_path = launch_root.join("LynxExplorer.app");
        app_executable_path(&app_path)
    }

    fn unique_launch_id() -> String {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        format!("{}-{}", std::process::id(), millis)
    }

    fn next_string(
        iter: &mut impl Iterator<Item = OsString>,
        flag: &str,
    ) -> Result<String, Box<dyn Error>> {
        iter.next()
            .map(|value| value.to_string_lossy().into_owned())
            .ok_or_else(|| format!("{flag} requires a value").into())
    }

    fn next_path(
        iter: &mut impl Iterator<Item = OsString>,
        flag: &str,
    ) -> Result<PathBuf, Box<dyn Error>> {
        iter.next()
            .map(PathBuf::from)
            .ok_or_else(|| format!("{flag} requires a value").into())
    }

    fn write_text(path: &Path, value: &str) -> Result<(), io::Error> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = File::create(path)?;
        file.write_all(value.as_bytes())
    }

    fn print_help() {
        println!(
            "\
lynx-window-cli

Usage:
  lynx-window-cli (--bundle <path> | --url <url>) [options]

Options:
  --app <path>                   Existing LynxExplorer.app or executable path
  --runtime-zip <path>           Runtime zip to extract when --app is omitted
  --launch-log-out <path>        Redirect runtime stdout/stderr to a file
  --resolved-url-out <path>      Write the resolved launch URL to a file
  --stability-window-ms <ms>     Fail if the runtime exits before this window
  --process-snapshot-out <path>  Write `ps` output for the spawned runtime
  --kill-after-stability-window  Terminate the runtime after a successful stability check
  -h, --help                     Show this help
"
        );
    }

    #[cfg(test)]
    mod tests {
        use super::Cli;
        use std::ffi::OsString;
        use std::path::PathBuf;

        #[test]
        fn parses_bundle_invocation() {
            let cli = Cli::parse(
                [
                    OsString::from("--bundle"),
                    OsString::from("demo/main.lynx.bundle"),
                    OsString::from("--stability-window-ms"),
                    OsString::from("1000"),
                    OsString::from("--kill-after-stability-window"),
                ]
                .into_iter(),
            )
            .expect("cli parses");

            assert_eq!(cli.bundle, Some(PathBuf::from("demo/main.lynx.bundle")));
            assert_eq!(cli.stability_window_ms, Some(1000));
            assert!(cli.kill_after_stability_window);
        }

        #[test]
        fn requires_exactly_one_launch_source() {
            let error = Cli::parse(
                [
                    OsString::from("--bundle"),
                    OsString::from("demo/main.lynx.bundle"),
                    OsString::from("--url"),
                    OsString::from("https://example.com/app.lynx.bundle"),
                ]
                .into_iter(),
            )
            .expect_err("bundle and url together should fail");

            assert!(error
                .to_string()
                .contains("exactly one of --bundle or --url is required"));
        }
    }
}

#[cfg(target_os = "macos")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    macos::run()
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("lynx-window-cli is currently implemented for macOS research only");
    std::process::exit(1);
}
