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
});
