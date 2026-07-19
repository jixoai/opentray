import { describe, expect, test } from "bun:test";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  parsePackedTarArchive,
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
    expect(resolveRequiredPackageEntries("packages/ext-webview-darwin-arm64")).toEqual([
      {
        path: "lib/libopentray_ext_webview.dylib",
        executable: false,
      },
    ]);
    expect(resolveRequiredPackageEntries("packages/ext-webview-windows-x64")).toEqual([
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

  test("Scenario: Given tar verbose output When entries are parsed Then package prefixes are normalized away", () => {
    expect(
      parsePackedTarEntries(
        [
          "-rwxr-xr-x  0 0      0     123 Oct 26  1985 package/bin/opentray",
          "-rw-r--r--  0 0      0      45 Oct 26  1985 package/README.md",
        ].join("\n"),
      ),
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

  test("Scenario: Given a gzip tar archive When entries are parsed Then native modes are preserved without a shell tar command", () => {
    const archive = createTarArchive([
      { path: "package/bin/opentray", mode: 0o755, size: 12 },
      { path: "package/README.md", mode: 0o644, size: 0 },
    ]);

    expect(parsePackedTarArchive(gunzipSync(gzipSync(archive)))).toEqual([
      { mode: "-rwxr-xr-x", path: "bin/opentray" },
      { mode: "-rw-r--r--", path: "README.md" },
    ]);
  });
});

function createTarArchive(
  entries: readonly { path: string; mode: number; size: number }[],
): Uint8Array {
  const archive = new Uint8Array(10240);
  let offset = 0;
  for (const entry of entries) {
    const header = archive.subarray(offset, offset + 512);
    writeTarField(header, 0, 100, entry.path);
    writeTarField(header, 100, 8, entry.mode.toString(8));
    writeTarField(header, 124, 12, entry.size.toString(8));
    offset += 512 + Math.ceil(entry.size / 512) * 512;
  }
  return archive;
}

function writeTarField(header: Uint8Array, offset: number, length: number, value: string): void {
  const encoded = new TextEncoder().encode(value);
  header.set(encoded.subarray(0, length), offset);
}
