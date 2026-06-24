import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const verifyWorkflow = (): string =>
  readFileSync(
    resolve(repoRoot, ".github/workflows/verify-native-artifacts.yml"),
    "utf8"
  );

describe("Feature: native artifact verification workflow", () => {
  test("Scenario: Given feature work changes native packaging When maintainers inspect the verification workflow Then it can build Lynx host artifacts without publishing npm packages", () => {
    const workflow = verifyWorkflow();

    expect(workflow).toContain("name: Verify Native Artifacts");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("uses: maxim-lobanov/setup-xcode@v1");
    expect(workflow).toContain(
      'bash scripts/release/build-lynx-runtime.sh "native-artifacts/OpenTrayLynxRuntime.app.zip"'
    );
    expect(workflow).toContain(
      'bash scripts/release/build-badge-dock-helper.sh "native-artifacts/${{ matrix.badge_artifact }}"'
    );
    expect(workflow).toContain("opentray_ext_badge.dll");
    expect(workflow).toContain("--kind badge");
    expect(workflow).toContain("packages/ext-badge-windows-x64");
    expect(workflow).toContain("native/lynx-patches/**");
    expect(workflow).toContain("native/lynx-runtime-macos/**");
    expect(workflow).toContain("name: Stage and pack native npm packages");
    expect(workflow).toContain("packages/cli");
    expect(workflow).not.toContain("darwin-x64");
    expect(workflow).not.toContain("pnpm run release");
    expect(workflow).not.toContain("environment: npm-release");
  });
});
