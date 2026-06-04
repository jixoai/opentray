import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const releaseWorkflow = (): string =>
  readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
const packageJson = (): string =>
  readFileSync(resolve(repoRoot, "package.json"), "utf8");

describe("Feature: release native binary CI law", () => {
  test("Scenario: Given release native artifacts When workflow is inspected Then Rust setup cache and artifact transport use maintained Actions", () => {
    const workflow = releaseWorkflow();

    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("uses: dtolnay/rust-toolchain@stable");
    expect(workflow).toContain("uses: actions/cache/restore@v4");
    expect(workflow).toContain("uses: actions/cache/save@v4");
    expect(workflow).toContain("uses: Swatinem/rust-cache@v2");
    expect(workflow).toContain("uses: actions/upload-artifact@v4");
    expect(workflow).toContain("uses: actions/download-artifact@v4");
  });

  test("Scenario: Given npm publish staging When workflow is inspected Then package tarballs receive GitHub-built artifacts only", () => {
    const workflow = releaseWorkflow();
    const nativeJob = workflow.slice(workflow.indexOf("  native-artifacts:"));
    const releaseJob = workflow.slice(workflow.indexOf("  release:"));

    expect(workflow).toContain("Plan native release build");
    expect(workflow).toContain("bun run scripts/binaries/release-plan.ts --root \"$PWD\"");
    expect(nativeJob).toContain("if: needs.plan-native.outputs.enabled == 'true'");
    expect(nativeJob).toContain("matrix: ${{ fromJson(needs.plan-native.outputs.matrix) }}");
    expect(nativeJob).toContain("if: matrix.buildsLynxRuntime == true");
    expect(nativeJob).toContain("bun run scripts/binaries/build-native-job.ts");
    expect(nativeJob).not.toContain("packages+=(-p opentray-ext-lynx)");
    expect(releaseJob).toContain("Download native artifacts");
    expect(releaseJob).toContain("Stage native artifacts into npm packages");
    expect(releaseJob).toContain("bun run scripts/binaries/stage-release-artifacts.ts");
    expect(releaseJob).toContain("bun run scripts/binaries/validate-package-dirs.ts");
    expect(workflow).toContain("Seed Googlesource hosts");
    expect(workflow).toContain(
      "sudo python3 scripts/ci/seed_hosts_from_doh.py"
    );
    expect(workflow).toContain("flutter.googlesource.com");
    expect(workflow).toContain("'native/lynx-runtime-macos/**'");
    expect(workflow).toContain("'native/lynx-patches/**'");
    expect(workflow).toContain("Upload Lynx build logs");
    expect(workflow).toContain("research/lynx/logs/**");
    expect(releaseJob).toContain("git push origin --tags");
    expect(releaseJob).not.toContain("git push --follow-tags");
    expect(releaseJob).not.toContain("--source target/release");
    expect(releaseJob).not.toContain("stage-local.ts");
  });

  test("Scenario: Given alpha channel publish When workflow is inspected Then snapshot versioning and alpha dist-tag stay separate from stable release tags", () => {
    const workflow = releaseWorkflow();
    const pkg = packageJson();
    const releaseJob = workflow.slice(workflow.indexOf("  release:"));

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("channel:");
    expect(releaseJob).toContain("Resolve release channel");
    expect(releaseJob).toContain("Snapshot packages for alpha");
    expect(releaseJob).toContain("pnpm run version-packages:alpha");
    expect(releaseJob).toContain("Publish alpha packages");
    expect(releaseJob).toContain("pnpm run release:alpha");
    expect(releaseJob).toContain("steps.release-channel.outputs.channel == 'stable'");
    expect(releaseJob).toContain("steps.release-channel.outputs.channel == 'alpha'");
    expect(pkg).toContain("\"version-packages:alpha\": \"changeset version --snapshot alpha\"");
    expect(pkg).toContain("\"release:alpha\": \"changeset publish --tag alpha --no-git-tag\"");
  });
});
