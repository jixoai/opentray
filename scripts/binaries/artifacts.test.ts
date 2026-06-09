import { describe, expect, test } from "bun:test";

import {
  nativeTargets,
  resolveNativePackageTarget,
  resolveNativeTarget,
  resolveStageDestination,
} from "./artifacts";

describe("Feature: native binary artifact topology", () => {
  test("Scenario: Given first-stage platforms When targets are enumerated Then daemon packages cover Linux while WebView stays macOS/Windows only", () => {
    expect(nativeTargets).toHaveLength(6);
    expect(nativeTargets.map((target) => target.daemonPackageName)).toEqual([
      "@opentray/darwin-arm64",
      "@opentray/darwin-x64",
      "@opentray/linux-arm64",
      "@opentray/linux-x64",
      "@opentray/windows-arm64",
      "@opentray/windows-x64",
    ]);
    expect(nativeTargets.map((target) => target.webviewPackageName).filter(Boolean)).toEqual([
      "@opentray/ext-webview-darwin-arm64",
      "@opentray/ext-webview-darwin-x64",
      "@opentray/ext-webview-windows-arm64",
      "@opentray/ext-webview-windows-x64",
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

    expect(darwin.daemonArtifact).toBe("packages/darwin-arm64/bin/opentray");
    expect(darwin.webviewArtifact).toBe(
      "packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib"
    );
    expect(darwin.lynxArtifact).toBe(
      "packages/ext-lynx-darwin-arm64/lib/libopentray_ext_lynx.dylib"
    );
    expect(darwin.lynxRuntimeArtifact).toBe(
      "packages/ext-lynx-darwin-arm64/runtime/OpenTrayLynxRuntime.app.zip"
    );
    expect(linux.webviewArtifact).toBeUndefined();
    expect(linux.lynxArtifact).toBeUndefined();
    expect(windows.daemonArtifact).toBe(
      "packages/windows-x64/bin/opentray.exe"
    );
    expect(windows.webviewArtifact).toBe(
      "packages/ext-webview-windows-x64/bin/opentray_ext_webview.dll"
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

    expect(target.daemonArtifact).toBe(
      "packages/windows-arm64/bin/opentray.exe"
    );
    expect(target.webviewArtifact).toBe(
      "packages/ext-webview-windows-arm64/bin/opentray_ext_webview.dll"
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

    expect(resolveStageDestination(target, "daemon")).toBe(
      "packages/darwin-arm64/bin/opentray"
    );
    expect(resolveStageDestination(target, "webview")).toBe(
      "packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib"
    );
    expect(resolveStageDestination(target, "lynx-runtime")).toBe(
      "packages/ext-lynx-darwin-arm64/runtime/OpenTrayLynxRuntime.app.zip"
    );
  });
});
