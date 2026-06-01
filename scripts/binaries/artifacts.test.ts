import { describe, expect, test } from "bun:test";

import { nativeTargets, resolveNativeTarget } from "./artifacts";

describe("Feature: native binary artifact topology", () => {
  test("Scenario: Given first-stage platforms When targets are enumerated Then daemon and webview packages map one-to-one", () => {
    expect(nativeTargets).toHaveLength(6);
    expect(nativeTargets.map((target) => target.daemonPackageName)).toEqual([
      "@opentray/darwin-arm64",
      "@opentray/darwin-x64",
      "@opentray/linux-arm64",
      "@opentray/linux-x64",
      "@opentray/windows-arm64",
      "@opentray/windows-x64",
    ]);
    expect(nativeTargets.map((target) => target.webviewPackageName)).toEqual([
      "@opentray/ext-webview-darwin-arm64",
      "@opentray/ext-webview-darwin-x64",
      "@opentray/ext-webview-linux-arm64",
      "@opentray/ext-webview-linux-x64",
      "@opentray/ext-webview-windows-arm64",
      "@opentray/ext-webview-windows-x64",
    ]);
  });

  test("Scenario: Given platform packages When artifact paths are generated Then generated binaries land in package-owned directories", () => {
    const darwin = resolveNativeTarget("darwin", "arm64");
    const linux = resolveNativeTarget("linux", "x64");
    const windows = resolveNativeTarget("win32", "x64");

    expect(darwin.daemonArtifact).toBe("packages/darwin-arm64/bin/opentray");
    expect(darwin.webviewArtifact).toBe(
      "packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib",
    );
    expect(linux.webviewArtifact).toBe("packages/ext-webview-linux-x64/lib/libopentray_ext_webview.so");
    expect(windows.daemonArtifact).toBe("packages/windows-x64/bin/opentray.exe");
    expect(windows.webviewArtifact).toBe("packages/ext-webview-windows-x64/bin/opentray_ext_webview.dll");
  });

  test("Scenario: Given unsupported host When target is resolved Then the error is explicit", () => {
    expect(() => resolveNativeTarget("freebsd", "x64")).toThrow("unsupported OpenTray platform");
    expect(() => resolveNativeTarget("linux", "riscv64")).toThrow("unsupported OpenTray architecture");
  });
});
