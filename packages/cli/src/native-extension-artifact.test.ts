// Orthogonal intents (2026-09-17; original user request: one fat facade
// package must still prove its native identity chain):
// 1. Resolve an embedded per-target library through the staging manifest
//    (sha256 + buildIdentity flow into the LoadExt expected identity).
// 2. Reject the four structured classes: target-unsupported,
//    path-outside-facade (traversal + symlink escape), manifest-invalid
//    (skew + real byte replacement + missing matrix cell), library-unreadable.
// 3. Enforce the frozen four-target staging matrix: the fixture always
//    stages the complete catalog and every missing cell has its own arm.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX,
  NATIVE_EXTENSION_EMBEDDED_ERROR_CODES,
  NativeExtensionEmbeddedArtifactError,
  resolveNativeExtensionArtifact,
  type NativeExtensionEmbeddedArtifact,
  type NativeExtensionEmbeddedMatrixTarget,
} from "./native-extension-artifact";

const tempDirs: string[] = [];
const itWithSymlinks = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const libraryBytesFor = (target: NativeExtensionEmbeddedMatrixTarget): Buffer =>
  Buffer.from(`dialog-native-dylib-bytes-${target}`, "utf8");

const libraryPathFor = (target: NativeExtensionEmbeddedMatrixTarget): string =>
  `platforms/${target}/libopentray_ext_dialog.dylib`;

interface EmbeddedFacadeOptions {
  /** Overrides the darwin-arm64 library bytes (the resolver test target). */
  libraryBytes?: string;
  /** Omits the darwin-arm64 library file from disk. */
  omitLibrary?: boolean;
  manifestMutator?: (manifest: Record<string, unknown>) => void;
}

const buildEmbeddedFacade = async (
  options: EmbeddedFacadeOptions = {}
): Promise<string> => {
  const root = await mkdtemp("/tmp/ot-embedded-");
  tempDirs.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "@opentray/ext-dialog", version: "1.2.3" }, null, 2)
  );
  await writeFile(
    join(root, "contract.json"),
    JSON.stringify(
      {
        extensionName: "dialog",
        contractFingerprint: "opentray-ext-dialog-contract-1",
      },
      null,
      2
    )
  );
  // The complete frozen matrix: one platform directory and one manifest entry
  // per target (section 6.4 staging completeness).
  const targets: Record<string, unknown> = {};
  for (const target of NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX) {
    const bytes =
      target === "darwin-arm64" && options.libraryBytes !== undefined
        ? Buffer.from(options.libraryBytes, "utf8")
        : libraryBytesFor(target);
    await mkdir(join(root, "platforms", target), { recursive: true });
    if (!(target === "darwin-arm64" && options.omitLibrary)) {
      await writeFile(join(root, libraryPathFor(target)), bytes);
    }
    targets[target] = {
      path: libraryPathFor(target),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      buildIdentity: `sha256:dialog-build-${target}`,
    };
  }
  const manifest: Record<string, unknown> = {
    facadeVersion: "1.2.3",
    contractFingerprint: "opentray-ext-dialog-contract-1",
    targets,
  };
  options.manifestMutator?.(manifest);
  await writeFile(join(root, "platforms", "manifest.json"), JSON.stringify(manifest, null, 2));
  return root;
};

const embeddedArtifact = (
  root: string,
  libraryPath = libraryPathFor("darwin-arm64")
): NativeExtensionEmbeddedArtifact => ({
  kind: "embedded",
  packageJsonUrl: pathToFileURL(join(root, "package.json")).href,
  contractManifestUrl: pathToFileURL(join(root, "contract.json")).href,
  targets: {
    "darwin-arm64": { libraryPath },
    "darwin-x64": { libraryPath: libraryPathFor("darwin-x64") },
    "win32-arm64": { libraryPath: libraryPathFor("win32-arm64") },
    "win32-x64": { libraryPath: libraryPathFor("win32-x64") },
  },
});

const expectEmbeddedError = async (
  promise: Promise<unknown>,
  reason: NativeExtensionEmbeddedArtifactError["reason"],
  expectedTarget = "darwin-arm64"
): Promise<NativeExtensionEmbeddedArtifactError> => {
  const error = await promise.then(
    () => {
      throw new Error(`expected an embedded ${reason} rejection`);
    },
    (rejection: unknown) => rejection
  );
  expect(error).toBeInstanceOf(NativeExtensionEmbeddedArtifactError);
  expect(error).toBeInstanceOf(Error);
  const typed = error as NativeExtensionEmbeddedArtifactError;
  expect(typed.reason).toBe(reason);
  expect(typed.code).toBe(NATIVE_EXTENSION_EMBEDDED_ERROR_CODES[reason]);
  expect(typed.target).toBe(expectedTarget);
  expect(typed.facadePackageJsonUrl).toContain("package.json");
  return typed;
};

describe("embedded native extension artifacts", () => {
  it("resolves through the staging manifest identity chain", async () => {
    const root = await buildEmbeddedFacade();
    const libraryBytes = libraryBytesFor("darwin-arm64");
    const resolved = await resolveNativeExtensionArtifact(
      embeddedArtifact(root),
      "darwin",
      "arm64"
    );

    expect(resolved.path).toBe(
      await realpath(join(root, "platforms", "darwin-arm64", "libopentray_ext_dialog.dylib"))
    );
    expect(resolved.target).toBe("darwin-arm64");
    expect(resolved.expectedIdentity).toEqual({
      extensionName: "dialog",
      artifactSetVersion: "1.2.3",
      contractFingerprint: "opentray-ext-dialog-contract-1",
      target: { os: "darwin", arch: "arm64" },
      sha256: createHash("sha256").update(libraryBytes).digest("hex"),
      buildIdentity: "sha256:dialog-build-darwin-arm64",
    });
    // LoadExt wire shape: the identity-chain fields ride expectedIdentity.
    const wire = JSON.parse(JSON.stringify(resolved.expectedIdentity));
    expect(wire.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(wire.buildIdentity).toBe("sha256:dialog-build-darwin-arm64");
  });

  it("resolves any matrix cell the descriptor declares (cross-target)", async () => {
    const root = await buildEmbeddedFacade();
    const resolved = await resolveNativeExtensionArtifact(
      embeddedArtifact(root),
      "darwin",
      "x64"
    );

    expect(resolved.target).toBe("darwin-x64");
    expect(resolved.path).toBe(
      await realpath(join(root, "platforms", "darwin-x64", "libopentray_ext_dialog.dylib"))
    );
    expect(resolved.expectedIdentity).toEqual({
      extensionName: "dialog",
      artifactSetVersion: "1.2.3",
      contractFingerprint: "opentray-ext-dialog-contract-1",
      target: { os: "darwin", arch: "x64" },
      sha256: createHash("sha256").update(libraryBytesFor("darwin-x64")).digest("hex"),
      buildIdentity: "sha256:dialog-build-darwin-x64",
    });
  });

  it("rejects a target outside the frozen staging matrix (target-unsupported)", async () => {
    const root = await buildEmbeddedFacade();
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(root), "linux", "x64"),
      "target-unsupported",
      "linux-x64"
    );
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(root), "linux", "arm64"),
      "target-unsupported",
      "linux-arm64"
    );
  });

  it("cannot represent an incomplete embedded catalog at the type level", () => {
    const incomplete: NativeExtensionEmbeddedArtifact = {
      kind: "embedded",
      packageJsonUrl: "file:///fixture/package.json",
      contractManifestUrl: "file:///fixture/contract.json",
      // @ts-expect-error the declared catalog must be complete over the
      // frozen matrix; a descriptor with only darwin-arm64 is not representable.
      targets: {
        "darwin-arm64": { libraryPath: "platforms/darwin-arm64/libopentray_ext_dialog.dylib" },
      },
    };
    void incomplete;
    expect(NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "win32-arm64",
      "win32-x64",
    ]);
  });

  it("rejects a staging manifest missing any matrix cell (manifest-invalid, per-cell)", async () => {
    for (const missing of NATIVE_EXTENSION_EMBEDDED_TARGET_MATRIX) {
      const root = await buildEmbeddedFacade({
        manifestMutator: (manifest) => {
          delete (manifest.targets as Record<string, unknown>)[missing];
        },
      });
      const error = await expectEmbeddedError(
        resolveNativeExtensionArtifact(embeddedArtifact(root), "darwin", "arm64"),
        "manifest-invalid"
      );
      expect(error.message).toContain(missing);
    }
  });

  it("rejects traversal and absolute library paths before touching the filesystem (path-outside-facade)", async () => {
    const root = await buildEmbeddedFacade();
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(
        embeddedArtifact(root, "../../outside/libopentray_ext_dialog.dylib"),
        "darwin",
        "arm64"
      ),
      "path-outside-facade"
    );
    const absolute = join(root, "platforms", "darwin-arm64", "libopentray_ext_dialog.dylib");
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(root, absolute), "darwin", "arm64"),
      "path-outside-facade"
    );
  });

  it("rejects a staging-manifest path that escapes the facade root (path-outside-facade)", async () => {
    const root = await buildEmbeddedFacade({
      manifestMutator: (manifest) => {
        const targets = manifest.targets as Record<string, { path: string }>;
        targets["darwin-arm64"] = {
          ...targets["darwin-arm64"],
          path: "../../evil/lib.dylib",
        };
      },
    });
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(root), "darwin", "arm64"),
      "path-outside-facade"
    );
  });

  itWithSymlinks(
    "rejects a symlink inside the facade that resolves outside (path-outside-facade)",
    async () => {
      const root = await buildEmbeddedFacade({ omitLibrary: true });
      const outsideRoot = await mkdtemp("/tmp/ot-outside-");
      tempDirs.push(outsideRoot);
      const outsideLibrary = join(outsideRoot, "libopentray_ext_dialog.dylib");
      const outsideBytes = Buffer.from("outside-library-bytes", "utf8");
      await writeFile(outsideLibrary, outsideBytes);
      const linkPath = join(root, "platforms", "darwin-arm64", "libopentray_ext_dialog.dylib");
      await symlink(outsideLibrary, linkPath);
      // The manifest legitimately describes the outside bytes: containment,
      // not the hash, must catch the escape. The manifest stays complete over
      // the matrix; only the darwin-arm64 entry claims the outside bytes.
      await writeFile(
        join(root, "platforms", "manifest.json"),
        JSON.stringify({
          facadeVersion: "1.2.3",
          contractFingerprint: "opentray-ext-dialog-contract-1",
          targets: {
            "darwin-arm64": {
              path: "platforms/darwin-arm64/libopentray_ext_dialog.dylib",
              sha256: createHash("sha256").update(outsideBytes).digest("hex"),
              buildIdentity: "sha256:dialog-build-darwin-arm64",
            },
            "darwin-x64": {
              path: libraryPathFor("darwin-x64"),
              sha256: createHash("sha256").update(libraryBytesFor("darwin-x64")).digest("hex"),
              buildIdentity: "sha256:dialog-build-darwin-x64",
            },
            "win32-arm64": {
              path: libraryPathFor("win32-arm64"),
              sha256: createHash("sha256").update(libraryBytesFor("win32-arm64")).digest("hex"),
              buildIdentity: "sha256:dialog-build-win32-arm64",
            },
            "win32-x64": {
              path: libraryPathFor("win32-x64"),
              sha256: createHash("sha256").update(libraryBytesFor("win32-x64")).digest("hex"),
              buildIdentity: "sha256:dialog-build-win32-x64",
            },
          },
        })
      );

      await expectEmbeddedError(
        resolveNativeExtensionArtifact(embeddedArtifact(root), "darwin", "arm64"),
        "path-outside-facade"
      );
    }
  );

  it("rejects an unreadable or missing library (library-unreadable)", async () => {
    const root = await buildEmbeddedFacade({ omitLibrary: true });
    const error = await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(root), "darwin", "arm64"),
      "library-unreadable"
    );
    expect((error.cause as NodeJS.ErrnoException | undefined)?.code).toBe("ENOENT");
  });

  it("rejects replaced real library bytes against the manifest claim (manifest-invalid)", async () => {
    const root = await buildEmbeddedFacade();
    // Replace the actual bytes after the manifest was written for the
    // original content: the JSON claim is now a lie.
    await writeFile(
      join(root, "platforms", "darwin-arm64", "libopentray_ext_dialog.dylib"),
      Buffer.from("tampered-library-bytes", "utf8")
    );
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(root), "darwin", "arm64"),
      "manifest-invalid"
    );
  });

  it("rejects manifest skew against the facade and contract manifests (manifest-invalid)", async () => {
    const versionSkew = await buildEmbeddedFacade({
      manifestMutator: (manifest) => {
        manifest.facadeVersion = "9.9.9";
      },
    });
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(versionSkew), "darwin", "arm64"),
      "manifest-invalid"
    );

    const fingerprintSkew = await buildEmbeddedFacade({
      manifestMutator: (manifest) => {
        manifest.contractFingerprint = "opentray-ext-dialog-contract-999";
      },
    });
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(fingerprintSkew), "darwin", "arm64"),
      "manifest-invalid"
    );

    const pathSkew = await buildEmbeddedFacade({
      manifestMutator: (manifest) => {
        const targets = manifest.targets as Record<string, { path: string }>;
        targets["darwin-arm64"] = {
          ...targets["darwin-arm64"],
          path: "platforms/darwin-arm64/other.dylib",
        };
      },
    });
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(pathSkew), "darwin", "arm64"),
      "manifest-invalid"
    );
  });

  it("rejects malformed staging manifests (manifest-invalid)", async () => {
    const missingSha = await buildEmbeddedFacade({
      manifestMutator: (manifest) => {
        const targets = manifest.targets as Record<string, Record<string, unknown>>;
        const entry = targets["darwin-arm64"];
        if (entry !== undefined) {
          delete entry.sha256;
        }
      },
    });
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(missingSha), "darwin", "arm64"),
      "manifest-invalid"
    );

    const upperHex = await buildEmbeddedFacade({
      manifestMutator: (manifest) => {
        const targets = manifest.targets as Record<string, { sha256: string }>;
        const entry = targets["darwin-arm64"];
        if (entry !== undefined) {
          entry.sha256 = entry.sha256.toUpperCase();
        }
      },
    });
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(upperHex), "darwin", "arm64"),
      "manifest-invalid"
    );

    const extraTarget = await buildEmbeddedFacade({
      manifestMutator: (manifest) => {
        const targets = manifest.targets as Record<string, unknown>;
        targets["linux-x64"] = {
          path: "platforms/linux-x64/lib.so",
          sha256: "a".repeat(64),
          buildIdentity: "sha256:linux-build",
        };
      },
    });
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(extraTarget), "darwin", "arm64"),
      "manifest-invalid"
    );

    const root = await buildEmbeddedFacade();
    await writeFile(join(root, "platforms", "manifest.json"), "{not-json");
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(root), "darwin", "arm64"),
      "manifest-invalid"
    );

    const noManifest = await mkdtemp("/tmp/ot-embedded-nomanifest-");
    tempDirs.push(noManifest);
    await expectEmbeddedError(
      resolveNativeExtensionArtifact(embeddedArtifact(noManifest), "darwin", "arm64"),
      "manifest-invalid"
    );
  });
});
