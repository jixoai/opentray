import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const previewWorkflow = (): string =>
  readFileSync(resolve(repoRoot, ".github/workflows/preview-native.yml"), "utf8");

describe("Feature: changeset-gated preview build workflow", () => {
  test("Scenario: Given automatic preview build When the workflow is inspected Then it is triggered by changeset file updates", () => {
    const workflow = previewWorkflow();

    expect(workflow).toContain("push:");
    expect(workflow).toContain(".changeset/*.md");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("Collect changed changesets");
    expect(workflow).toContain("--diff-filter=ACMR");
    expect(workflow).toContain("bun run scripts/binaries/preview-plan.ts");
    expect(workflow).toContain("needs.plan.outputs.enabled == 'true'");
  });

  test("Scenario: Given preview jobs When the workflow is inspected Then build execution is delegated to family scripts instead of hard-coded Lynx branches", () => {
    const workflow = previewWorkflow();

    expect(workflow).toContain("bun run scripts/binaries/build-preview-job.ts");
    expect(workflow).not.toContain("cargo build --release -p opentray-ext-lynx");
    expect(workflow).not.toContain("bash scripts/release/build-lynx-runtime.sh");
  });
});
