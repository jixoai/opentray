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
      ]),
    ).toEqual(["webview"]);
  });

  test("Scenario: Given WebView and daemon atoms When executions are materialized Then cargo packages stay independent", () => {
    const targets = resolveReleaseTargetsForComponents(["daemon", "webview"]);
    const [darwinArm64] = materializeNativeBuildExecutions(["daemon", "webview"], targets);

    expect(targets).toContain("darwin-arm64");
    expect(darwinArm64.components).toEqual(["daemon", "webview"]);
    expect(darwinArm64.cargoPackages).toEqual(["opentray-bin", "opentray-ext-webview"]);
    expect(darwinArm64.buildsLynxRuntime).toBe(false);
  });

  test("Scenario: Given WebView-only executions When stage plan is derived Then unrelated Lynx package dirs stay absent", () => {
    const executions = materializeNativeBuildExecutions(["webview"], ["darwin-arm64"]);
    const plan = describeReleaseStagePlan(executions);

    expect(plan.stageEntries).toEqual([
      {
        target: "darwin-arm64",
        artifactKinds: ["webview"],
      },
    ]);
    expect(plan.validatePackageDirs).toEqual(["packages/ext-webview-darwin-arm64"]);
  });

  test("Scenario: Given Lynx runtime build and staging When artifact names are resolved Then the OpenTray host carrier name is shared", () => {
    expect(lynxRuntimeArtifactName).toBe("OpenTrayLynxRuntime.app.zip");
  });
});
