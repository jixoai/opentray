#!/usr/bin/env bun
// Orthogonal intents (2026-09-17; original user request: add-ext-dialog batch D,
// tasks 5.1/5.2 — real pack is the ONLY release evidence):
// 1. Run a REAL `npm pack --json --pack-destination <temp>` against the staged
//    embedded facade package (dry-run output is development warning only and is
//    never evidence — retired-dry-run-evidence rule).
// 2. Unpack the SAME tgz in memory and prove the per-target identity chain on
//    the unpacked bytes: every frozen-matrix library re-hashes to the staging
//    manifest SHA-256, the manifest path matches the frozen layout, and
//    facadeVersion/contractFingerprint equal the packed facade package.json /
//    contract.json.
// 3. Emit one structured evidence line per target plus a receipt line, and
//    exit non-zero on any mismatch so CI cannot record a false packaging GO.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

import {
  EMBEDDED_STAGING_TARGET_MATRIX,
  buildEmbeddedStagingManifest,
  type EmbeddedStagingMatrixTarget,
  type EmbeddedStagingTargetEvidence,
} from "./embedded-staging-manifest";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: {
      type: "string",
      default: process.cwd(),
    },
    package: {
      type: "string",
      default: "packages/ext-dialog",
    },
  },
});

const root = values.root ?? process.cwd();
const packageDir = join(root, values.package ?? "packages/ext-dialog");

interface NpmPackEntry {
  name?: unknown;
  filename?: unknown;
}

const npmCommand = (): string => (process.platform === "win32" ? "npm.cmd" : "npm");

const runNpm = async (args: readonly string[], cwd: string): Promise<string> =>
  new Promise<string>((resolveRun, rejectRun) => {
    execFile(
      npmCommand(),
      [...args],
      { cwd, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          rejectRun(error);
          return;
        }
        resolveRun(stdout);
      }
    );
  });

interface UnpackedFile {
  readonly path: string;
  readonly data: Buffer;
}

/** Minimal ustar reader for the regular files npm pack emits (no pax, no GNU longname). */
const readTarFiles = (archive: Buffer): readonly UnpackedFile[] => {
  const files: UnpackedFile[] = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = readTarField(header, 0, 100);
    const prefix = readTarField(header, 345, 155);
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    const size = parseTarOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    offset += 512;
    if (typeFlag === "0" || typeFlag === "" || typeFlag === " ") {
      files.push({ path, data: archive.subarray(offset, offset + size) });
    } else if (typeFlag !== "5") {
      throw new Error(`unexpected tar entry type "${typeFlag}" for ${path}`);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
};

const readTarField = (header: Buffer, offset: number, length: number): string => {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.toString("utf8", 0, end === -1 ? length : end).trim();
};

const parseTarOctal = (header: Buffer, offset: number, length: number): number => {
  const value = readTarField(header, offset, length);
  return value.length === 0 ? 0 : Number.parseInt(value, 8);
};

const requireUnpacked = (
  files: readonly UnpackedFile[],
  path: string
): Buffer => {
  const file = files.find((candidate) => candidate.path === `package/${path}`);
  if (file === undefined) {
    throw new Error(`packed tarball is missing ${path}`);
  }
  return file.data;
};

const sha256Of = (data: Buffer): string =>
  createHash("sha256").update(data).digest("hex");

const parseJsonBuffer = (data: Buffer, label: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(data.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch (cause) {
    throw new Error(`packed ${label} is not a valid JSON object`, { cause });
  }
};

const libraryNameFor = (
  target: EmbeddedStagingMatrixTarget,
  extensionName: string
): string =>
  target.startsWith("win32-")
    ? `opentray_ext_${extensionName}.dll`
    : `libopentray_ext_${extensionName}.dylib`;

const packDestination = await mkdtemp(join(tmpdir(), "ot-embedded-pack-"));
try {
  // 1. Real pack: the tarball on disk is the evidence input.
  const packStdout = await runNpm(
    ["pack", "--json", "--pack-destination", packDestination],
    packageDir
  );
  const packEntry = (JSON.parse(packStdout) as NpmPackEntry[])[0];
  if (packEntry === undefined || typeof packEntry.filename !== "string") {
    throw new Error(`npm pack produced no manifest for ${values.package}`);
  }
  const tarballPath = join(packDestination, packEntry.filename);
  const tarballBytes = (await stat(tarballPath)).size;
  const npmVersion = (await runNpm(["--version"], packageDir)).trim();

  // 2. Unpack the same tarball and prove the identity chain per target.
  const archive = gunzipSync(await readFile(tarballPath));
  const files = readTarFiles(archive);

  const facadeManifest = parseJsonBuffer(
    requireUnpacked(files, "package.json"),
    "facade package.json"
  );
  const contractManifest = parseJsonBuffer(
    requireUnpacked(files, "contract.json"),
    "contract.json"
  );
  if (typeof facadeManifest.version !== "string") {
    throw new Error("packed facade package.json has no version");
  }
  if (typeof contractManifest.contractFingerprint !== "string") {
    throw new Error("packed contract.json has no contractFingerprint");
  }
  if (typeof contractManifest.extensionName !== "string" || contractManifest.extensionName.length === 0) {
    throw new Error("packed contract.json has no extensionName");
  }
  // The frozen embedded layout derives each library basename from the
  // extension's own identity (opentray_ext_<name>.dll /
  // libopentray_ext_<name>.dylib), so the gate covers every embedded facade
  // kind (dialog, sound) without hardcoding extension names.
  const extensionName = contractManifest.extensionName;

  const rawStagingManifest = parseJsonBuffer(
    requireUnpacked(files, "platforms/manifest.json"),
    "platforms/manifest.json"
  );
  if (
    typeof rawStagingManifest.facadeVersion !== "string" ||
    typeof rawStagingManifest.contractFingerprint !== "string" ||
    typeof rawStagingManifest.targets !== "object" ||
    rawStagingManifest.targets === null ||
    Array.isArray(rawStagingManifest.targets)
  ) {
    throw new Error("packed platforms/manifest.json has an invalid shape");
  }
  // Re-run the staging-side completeness validator over the packed manifest.
  const stagingManifest = buildEmbeddedStagingManifest({
    facadeVersion: rawStagingManifest.facadeVersion,
    contractFingerprint: rawStagingManifest.contractFingerprint,
    targets: rawStagingManifest.targets as Record<string, EmbeddedStagingTargetEvidence>,
  });
  if (stagingManifest.facadeVersion !== facadeManifest.version) {
    throw new Error(
      `packed staging manifest facadeVersion ${stagingManifest.facadeVersion} does not match packed facade version ${facadeManifest.version}`
    );
  }
  if (stagingManifest.contractFingerprint !== contractManifest.contractFingerprint) {
    throw new Error(
      `packed staging manifest contractFingerprint does not match packed contract.json (${contractManifest.contractFingerprint})`
    );
  }

  for (const matrixTarget of EMBEDDED_STAGING_TARGET_MATRIX) {
    const entry = stagingManifest.targets[matrixTarget];
    const expectedPath = `platforms/${matrixTarget}/${libraryNameFor(matrixTarget, extensionName)}`;
    if (entry.path !== expectedPath) {
      throw new Error(
        `packed staging manifest path for ${matrixTarget} is ${entry.path}; frozen layout requires ${expectedPath}`
      );
    }
    const libraryBytes = requireUnpacked(files, expectedPath);
    const actualSha256 = sha256Of(libraryBytes);
    if (actualSha256 !== entry.sha256) {
      throw new Error(
        `unpacked library bytes for ${matrixTarget} do not match the staging manifest: expected=${entry.sha256} actual=${actualSha256}`
      );
    }
    console.log(
      `embedded-pack-identity OK ${matrixTarget} path=${expectedPath} sha256=${actualSha256} buildIdentity=${entry.buildIdentity} bytes=${libraryBytes.length}`
    );
  }

  console.log(
    `embedded-pack-receipt ${values.package} tarball=${tarballPath} bytes=${tarballBytes} facadeVersion=${facadeManifest.version} fingerprint=${contractManifest.contractFingerprint} npm=${npmVersion} mode=real`
  );
} finally {
  await rm(packDestination, { force: true, recursive: true }).catch(() => {});
}
