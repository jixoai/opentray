import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  describeReleaseStagePlan,
  inferNativeBuildComponentsFromReleasePackages,
  materializeIndependentNativeBuildExecutions,
  materializeNativeBuildExecutions,
  resolveReleaseTargetsForComponents,
} from "./native-build-graph";

const repoRoot = resolve(import.meta.dir, "../..");

describe("Feature: shared native build graph", () => {
  test("Scenario: Given WebView release packages When components are inferred Then only the WebView atom is selected", () => {
    expect(
      inferNativeBuildComponentsFromReleasePackages([
        "@opentray/ext-webview",
        "@opentray/ext-webview-darwin-arm64",
      ])
    ).toEqual(["webview"]);
  });

  test("Scenario: Given badge release packages When components are inferred Then the badge atom is selected", () => {
    expect(
      inferNativeBuildComponentsFromReleasePackages([
        "@opentray/ext-badge",
        "@opentray/ext-badge-windows-x64",
      ])
    ).toEqual(["badge"]);
  });

  test("Scenario: Given WebView and runtime atoms When a grouped execution is materialized Then preview families can still build one smoke closure", () => {
    const targets = resolveReleaseTargetsForComponents(["runtime", "webview"]);
    const [darwinArm64] = materializeNativeBuildExecutions(
      ["runtime", "webview"],
      targets
    );
    const linuxX64 = materializeNativeBuildExecutions(
      ["runtime", "webview"],
      targets
    ).find((execution) => execution.target === "linux-x64");

    expect(targets).toContain("darwin-arm64");
   expect(targets).toContain("linux-x64");
    expect(darwinArm64.components).toEqual(["runtime", "webview"]);
    expect(darwinArm64.cargoPackages).toEqual([
      "opentray-bin",
      "opentray-ext-webview",
      "opentray-extension-inspector",
    ]);
    expect(darwinArm64.artifactName).toBe(
      "native-darwin-arm64-runtime-webview"
    );
    expect(linuxX64?.components).toEqual(["runtime"]);
    expect(linuxX64?.cargoPackages).toEqual(["opentray-bin"]);
  });

  test("Scenario: Given multiple release atoms When independent executions are materialized Then extension builds are sharded per atom", () => {
    const targets = resolveReleaseTargetsForComponents([
      "runtime",
      "webview",
      "badge",
    ]);
    const executions = materializeIndependentNativeBuildExecutions(
      ["runtime", "webview", "badge"],
      targets
    );

    expect(executions.every((execution) => execution.components.length === 1))
      .toBe(true);
    expect(
      executions.find(
        (execution) =>
          execution.target === "darwin-arm64" &&
          execution.components.includes("webview")
      )?.artifactName
    ).toBe("native-darwin-arm64-webview");
    expect(
      executions
        .filter((execution) =>
          execution.components.some((component) =>
            component === "webview" || component === "badge"
          )
        )
        .every((execution) =>
          execution.cargoPackages.includes("opentray-extension-inspector")
        )
    ).toBe(true);
  });

  test("Scenario: Given WebView-only executions When stage plan is derived Then only WebView package dirs are present", () => {
    const executions = materializeNativeBuildExecutions(
      ["webview"],
      ["darwin-arm64"]
    );
    const plan = describeReleaseStagePlan(executions);

    expect(plan.stageEntries).toEqual([
      {
        target: "darwin-arm64",
        artifactKinds: ["webview"],
        artifactName: "native-darwin-arm64-webview",
      },
    ]);
    expect(plan.validatePackageDirs).toEqual([
      "packages/ext-webview-darwin-arm64",
    ]);
  });

  test("Scenario: Given badge-only executions When stage plan is derived Then platform package dirs are selected", () => {
    const executions = materializeNativeBuildExecutions(
      ["badge"],
      ["darwin-arm64", "windows-x64"]
    );
    const plan = describeReleaseStagePlan(executions);

    expect(plan.stageEntries).toEqual([
      {
        target: "darwin-arm64",
        artifactKinds: ["badge"],
        artifactName: "native-darwin-arm64-badge",
      },
      {
        target: "windows-x64",
        artifactKinds: ["badge"],
        artifactName: "native-windows-x64-badge",
      },
    ]);
    expect(plan.validatePackageDirs).toEqual([
      "packages/ext-badge-darwin-arm64",
      "packages/ext-badge-windows-x64",
    ]);
  });

  test("Scenario: Given badge Darwin helper builds When script is inspected Then it delegates to the shared Darwin carrier", () => {
    const executions = materializeNativeBuildExecutions(
      ["badge"],
      ["darwin-arm64"]
    );
    const [execution] = executions;
    const script = readFileSync(
      resolve(repoRoot, "scripts/release/build-badge-dock-helper.sh"),
      "utf8"
    );

    expect(execution.artifactKinds).toEqual(["badge"]);
    expect(execution.artifactName).toBe("native-darwin-arm64-badge");
    expect(script).toContain("scripts/release/build-darwin-app-carrier.sh");
    expect(script).toContain("OpenTrayBadgeHelper");
  });

  test("Scenario: Given Darwin privacy families When carrier script is inspected Then plist usage strings are carrier-owned", () => {
    const script = readFileSync(
      resolve(repoRoot, "scripts/release/build-darwin-app-carrier.sh"),
      "utf8"
    );

    expect(script).toContain("OPENTRAY_DARWIN_PRIVACY_FAMILIES");
    expect(script).toContain("NSCameraUsageDescription");
    expect(script).toContain("NSMicrophoneUsageDescription");
  });

  test("Scenario: Given a Darwin runtime build When the graph is inspected Then the shared app carrier is emitted with the broker artifact", () => {
    const executions = materializeNativeBuildExecutions(
      ["runtime"],
      ["darwin-arm64", "linux-x64"]
    );
    const darwinCarrierScript = readFileSync(
      resolve(repoRoot, "scripts/release/build-darwin-runtime-carrier.sh"),
      "utf8"
    );
    const darwinPackage = readFileSync(
      resolve(repoRoot, "packages/darwin-arm64/package.json"),
      "utf8"
    );

    expect(executions[0]?.artifactKinds).toEqual(["runtime"]);
    expect(executions[1]?.artifactKinds).toEqual(["runtime"]);
    expect(darwinCarrierScript).toContain("packages/darwin-app-carrier");
    expect(darwinCarrierScript).toContain("camera,microphone");
    expect(darwinPackage).toContain('"app/OpenTray.app.zip"');
  });
});
