import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  badgeDockHelperArtifactName,
  nativeTargets,
  resolveNativePackageTarget,
  resolveNativeTarget,
  resolveStageDestination,
} from "./artifacts";

const repoRoot = resolve(import.meta.dir, "../..");

describe("Feature: native runtime artifact topology", () => {
  test("Scenario: Given first-stage platforms When targets are enumerated Then runtime packages cover Linux while WebView stays macOS/Windows only", () => {
    expect(nativeTargets).toHaveLength(6);
    expect(nativeTargets.map((target) => target.runtimePackageName)).toEqual([
      "@opentray/darwin-arm64",
      "@opentray/darwin-x64",
      "@opentray/linux-arm64",
      "@opentray/linux-x64",
      "@opentray/windows-arm64",
      "@opentray/windows-x64",
    ]);
    expect(
      nativeTargets.map((target) => target.webviewPackageName).filter(Boolean)
    ).toEqual([
      "@opentray/ext-webview-darwin-arm64",
      "@opentray/ext-webview-darwin-x64",
      "@opentray/ext-webview-windows-arm64",
      "@opentray/ext-webview-windows-x64",
    ]);
    expect(
      nativeTargets.map((target) => target.badgePackageName).filter(Boolean)
    ).toEqual([
      "@opentray/ext-badge-darwin-arm64",
      "@opentray/ext-badge-darwin-x64",
      "@opentray/ext-badge-windows-arm64",
      "@opentray/ext-badge-windows-x64",
    ]);
    expect(
      nativeTargets.map((target) => target.lynxPackageName).filter(Boolean)
    ).toEqual([
      "@opentray/ext-lynx-darwin-arm64",
      "@opentray/ext-lynx-darwin-x64",
    ]);
  });

  test("Scenario: Given platform packages When artifact paths are generated Then generated binaries land in package-owned directories", () => {
    const darwin = resolveNativeTarget("darwin", "arm64");
    const linux = resolveNativeTarget("linux", "x64");
    const windows = resolveNativeTarget("win32", "x64");

    expect(darwin.runtimeArtifact).toBe(
      "packages/darwin-arm64/runtime/opentray_runtime.node"
    );
    expect(darwin.webviewArtifact).toBe(
      "packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib"
    );
    expect(darwin.badgeArtifact).toBe(
      "packages/ext-badge-darwin-arm64/app/OpenTrayBadgeHelper.app.zip"
    );
    expect(darwin.lynxArtifact).toBe(
      "packages/ext-lynx-darwin-arm64/lib/libopentray_ext_lynx.dylib"
    );
    expect(darwin.lynxRuntimeArtifact).toBe(
      "packages/ext-lynx-darwin-arm64/runtime/OpenTrayLynxRuntime.app.zip"
    );
    expect(linux.webviewArtifact).toBeUndefined();
    expect(linux.lynxArtifact).toBeUndefined();
    expect(windows.runtimeArtifact).toBe(
      "packages/windows-x64/runtime/opentray_runtime.node"
    );
    expect(windows.webviewArtifact).toBe(
      "packages/ext-webview-windows-x64/bin/opentray_ext_webview.dll"
    );
    expect(windows.badgeArtifact).toBe(
      "packages/ext-badge-windows-x64/bin/opentray_ext_badge.dll"
    );
  });

  test("Scenario: Given unsupported host When target is resolved Then the error is explicit", () => {
    expect(() => resolveNativeTarget("freebsd", "x64")).toThrow(
      "unsupported OpenTray platform"
    );
    expect(() => resolveNativeTarget("linux", "riscv64")).toThrow(
      "unsupported OpenTray architecture"
    );
  });

  test("Scenario: Given CI stages foreign artifacts When package target is explicit Then host platform is irrelevant", () => {
    const target = resolveNativePackageTarget("windows", "arm64");

    expect(target.runtimeArtifact).toBe(
      "packages/windows-arm64/runtime/opentray_runtime.node"
    );
    expect(target.webviewArtifact).toBe(
      "packages/ext-webview-windows-arm64/bin/opentray_ext_webview.dll"
    );
    expect(target.badgeArtifact).toBe(
      "packages/ext-badge-windows-arm64/bin/opentray_ext_badge.dll"
    );
    expect(target.lynxArtifact).toBeUndefined();
  });

  test("Scenario: Given a Linux target When WebView staging is requested Then the unsupported package boundary is explicit", () => {
    const target = resolveNativePackageTarget("linux", "x64");

    expect(() => resolveStageDestination(target, "webview")).toThrow(
      "target linux-x64 does not publish a webview native extension"
    );
  });

  test("Scenario: Given a staged artifact kind When the destination is resolved Then the package-owned path stays authoritative", () => {
    const target = resolveNativePackageTarget("darwin", "arm64");

    expect(resolveStageDestination(target, "runtime")).toBe(
      "packages/darwin-arm64/runtime/opentray_runtime.node"
    );
    expect(resolveStageDestination(target, "webview")).toBe(
      "packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib"
    );
    expect(resolveStageDestination(target, "badge")).toBe(
      `packages/ext-badge-darwin-arm64/app/${badgeDockHelperArtifactName}`
    );
    expect(resolveStageDestination(target, "lynx-runtime")).toBe(
      "packages/ext-lynx-darwin-arm64/runtime/OpenTrayLynxRuntime.app.zip"
    );
  });

  test("Scenario: Given badge release artifacts When the release name is resolved Then the macOS helper zip stays stable", () => {
    const target = resolveNativePackageTarget("darwin", "x64");

    expect(target.badgeArtifact).toBe(
      `packages/ext-badge-darwin-x64/app/${badgeDockHelperArtifactName}`
    );
  });

  test("Scenario: Given a Windows badge target When the destination is resolved Then the native DLL stays package-owned", () => {
    const target = resolveNativePackageTarget("windows", "x64");

    expect(resolveStageDestination(target, "badge")).toBe(
      "packages/ext-badge-windows-x64/bin/opentray_ext_badge.dll"
    );
  });

  test("Scenario: Given Linux runtime builds When manifest dependencies are inspected Then GUI tray crates stay macOS and Windows only", () => {
    const manifest = readFileSync(
      resolve(repoRoot, "crates/opentray-runtime-node/Cargo.toml"),
      "utf8"
    );
    const rootDependencies = dependencySection(manifest, "[dependencies]");
    const desktopDependencies = dependencySection(
      manifest,
      "[target.'cfg(any(target_os = \"macos\", target_os = \"windows\"))'.dependencies]"
    );

    expect(rootDependencies).toContain("opentray-core.workspace = true");
    expect(rootDependencies).not.toContain("opentray-backend-tray-icon");
    expect(rootDependencies).not.toContain("tray-icon");
    expect(rootDependencies).not.toContain("winit");
    expect(desktopDependencies).toContain(
      "opentray-backend-tray-icon.workspace = true"
    );
    expect(desktopDependencies).toContain("tray-icon.workspace = true");
    expect(desktopDependencies).toContain('winit = "0.30"');
  });
});

function dependencySection(manifest: string, header: string): string {
  const start = manifest.indexOf(header);
  if (start === -1) {
    throw new Error(`missing manifest section: ${header}`);
  }
  const section = manifest.slice(start + header.length);
  const end = section.indexOf("\n[");
  return section.slice(0, end === -1 ? section.length : end);
}
