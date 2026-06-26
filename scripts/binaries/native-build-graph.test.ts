import { describe, expect, test } from "bun:test";

import {
  describeReleaseStagePlan,
  inferNativeBuildComponentsFromReleasePackages,
  lynxRuntimeArtifactName,
  materializeNativeBuildExecutions,
  resolveReleaseTargetsForComponents,
} from "./native-build-graph";

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

  test("Scenario: Given WebView and runtime atoms When executions are materialized Then cargo packages stay independent", () => {
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
      "opentray-runtime-node",
      "opentray-ext-webview",
    ]);
    expect(darwinArm64.buildsLynxRuntime).toBe(false);
    expect(linuxX64?.components).toEqual(["runtime"]);
    expect(linuxX64?.cargoPackages).toEqual(["opentray-runtime-node"]);
  });

  test("Scenario: Given WebView-only executions When stage plan is derived Then unrelated Lynx package dirs stay absent", () => {
    const executions = materializeNativeBuildExecutions(
      ["webview"],
      ["darwin-arm64"]
    );
    const plan = describeReleaseStagePlan(executions);

    expect(plan.stageEntries).toEqual([
      {
        target: "darwin-arm64",
        artifactKinds: ["webview"],
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
      },
      {
        target: "windows-x64",
        artifactKinds: ["badge"],
      },
    ]);
    expect(plan.validatePackageDirs).toEqual([
      "packages/ext-badge-darwin-arm64",
      "packages/ext-badge-windows-x64",
    ]);
  });

  test("Scenario: Given Lynx runtime build and staging When artifact names are resolved Then the OpenTray host carrier name is shared", () => {
    expect(lynxRuntimeArtifactName).toBe("OpenTrayLynxRuntime.app.zip");
  });
});
