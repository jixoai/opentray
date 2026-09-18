import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  describeReleaseStagePlan,
  inferNativeBuildComponentsFromReleasePackages,
  materializeIndependentNativeBuildExecutions,
  materializeNativeBuildExecutions,
  releaseArtifactName,
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

  test("Scenario: Given the embedded dialog facade When components are inferred Then the dialog atom is selected alone", () => {
    expect(
      inferNativeBuildComponentsFromReleasePackages(["@opentray/ext-dialog"])
    ).toEqual(["dialog"]);
  });

  test("Scenario: Given the embedded sound facade When components are inferred Then the sound atom is selected alone", () => {
    expect(
      inferNativeBuildComponentsFromReleasePackages(["@opentray/ext-sound"])
    ).toEqual(["sound"]);
  });

  test("Scenario: Given the embedded clipboard facade When components are inferred Then the clipboard atom is selected alone", () => {
    expect(
      inferNativeBuildComponentsFromReleasePackages(["@opentray/ext-clipboard"])
    ).toEqual(["clipboard"]);
  });

  test("Scenario: Given the embedded opener facade When components are inferred Then the opener atom is selected alone", () => {
    expect(
      inferNativeBuildComponentsFromReleasePackages(["@opentray/ext-opener"])
    ).toEqual(["opener"]);
  });

  test("Scenario: Given the embedded notification facade When components are inferred Then the notification atom is selected alone", () => {
    expect(
      inferNativeBuildComponentsFromReleasePackages(["@opentray/ext-notification"])
    ).toEqual(["notification"]);
  });

  test("Scenario: Given the host-atom changeset When the verify plan resolves against pending packages Then every new atom joins the native matrix", () => {
    // Regression pin for the false-green CI: the add-ext-host-atoms
    // changeset (three embedded facades) must scope the verify plan to
    // all eight components, and the embedded staging list must include
    // all five embedded facades.
    const inferred = inferNativeBuildComponentsFromReleasePackages([
      "@opentray/ext-clipboard",
      "@opentray/ext-opener",
      "@opentray/ext-notification",
      "opentray",
    ]);
    expect(inferred).toEqual([
      "runtime",
      "clipboard",
      "opener",
      "notification",
    ]);
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

  test("Scenario: Given dialog-only executions When the matrix is resolved Then exactly the four embedded targets build and one facade dir validates", () => {
    const targets = resolveReleaseTargetsForComponents(["dialog"]);
    const executions = materializeNativeBuildExecutions(["dialog"], targets);
    const plan = describeReleaseStagePlan(executions);

    expect(targets).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "windows-arm64",
      "windows-x64",
    ]);
    expect(
      executions.map((execution) => execution.artifactName)
    ).toEqual([
      "native-darwin-arm64-dialog",
      "native-darwin-x64-dialog",
      "native-windows-arm64-dialog",
      "native-windows-x64-dialog",
    ]);
    expect(
      executions.every((execution) =>
        execution.cargoPackages.includes("opentray-ext-dialog") &&
        execution.cargoPackages.includes("opentray-extension-inspector")
      )
    ).toBe(true);
    // Embedded facade: all four targets validate the single package dir.
    expect(plan.validatePackageDirs).toEqual(["packages/ext-dialog"]);
  });

  test("Scenario: Given a dialog grouped execution When artifact names are resolved Then the frozen library names match the cdylib outputs", () => {
    expect(releaseArtifactName("dialog", "darwin")).toBe(
      "libopentray_ext_dialog.dylib"
    );
    expect(releaseArtifactName("dialog", "windows")).toBe(
      "opentray_ext_dialog.dll"
    );
    expect(() => releaseArtifactName("dialog", "linux")).toThrow(
      "dialog native artifacts are not published for linux targets"
    );

    const [execution] = materializeNativeBuildExecutions(
      ["webview", "dialog"],
      ["darwin-arm64"]
    );
    expect(execution.components).toEqual(["webview", "dialog"]);
    expect(execution.artifactKinds).toEqual(["webview", "dialog"]);
    expect(execution.cargoPackages).toEqual([
      "opentray-ext-webview",
      "opentray-extension-inspector",
      "opentray-ext-dialog",
    ]);
  });

  test("Scenario: Given a sound-only execution matrix When it is resolved Then exactly the four embedded targets build and stage into the ext-sound facade", () => {
    const targets = resolveReleaseTargetsForComponents(["sound"]);
    const executions = materializeNativeBuildExecutions(["sound"], targets);
    const plan = describeReleaseStagePlan(executions);

    expect(targets).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "windows-arm64",
      "windows-x64",
    ]);
    expect(
      executions.map((execution) => execution.artifactName)
    ).toEqual([
      "native-darwin-arm64-sound",
      "native-darwin-x64-sound",
      "native-windows-arm64-sound",
      "native-windows-x64-sound",
    ]);
    expect(
      executions.every((execution) =>
        execution.cargoPackages.includes("opentray-ext-sound") &&
        execution.cargoPackages.includes("opentray-extension-inspector")
      )
    ).toBe(true);
    expect(
      executions.every((execution) => execution.artifactKinds.length === 1)
    ).toBe(true);
    // Embedded facade: all four targets validate the single package dir.
    expect(plan.validatePackageDirs).toEqual(["packages/ext-sound"]);
    // The generic embedded pack-evidence input derives from the staged kinds.
    expect(plan.embeddedPackageDirs).toEqual(["packages/ext-sound"]);
  });

  test("Scenario: Given a sound grouped execution When artifact names are resolved Then the frozen library names mirror the dialog cdylib outputs", () => {
    expect(releaseArtifactName("sound", "darwin")).toBe(
      "libopentray_ext_sound.dylib"
    );
    expect(releaseArtifactName("sound", "windows")).toBe(
      "opentray_ext_sound.dll"
    );
    expect(() => releaseArtifactName("sound", "linux")).toThrow(
      "sound native artifacts are not published for linux targets"
    );

    const [execution] = materializeNativeBuildExecutions(
      ["dialog", "sound"],
      ["darwin-arm64"]
    );
    expect(execution.components).toEqual(["dialog", "sound"]);
    expect(execution.artifactKinds).toEqual(["dialog", "sound"]);
    expect(execution.cargoPackages).toEqual([
      "opentray-ext-dialog",
      "opentray-extension-inspector",
      "opentray-ext-sound",
    ]);
    const plan = describeReleaseStagePlan([execution]);
    expect(plan.embeddedPackageDirs.sort()).toEqual([
      "packages/ext-dialog",
      "packages/ext-sound",
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

  test("Scenario: Given a Darwin runtime build When the graph is inspected Then the package receives only the shared app bundle template", () => {
    const executions = materializeNativeBuildExecutions(
      ["runtime"],
      ["darwin-arm64", "linux-x64"]
    );
    const darwinGraph = readFileSync(
      resolve(repoRoot, "scripts/binaries/native-build-graph.ts"),
      "utf8"
    );
    const darwinPackage = readFileSync(
      resolve(repoRoot, "packages/darwin-arm64/package.json"),
      "utf8"
    );

    expect(executions[0]?.artifactKinds).toEqual(["runtime"]);
    expect(executions[1]?.artifactKinds).toEqual(["runtime"]);
    expect(darwinGraph).toContain("packages/darwin-app-carrier/Info.plist");
    expect(darwinGraph).not.toContain("build-darwin-runtime-carrier.sh");
    expect(darwinPackage).toContain('"app/Info.plist"');
    expect(darwinPackage).not.toContain('"app/OpenTray.app.zip"');
  });
});
