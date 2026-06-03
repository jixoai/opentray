import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const releaseWorkflow = (): string =>
  readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");

describe("Feature: release native binary CI law", () => {
  test("Scenario: Given release native artifacts When workflow is inspected Then Rust setup cache and artifact transport use maintained Actions", () => {
    const workflow = releaseWorkflow();

    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain("uses: dtolnay/rust-toolchain@stable");
    expect(workflow).toContain("uses: actions/cache/restore@v4");
    expect(workflow).toContain("uses: actions/cache/save@v4");
    expect(workflow).toContain("uses: Swatinem/rust-cache@v2");
    expect(workflow).toContain("uses: actions/upload-artifact@v4");
    expect(workflow).toContain("uses: actions/download-artifact@v4");
  });

  test("Scenario: Given npm publish staging When workflow is inspected Then package tarballs receive GitHub-built artifacts only", () => {
    const workflow = releaseWorkflow();
    const releaseJob = workflow.slice(workflow.indexOf("  release:"));

    expect(workflow).toContain("packages+=(-p opentray-ext-lynx)");
    expect(workflow).toContain("Seed Googlesource hosts");
    expect(workflow).toContain(
      "sudo python3 scripts/ci/seed_hosts_from_doh.py"
    );
    expect(workflow).toContain("flutter.googlesource.com");
    expect(workflow).toContain("Build Lynx runtime sidecar");
    expect(workflow).toContain("python3 scripts/ci/run_with_watchdog.py");
    expect(workflow).toContain(
      'bash scripts/release/build-lynx-runtime.sh "native-artifacts/OpenTrayLynxRuntime.app.zip"'
    );
    expect(workflow).toContain("'native/lynx-runtime-macos/**'");
    expect(workflow).toContain("job_timeout_minutes: 90");
    expect(workflow).toContain("lynx_timeout_seconds: 4500");
    expect(workflow).toContain("Upload Lynx build logs");
    expect(workflow).toContain("research/lynx/logs/**");
    expect(releaseJob).toContain("Download native artifacts");
    expect(releaseJob).toContain("Stage native artifacts into npm packages");
    expect(releaseJob).toContain("Validate publish package contents");
    expect(releaseJob).toContain("packages/cli");
    expect(releaseJob).toContain("packages/ext-lynx");
    expect(releaseJob).not.toContain("packages/darwin-x64");
    expect(releaseJob).not.toContain("packages/ext-webview-darwin-x64");
    expect(releaseJob).not.toContain("packages/ext-lynx-darwin-x64");
    expect(releaseJob).toContain(
      '--source "native-artifacts/native-${target}/${daemon_artifact}"'
    );
    expect(releaseJob).toContain(
      '--source "native-artifacts/native-${target}/${webview_artifact}"'
    );
    expect(releaseJob).toContain("--kind lynx");
    expect(releaseJob).toContain("--kind lynx-runtime");
    expect(releaseJob).toContain("git push origin --tags");
    expect(releaseJob).not.toContain("git push --follow-tags");
    expect(releaseJob).not.toContain("--source target/release");
    expect(workflow).not.toContain("darwin-x64");
  });
});
