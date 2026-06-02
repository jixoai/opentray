import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const releaseWorkflow = (): string => readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");

describe("Feature: release native binary CI law", () => {
  test("Scenario: Given release native artifacts When workflow is inspected Then Rust setup cache and artifact transport use maintained Actions", () => {
    const workflow = releaseWorkflow();

    expect(workflow).toContain("uses: dtolnay/rust-toolchain@stable");
    expect(workflow).toContain("uses: Swatinem/rust-cache@v2");
    expect(workflow).toContain("uses: actions/upload-artifact@v4");
    expect(workflow).toContain("uses: actions/download-artifact@v4");
  });

  test("Scenario: Given npm publish staging When workflow is inspected Then package tarballs receive GitHub-built artifacts only", () => {
    const workflow = releaseWorkflow();
    const releaseJob = workflow.slice(workflow.indexOf("  release:"));

    expect(workflow).toContain("packages+=(-p opentray-ext-lynx)");
    expect(workflow).toContain("bash scripts/release/build-lynx-runtime.sh \"native-artifacts/LynxExplorer.app.zip\"");
    expect(releaseJob).toContain("Download native artifacts");
    expect(releaseJob).toContain("Stage native artifacts into npm packages");
    expect(releaseJob).toContain("--source \"native-artifacts/native-${target}/${daemon_artifact}\"");
    expect(releaseJob).toContain("--source \"native-artifacts/native-${target}/${webview_artifact}\"");
    expect(releaseJob).toContain("--kind lynx");
    expect(releaseJob).toContain("--kind lynx-runtime");
    expect(releaseJob).not.toContain("--source target/release");
  });
});
