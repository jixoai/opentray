import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  badgeDockHelperArtifactName,
  darwinRuntimeCarrierArtifactName,
  nativeTargets,
  resolveNativePackageTarget,
  resolveNativeTarget,
  resolveStageDestination,
  resolveStageDestinationForArtifactFile,
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
  });

  test("Scenario: Given platform packages When artifact paths are generated Then generated binaries land in package-owned directories", () => {
    const darwin = resolveNativeTarget("darwin", "arm64");
    const linux = resolveNativeTarget("linux", "x64");
    const windows = resolveNativeTarget("win32", "x64");

    expect(darwin.runtimeArtifact).toBe(
      "packages/darwin-arm64/bin/opentray"
    );
    expect(darwin.runtimeCarrierArtifact).toBe(
      "packages/darwin-arm64/app/Info.plist"
    );
    expect(darwin.webviewArtifact).toBe(
      "packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib"
    );
    expect(darwin.badgeArtifact).toBe(
      "packages/ext-badge-darwin-arm64/lib/libopentray_ext_badge.dylib"
    );
    expect(darwin.badgeHelperArtifact).toBe(
      "packages/ext-badge-darwin-arm64/app/OpenTrayBadgeHelper.app.zip"
    );
    expect(linux.webviewArtifact).toBeUndefined();
    expect(linux.runtimeCarrierArtifact).toBeUndefined();
    expect(windows.runtimeArtifact).toBe(
      "packages/windows-x64/bin/opentray.exe"
    );
    expect(windows.runtimeCarrierArtifact).toBeUndefined();
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
      "packages/windows-arm64/bin/opentray.exe"
    );
    expect(target.webviewArtifact).toBe(
      "packages/ext-webview-windows-arm64/bin/opentray_ext_webview.dll"
    );
    expect(target.badgeArtifact).toBe(
      "packages/ext-badge-windows-arm64/bin/opentray_ext_badge.dll"
    );
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
      "packages/darwin-arm64/bin/opentray"
    );
    expect(
      resolveStageDestinationForArtifactFile(
        target,
        darwinRuntimeCarrierArtifactName
      )
    ).toBe(
      `packages/darwin-arm64/app/${darwinRuntimeCarrierArtifactName}`
    );
    expect(resolveStageDestination(target, "webview")).toBe(
      "packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib"
    );
    expect(resolveStageDestination(target, "badge")).toBe(
      "packages/ext-badge-darwin-arm64/lib/libopentray_ext_badge.dylib"
    );
    expect(
      resolveStageDestinationForArtifactFile(target, badgeDockHelperArtifactName)
    ).toBe(
      `packages/ext-badge-darwin-arm64/app/${badgeDockHelperArtifactName}`
    );
  });

  test("Scenario: Given an embedded host-atom library file When the stage destination is resolved by file name Then every embedded facade owns its platforms path", () => {
    // Regression pin for the false-green stage failure: the embedded
    // by-file-name resolver only knew dialog and sound, so the CI stage job
    // rejected libopentray_ext_clipboard.dylib even though the native job
    // built and uploaded it.
    const darwin = resolveNativePackageTarget("darwin", "arm64");
    expect(
      resolveStageDestinationForArtifactFile(
        darwin,
        "libopentray_ext_clipboard.dylib"
      )
    ).toBe(
      "packages/ext-clipboard/platforms/darwin-arm64/libopentray_ext_clipboard.dylib"
    );
    expect(
      resolveStageDestinationForArtifactFile(
        darwin,
        "libopentray_ext_opener.dylib"
      )
    ).toBe(
      "packages/ext-opener/platforms/darwin-arm64/libopentray_ext_opener.dylib"
    );
    expect(
      resolveStageDestinationForArtifactFile(
        darwin,
        "libopentray_ext_notification.dylib"
      )
    ).toBe(
      "packages/ext-notification/platforms/darwin-arm64/libopentray_ext_notification.dylib"
    );
    const windows = resolveNativePackageTarget("windows", "x64");
    expect(
      resolveStageDestinationForArtifactFile(
        windows,
        "opentray_ext_notification.dll"
      )
    ).toBe(
      "packages/ext-notification/platforms/win32-x64/opentray_ext_notification.dll"
    );
  });

  test("Scenario: Given badge release artifacts When the release name is resolved Then the macOS dylib and helper zip stay stable", () => {
    const target = resolveNativePackageTarget("darwin", "x64");

    expect(target.badgeArtifact).toBe(
      "packages/ext-badge-darwin-x64/lib/libopentray_ext_badge.dylib"
    );
    expect(target.badgeHelperArtifact).toBe(
      `packages/ext-badge-darwin-x64/app/${badgeDockHelperArtifactName}`
    );
  });

  test("Scenario: Given a Windows badge target When the destination is resolved Then the native DLL stays package-owned", () => {
    const target = resolveNativePackageTarget("windows", "x64");

    expect(resolveStageDestination(target, "badge")).toBe(
      "packages/ext-badge-windows-x64/bin/opentray_ext_badge.dll"
    );
  });

  test("Scenario: Given embedded dialog staging When the destination is resolved per (target, kind) Then the frozen npm-target layout owns the path", () => {
    const darwinArm64 = resolveNativePackageTarget("darwin", "arm64");
    const darwinX64 = resolveNativePackageTarget("darwin", "x64");
    const winArm64 = resolveNativePackageTarget("windows", "arm64");
    const winX64 = resolveNativePackageTarget("windows", "x64");
    const linux = resolveNativePackageTarget("linux", "x64");

    expect(resolveStageDestination(darwinArm64, "dialog")).toBe(
      "packages/ext-dialog/platforms/darwin-arm64/libopentray_ext_dialog.dylib"
    );
    expect(resolveStageDestination(darwinX64, "dialog")).toBe(
      "packages/ext-dialog/platforms/darwin-x64/libopentray_ext_dialog.dylib"
    );
    // npm target naming: win32, not windows (frozen consumer matrix).
    expect(resolveStageDestination(winArm64, "dialog")).toBe(
      "packages/ext-dialog/platforms/win32-arm64/opentray_ext_dialog.dll"
    );
    expect(resolveStageDestination(winX64, "dialog")).toBe(
      "packages/ext-dialog/platforms/win32-x64/opentray_ext_dialog.dll"
    );
    // Both darwin dylibs share a basename; resolution is by (target, kind),
    // never by basename alone.
    expect(
      resolveStageDestinationForArtifactFile(
        darwinArm64,
        "libopentray_ext_dialog.dylib"
      )
    ).toBe(
      "packages/ext-dialog/platforms/darwin-arm64/libopentray_ext_dialog.dylib"
    );
    expect(
      resolveStageDestinationForArtifactFile(
        darwinX64,
        "libopentray_ext_dialog.dylib"
      )
    ).toBe(
      "packages/ext-dialog/platforms/darwin-x64/libopentray_ext_dialog.dylib"
    );
    expect(() => resolveStageDestination(linux, "dialog")).toThrow(
      "target linux-x64 does not publish a dialog native artifact"
    );
  });

  test("Scenario: Given embedded sound staging When the destination is resolved per (target, kind) Then it mirrors the frozen dialog layout", () => {
    const darwinArm64 = resolveNativePackageTarget("darwin", "arm64");
    const darwinX64 = resolveNativePackageTarget("darwin", "x64");
    const winArm64 = resolveNativePackageTarget("windows", "arm64");
    const winX64 = resolveNativePackageTarget("windows", "x64");
    const linux = resolveNativePackageTarget("linux", "x64");

    expect(resolveStageDestination(darwinArm64, "sound")).toBe(
      "packages/ext-sound/platforms/darwin-arm64/libopentray_ext_sound.dylib"
    );
    expect(resolveStageDestination(darwinX64, "sound")).toBe(
      "packages/ext-sound/platforms/darwin-x64/libopentray_ext_sound.dylib"
    );
    expect(resolveStageDestination(winArm64, "sound")).toBe(
      "packages/ext-sound/platforms/win32-arm64/opentray_ext_sound.dll"
    );
    expect(resolveStageDestination(winX64, "sound")).toBe(
      "packages/ext-sound/platforms/win32-x64/opentray_ext_sound.dll"
    );
    // The shared darwin basename routes by (target, kind) exactly like dialog.
    expect(
      resolveStageDestinationForArtifactFile(
        darwinArm64,
        "libopentray_ext_sound.dylib"
      )
    ).toBe(
      "packages/ext-sound/platforms/darwin-arm64/libopentray_ext_sound.dylib"
    );
    expect(
      resolveStageDestinationForArtifactFile(
        darwinX64,
        "libopentray_ext_sound.dylib"
      )
    ).toBe(
      "packages/ext-sound/platforms/darwin-x64/libopentray_ext_sound.dylib"
    );
    expect(() => resolveStageDestination(linux, "sound")).toThrow(
      "target linux-x64 does not publish a sound native artifact"
    );
  });

  test("Scenario: Given runtime builds When manifest dependencies are inspected Then the executable host stays in the broker crate", () => {
    const manifest = readFileSync(
      resolve(repoRoot, "crates/opentray-bin/Cargo.toml"),
      "utf8"
    );
    expect(manifest).toContain('name = "opentray-bin"');
    expect(manifest).toContain("opentray-core.workspace = true");
  });
});
