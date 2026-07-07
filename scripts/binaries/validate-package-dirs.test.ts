import { describe, expect, test } from "bun:test";

import {
  parsePackedTarEntries,
  resolveRequiredPackageEntries,
} from "./validate-package-dirs";

describe("Feature: native package publish validator", () => {
  test("Scenario: Given a POSIX runtime package When required entries are resolved Then the executable payload is required with executable mode", () => {
    expect(resolveRequiredPackageEntries("packages/darwin-arm64")).toEqual([
      {
        path: "bin/opentray",
        executable: true,
      },
    ]);
  });

  test("Scenario: Given a WebView native package When required entries are resolved Then only the staged dylib or DLL is required", () => {
    expect(
      resolveRequiredPackageEntries("packages/ext-webview-darwin-arm64")
    ).toEqual([
      {
        path: "lib/libopentray_ext_webview.dylib",
        executable: false,
      },
    ]);
    expect(
      resolveRequiredPackageEntries("packages/ext-webview-windows-x64")
    ).toEqual([
      {
        path: "bin/opentray_ext_webview.dll",
        executable: false,
      },
    ]);
  });

  test("Scenario: Given a badge native package When required entries are resolved Then the staged dylib and helper payload are both required on macOS", () => {
    expect(resolveRequiredPackageEntries("packages/ext-badge-darwin-arm64")).toEqual([
      {
        path: "lib/libopentray_ext_badge.dylib",
        executable: false,
      },
      {
        path: "app/OpenTrayBadgeHelper.app.zip",
        executable: false,
      },
    ]);
    expect(resolveRequiredPackageEntries("packages/ext-badge-windows-x64")).toEqual([
      {
        path: "bin/opentray_ext_badge.dll",
        executable: false,
      },
    ]);
  });

  test("Scenario: Given a Lynx native package When required entries are resolved Then both the dylib and runtime zip are required", () => {
    expect(resolveRequiredPackageEntries("packages/ext-lynx-darwin-arm64")).toEqual([
      {
        path: "lib/libopentray_ext_lynx.dylib",
        executable: false,
      },
      {
        path: "runtime/OpenTrayLynxRuntime.app.zip",
        executable: false,
      },
    ]);
  });

  test("Scenario: Given tar verbose output When entries are parsed Then package prefixes are normalized away", () => {
    expect(
      parsePackedTarEntries(
        [
          "-rwxr-xr-x  0 0      0     123 Oct 26  1985 package/bin/opentray",
          "-rw-r--r--  0 0      0      45 Oct 26  1985 package/README.md",
        ].join("\n")
      )
    ).toEqual([
      {
        mode: "-rwxr-xr-x",
        path: "bin/opentray",
      },
      {
        mode: "-rw-r--r--",
        path: "README.md",
      },
    ]);
  });
});
