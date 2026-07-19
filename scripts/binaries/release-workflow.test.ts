import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const releaseWorkflow = (): string =>
  readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
const packageJson = (): string => readFileSync(resolve(repoRoot, "package.json"), "utf8");
const packedConsumerScript = (): string =>
  readFileSync(resolve(repoRoot, "scripts/binaries/verify-packed-consumer.ts"), "utf8");

describe("Feature: release native binary CI law", () => {
  test("Scenario: Given release native artifacts When workflow is inspected Then Rust setup cache and artifact transport use maintained Actions", () => {
    const workflow = releaseWorkflow();

    expect(workflow).toContain("uses: actions/setup-node@v6");
    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toContain("uses: dtolnay/rust-toolchain@stable");
    expect(workflow).toContain("uses: Swatinem/rust-cache@v2");
    expect(workflow).toContain("uses: actions/upload-artifact@v4");
    expect(workflow).toContain("uses: actions/download-artifact@v4");
    expect(workflow).toContain('OPENTRAY_BUILD_IDENTITY: "github:${{ github.sha }}"');
  });

  test("Scenario: Given npm publish staging When workflow is inspected Then package tarballs receive GitHub-built artifacts only", () => {
    const workflow = releaseWorkflow();
    const prepareJob = workflow.slice(
      workflow.indexOf("  prepare-release:"),
      workflow.indexOf("  native-artifacts:"),
    );
    const nativeJob = workflow.slice(
      workflow.indexOf("  native-artifacts:"),
      workflow.indexOf("  release:"),
    );
    const releaseJob = workflow.slice(workflow.indexOf("  release:"));

    expect(workflow).toContain("Plan native release build");
    expect(workflow).toContain('bun run scripts/binaries/release-plan.ts --root "$PWD"');
    expect(workflow).toContain("publish-enabled: ${{ steps.plan.outputs.publish-enabled }}");
    expect(workflow).toContain(
      "packed-consumer-enabled: ${{ steps.plan.outputs.packed-consumer-enabled }}",
    );
    expect(workflow).toContain(
      "packed-consumer-matrix: ${{ steps.plan.outputs.packed-consumer-matrix }}",
    );
    expect(workflow).toContain(
      'publish_enabled = "true" if plan.get("publishEnabled") else "false"',
    );
    expect(nativeJob).toContain("if: needs.plan-native.outputs.enabled == 'true'");
    expect(nativeJob).toContain("matrix: ${{ fromJson(needs.plan-native.outputs.matrix) }}");
    expect(nativeJob).toContain("bun run scripts/binaries/build-native-job.ts");
    expect(nativeJob).toContain("name: ${{ matrix.artifactName }}");
    expect(nativeJob).toContain("ref: ${{ needs.prepare-release.outputs.source-ref }}");
    expect(nativeJob).toContain("Apply alpha release source patch");
    const packedJob = workflow.slice(
      workflow.indexOf("  packed-consumer:"),
      workflow.indexOf("  release:"),
    );
    expect(packedJob).toContain("runs-on: ${{ matrix.runner }}");
    expect(packedJob).toContain(
      "matrix: ${{ fromJson(needs.plan-native.outputs.packed-consumer-matrix) }}",
    );
    expect(packedJob).toContain(
      "pnpm run verify:packed-consumer -- --package-manager pnpm --target",
    );
    expect(packedJob).toContain(
      "pnpm run verify:packed-consumer -- --package-manager npm --target",
    );
    expect(packedConsumerScript()).toContain('value === "windows-arm64"');
    expect(packedConsumerScript()).toContain('value === "windows-x64"');
    expect(releaseJob).toContain("- packed-consumer");
    expect(prepareJob).toContain("pnpm run version-packages");
    expect(prepareJob).toContain('git commit -m "chore: version packages"');
    expect(prepareJob).toContain('source_ref="$(git rev-parse HEAD)"');
    expect(releaseJob).toContain("Download native artifacts");
    expect(releaseJob).toContain("Stage native artifacts into npm packages");
    expect(releaseJob).toContain("bun run scripts/binaries/stage-release-artifacts.ts");
    expect(releaseJob).toContain("bun run scripts/binaries/validate-package-dirs.ts");
    expect(releaseJob).toContain("git push origin --tags");
    expect(releaseJob).toContain("Backfill release tags");
    expect(releaseJob).toContain("pnpm exec changeset tag");
    expect(releaseJob).toContain(
      "needs.plan-native.outputs.publish-enabled == 'true' && needs.prepare-release.outputs.channel == 'stable'",
    );
    expect(releaseJob).not.toContain("git push --follow-tags");
    expect(releaseJob).not.toContain("--source target/release");
    expect(releaseJob).not.toContain("stage-local.ts");
  });

  test("Scenario: Given alpha channel publish When workflow is inspected Then snapshot versioning and alpha dist-tag stay separate from stable release tags", () => {
    const workflow = releaseWorkflow();
    const pkg = packageJson();
    const prepareJob = workflow.slice(
      workflow.indexOf("  prepare-release:"),
      workflow.indexOf("  native-artifacts:"),
    );
    const releaseJob = workflow.slice(workflow.indexOf("  release:"));

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("channel:");
    expect(prepareJob).toContain("Resolve release channel");
    expect(prepareJob).toContain("pnpm run version-packages:alpha");
    expect(prepareJob).toContain("git diff --binary -- . > release-source.patch");
    expect(prepareJob).toContain("Upload alpha release source patch");
    expect(releaseJob).toContain("Apply alpha release source patch");
    expect(releaseJob).toContain("Publish alpha packages");
    expect(releaseJob).toContain("pnpm run release:alpha");
    expect(releaseJob).toContain("needs.prepare-release.outputs.channel == 'stable'");
    expect(releaseJob).toContain("needs.prepare-release.outputs.channel == 'alpha'");
    expect(releaseJob).toContain(
      "needs.prepare-release.outputs.has-changesets == 'true' && needs.prepare-release.outputs.channel == 'alpha'",
    );
    expect(pkg).toContain('"version-packages:alpha": "changeset version --snapshot alpha"');
    expect(pkg).toContain('"release:alpha": "changeset publish --tag alpha --no-git-tag"');
  });
});
