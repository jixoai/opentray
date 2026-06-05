import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  findExistingLynxArtifactRoot,
  isCompleteLynxArtifactRoot,
} from "./launch-lynx-smoke";

describe("Feature: Lynx smoke artifact reuse", () => {
  let rootDir = "";

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "opentray-lynx-artifact-"));
  });

  afterEach(() => {
    if (rootDir.length > 0) {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a flat extracted artifact root When all required Lynx files exist Then the launcher reuses it", () => {
    writeArtifactFixture(rootDir);

    expect(isCompleteLynxArtifactRoot(rootDir)).toBe(true);
    expect(findExistingLynxArtifactRoot(rootDir, "native-darwin-arm64")).toBe(
      rootDir,
    );
  });

  test("Scenario: Given a nested downloaded artifact root When all required Lynx files exist Then the launcher finds the nested directory", () => {
    const nestedRoot = join(rootDir, "native-darwin-arm64");
    writeArtifactFixture(nestedRoot);

    expect(isCompleteLynxArtifactRoot(nestedRoot)).toBe(true);
    expect(findExistingLynxArtifactRoot(rootDir, "native-darwin-arm64")).toBe(
      nestedRoot,
    );
  });

  test("Scenario: Given an incomplete artifact cache When required files are missing Then the launcher forces a fresh download", () => {
    mkdirSync(rootDir, { recursive: true });
    writeFileSync(join(rootDir, "opentray"), "");
    writeFileSync(join(rootDir, "libopentray_ext_lynx.dylib"), "");

    expect(isCompleteLynxArtifactRoot(rootDir)).toBe(false);
    expect(findExistingLynxArtifactRoot(rootDir, "native-darwin-arm64")).toBe(
      undefined,
    );
  });
});

function writeArtifactFixture(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "opentray"), "");
  writeFileSync(join(root, "libopentray_ext_lynx.dylib"), "");
  writeFileSync(join(root, "OpenTrayLynxRuntime.app.zip"), "");
}
