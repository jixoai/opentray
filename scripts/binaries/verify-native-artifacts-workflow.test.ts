import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const verifyWorkflow = (): string =>
  readFileSync(resolve(repoRoot, ".github/workflows/verify-native-artifacts.yml"), "utf8");

describe("Feature: native artifact verification workflow", () => {
  test("Scenario: Given feature work changes native packaging When maintainers inspect the verification workflow Then native atoms are planned independently without publishing npm packages", () => {
    const workflow = verifyWorkflow();
    const nativeJob = workflow.slice(workflow.indexOf("  native-artifacts:"));
    const stageJob = workflow.slice(workflow.indexOf("  stage-and-pack:"));

    expect(workflow).toContain("name: Verify Native Artifacts");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('OPENTRAY_BUILD_IDENTITY: "github:${{ github.sha }}"');
    expect(workflow).toContain("Plan native verification build");
    expect(workflow).toContain("bun run scripts/binaries/verify-native-plan.ts");
    expect(workflow).toContain("matrix: ${{ fromJson(needs.plan-native.outputs.matrix) }}");
    expect(nativeJob).toContain("bun run scripts/binaries/build-native-job.ts");
    expect(nativeJob).toContain("name: ${{ matrix.artifactName }}");
    expect(workflow).toContain("name: Stage and pack native npm packages");
    expect(stageJob).toContain("bun run scripts/binaries/stage-release-artifacts.ts");
    expect(stageJob).toContain("bun run scripts/binaries/validate-package-dirs.ts");
    expect(stageJob).not.toContain("stage-local.ts");
    expect(workflow).not.toContain("pnpm run release");
    expect(workflow).not.toContain("environment: npm-release");
  });

  test("Scenario: Given the embedded dialog facade is staged When the stage-and-pack job runs Then real pack evidence is produced and uploaded", () => {
    const workflow = verifyWorkflow();
    const planJob = workflow.slice(
      workflow.indexOf("  plan-native:"),
      workflow.indexOf("  native-artifacts:")
    );
    const stageJob = workflow.slice(workflow.indexOf("  stage-and-pack:"));

    // The plan exposes whether dialog is staged so the evidence steps gate on it.
    expect(planJob).toContain("dialog-staged: ${{ steps.plan.outputs.dialog-staged }}");
    // Real pack gate (never --dry-run) + unpack identity evidence.
    expect(stageJob).toContain("pnpm run check:pack-size");
    expect(stageJob).not.toContain("check:pack-size -- --dry-run");
    expect(stageJob).toContain(
      "bun run scripts/binaries/verify-embedded-pack-evidence.ts"
    );
    expect(stageJob).toContain("--package packages/ext-dialog");
    // Evidence lands as a deterministically named workflow artifact (task 5.2).
    expect(stageJob).toContain("name: ext-dialog-pack-evidence");
    expect(stageJob).toContain("ext-dialog-pack-receipt.txt");
    expect(stageJob).toContain("ext-dialog-pack-identity.txt");
    expect(stageJob).toContain("if-no-files-found: error");
    expect(stageJob).toContain(
      "if: needs.plan-native.outputs.dialog-staged == 'true'"
    );
  });
});
