import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  EXTENSION_ABI_VERSION,
  sha256File,
  verifyExtensionArtifactIdentity,
  verifyExtensionPlatformPackageTarget,
  verifyRecordedExtensionArtifact,
  type EmbeddedExtensionManifest,
  type ExpectedExtensionArtifactIdentity,
} from "./extension-manifest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const expected = {
  extensionName: "webview",
  artifactSetVersion: "2.0.0",
  contractFingerprint: "webview-contract-2",
  target: { os: "darwin", arch: "arm64" },
} satisfies ExpectedExtensionArtifactIdentity;

describe("native extension artifact manifest", () => {
  it("accepts an embedded identity matching the facade closure", () => {
    expect(() =>
      verifyExtensionArtifactIdentity(expected, {
        ...expected,
        abiVersion: EXTENSION_ABI_VERSION,
        buildIdentity: "github:current",
      }),
    ).not.toThrow();
  });

  it("rejects a stale binary hidden by current package metadata", async () => {
    const root = await createFixtureWorkspace();
    const binary = join(root, "native", "libopentray_ext_webview.dylib");
    await mkdir(dirname(binary), { recursive: true });
    await writeFile(binary, "stale-binary", "utf8");
    const stale = {
      kind: "webview",
      file: "libopentray_ext_webview.dylib",
      sha256: await sha256File(binary),
      manifest: {
        ...expected,
        artifactSetVersion: "1.0.0",
        contractFingerprint: "webview-contract-1",
        abiVersion: EXTENSION_ABI_VERSION,
        buildIdentity: "github:old",
      } satisfies EmbeddedExtensionManifest,
    } as const;

    await expect(
      verifyRecordedExtensionArtifact(root, binary, expected.target, stale),
    ).rejects.toThrow(/expected=.*2\.0\.0.*actual=.*1\.0\.0/);
  });

  it("requires platform package metadata to match the recorded target", async () => {
    const root = await createFixtureWorkspace();
    const packageDirectory = "packages/ext-webview-darwin-arm64";

    await expect(
      verifyExtensionPlatformPackageTarget(root, packageDirectory, expected.target),
    ).resolves.toBeUndefined();
    await expect(
      verifyExtensionPlatformPackageTarget(root, packageDirectory, {
        os: "win32",
        arch: "arm64",
      }),
    ).rejects.toThrow(/platform package target mismatch/);
  });
});

const createFixtureWorkspace = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "opentray-extension-manifest-"));
  tempDirs.push(root);
  await Promise.all([
    writeJson(join(root, "packages/ext-webview/package.json"), {
      name: "@opentray/ext-webview",
      version: "2.0.0",
    }),
    writeJson(join(root, "packages/ext-webview/contract.json"), {
      extensionName: "webview",
      contractFingerprint: "webview-contract-2",
    }),
    writeJson(join(root, "packages/ext-webview-darwin-arm64/package.json"), {
      name: "@opentray/ext-webview-darwin-arm64",
      version: "2.0.0",
      os: ["darwin"],
      cpu: ["arm64"],
    }),
  ]);
  return root;
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
