// Orthogonal intents (2026-09-17; original user request: pack-size gate must be
// measured, reproducible, and tested — no assumed "far below 2MB"):
// 1. Classification truth at the frozen boundaries (ok / warn >= 2MiB / fail > 3MiB).
// 2. A REAL npm pack arm against a temp fixture package (stat from the actual .tgz).
// 3. Deterministic warn/fail arms through an injected pack whose tarball is a
//    real temp file of controlled byte length (no compression guessing).

import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  PACK_SIZE_FAIL_BYTES,
  PACK_SIZE_WARN_BYTES,
  evaluateSize,
  formatReceiptLine,
  runCheck,
} from "./check-pack-size.mjs";

const MiB = 1024 * 1024;

const tempDirs: string[] = [];

const cleanup = async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
};

const buildFixturePackage = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ot-pack-fixture-"));
  tempDirs.push(root);
  await mkdir(join(root, "platforms", "darwin-arm64"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "@opentray/ext-fixture", version: "0.0.1", files: ["platforms"] })
  );
  await writeFile(
    join(root, "platforms", "darwin-arm64", "libopentray_ext_fixture.dylib"),
    Buffer.from("fixture-native-bytes", "utf8")
  );
  await writeFile(
    join(root, "platforms", "manifest.json"),
    JSON.stringify({
      facadeVersion: "0.0.1",
      contractFingerprint: "fixture-contract-1",
      targets: {
        "darwin-arm64": {
          path: "platforms/darwin-arm64/libopentray_ext_fixture.dylib",
          sha256: "a".repeat(64),
          buildIdentity: "sha256:fixture-build",
        },
      },
    })
  );
  return root;
};

/** Deterministic injected pack: a real temp file of exact byte length stands in for the tgz. */
const fakePackOfExactBytes = (bytes: number) => {
  return async (packageDir: string) => {
    const dir = await mkdtemp(join(tmpdir(), "ot-pack-fake-"));
    tempDirs.push(dir);
    const tarballPath = join(dir, "opentray-ext-fixture-0.0.1.tgz");
    await writeFile(tarballPath, Buffer.alloc(bytes));
    return {
      entry: {
        name: "@opentray/ext-fixture",
        filename: "opentray-ext-fixture-0.0.1.tgz",
        files: [{ path: "platforms/darwin-arm64/libopentray_ext_fixture.dylib", size: 21 }],
      },
      tarballPath,
      bytes: (await stat(tarballPath)).size,
      mode: "real",
    };
  };
};

describe("check-pack-size", () => {
  test("classification truth at the frozen boundaries", () => {
    expect(PACK_SIZE_WARN_BYTES).toBe(2 * MiB);
    expect(PACK_SIZE_FAIL_BYTES).toBe(3 * MiB);
    expect(evaluateSize(PACK_SIZE_WARN_BYTES - 1)).toBe("ok");
    expect(evaluateSize(PACK_SIZE_WARN_BYTES)).toBe("warn");
    expect(evaluateSize(PACK_SIZE_FAIL_BYTES)).toBe("warn");
    expect(evaluateSize(PACK_SIZE_FAIL_BYTES + 1)).toBe("fail");
    expect(evaluateSize(0)).toBe("ok");
  });

  test("real npm pack arm measures a fixture package from the actual tgz stat", async () => {
    try {
      const fixtureRoot = await buildFixturePackage();
      const { receipts, exitCode } = await runCheck({ packageDirs: [fixtureRoot] });

      expect(exitCode).toBe(0);
      expect(receipts).toHaveLength(1);
      const receipt = receipts[0];
      expect(receipt.verdict).toBe("ok");
      expect(receipt.packageName).toBe("@opentray/ext-fixture");
      expect(receipt.bytes).toBeGreaterThan(0);
      expect(receipt.tarballPath).toContain(".tgz");
      expect(typeof receipt.npmVersion).toBe("string");
      // The per-target receipt lists every packed platforms/ file, including
      // the staging manifest itself (it ships with the tarball).
      expect(receipt.platformFiles).toEqual([
        "platforms/darwin-arm64/libopentray_ext_fixture.dylib (20B unpacked)",
        "platforms/manifest.json (274B unpacked)",
      ]);
      const line = formatReceiptLine(receipt);
      expect(line).toContain("pack-size OK @opentray/ext-fixture");
      expect(line).toContain(`bytes=${receipt.bytes}`);
      expect(line).toContain(`npm=${receipt.npmVersion}`);
    } finally {
      await cleanup();
    }
  }, 30_000);

  test(">= 2MiB warns with the Owner split-decision notice and still exits 0", async () => {
    try {
      const fixtureRoot = await buildFixturePackage();
      const { receipts, exitCode } = await runCheck({
        packageDirs: [fixtureRoot],
        pack: fakePackOfExactBytes(Math.floor(2.2 * MiB)),
      });

      expect(exitCode).toBe(0);
      expect(receipts[0].verdict).toBe("warn");
      const line = formatReceiptLine(receipts[0]);
      expect(line).toContain("pack-size WARN");
      expect(line).toContain("Owner split-decision record");
      expect(line).toContain("Owner ruling 2026-09-16");
    } finally {
      await cleanup();
    }
  });

  test("> 3MiB fails the gate with exit code 1 and the split directive", async () => {
    try {
      const fixtureRoot = await buildFixturePackage();
      const { receipts, exitCode } = await runCheck({
        packageDirs: [fixtureRoot],
        pack: fakePackOfExactBytes(Math.floor(3.2 * MiB)),
      });

      expect(exitCode).toBe(1);
      expect(receipts[0].verdict).toBe("fail");
      const line = formatReceiptLine(receipts[0]);
      expect(line).toContain("pack-size FAIL");
      expect(line).toContain("must split into @opentray/<name>-<os>-<arch> platform packages");
    } finally {
      await cleanup();
    }
  });
});
