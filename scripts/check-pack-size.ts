#!/usr/bin/env bun
// Orthogonal intents (2026-09-17; original user request: Owner ruling 2026-09-16 -
// a facade package embedding platform binaries must pass a measured pack-size gate):
// 1. Run a REAL `npm pack --json --pack-destination <temp>` per embedded package and
//    read the compressed byte count from the generated .tgz via stat.
// 2. WARN at >= 2 MiB (exit 0, Owner split-decision record required before release);
//    FAIL above 3 MiB (exit 1, must split into `@opentray/<name>-<os>-<arch>` packages).
// 3. Emit a receipt per package (name, tarball path, bytes, npm version, per-target
//    file list) so release evidence is reproducible. `--dry-run` is a development
//    early-warning only and is explicitly NOT release evidence.

import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PACK_SIZE_WARN_BYTES = 2 * 1024 * 1024;
export const PACK_SIZE_FAIL_BYTES = 3 * 1024 * 1024;

/** Repository root (this script lives in `<root>/scripts/`). */
const ROOT = fileURLToPath(new URL("../", import.meta.url));

export type PackSizeVerdict = "ok" | "warn" | "fail";

/** Classification truth: ok below the warn bound, warn at >= 2 MiB, fail above 3 MiB. */
export const evaluateSize = (bytes: number): PackSizeVerdict => {
  if (bytes > PACK_SIZE_FAIL_BYTES) {
    return "fail";
  }
  if (bytes >= PACK_SIZE_WARN_BYTES) {
    return "warn";
  }
  return "ok";
};

/** Default discovery: workspace packages carrying an embedded staging manifest. */
export const discoverEmbeddedPackageDirs = async (root = ROOT): Promise<string[]> =>
  readdir(join(root, "packages"), { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, "packages", entry.name))
        .filter((packageDir) => existsSync(join(packageDir, "platforms", "manifest.json")))
    )
    .catch(() => []);

/** One file entry of the npm pack manifest. */
interface NpmPackFileEntry {
  path?: unknown;
  size?: unknown;
}

/** Parsed `npm pack --json` manifest entry (only the fields this gate reads). */
interface NpmPackEntry {
  name?: unknown;
  filename?: unknown;
  unpackedSize?: unknown;
  size?: unknown;
  files?: unknown;
}

/** One measured package: a real tarball on disk plus the parsed npm pack manifest. */
interface PackMeasurement {
  entry: NpmPackEntry;
  tarballPath: string;
  bytes: number;
  mode: "real" | "dry-run";
}

/** Reproducible receipt line for one measured package. */
export interface PackSizeReceipt {
  packageDir: string;
  packageName: string;
  tarballPath: string;
  bytes: number;
  verdict: PackSizeVerdict;
  mode: "real" | "dry-run";
  platformFiles: string[];
  npmVersion?: string;
  relativeDir?: string;
}

const npmCommand = (): string => (process.platform === "win32" ? "npm.cmd" : "npm");

const runNpm = async (args: string[], options: { cwd: string }): Promise<string> =>
  new Promise<string>((resolveRun, rejectRun) => {
    execFile(
      npmCommand(),
      args,
      { cwd: options.cwd, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          rejectRun(error);
          return;
        }
        resolveRun(stdout);
      }
    );
  });

const parsePackManifest = (stdout: string, label: string): NpmPackEntry => {
  const entries: unknown = JSON.parse(stdout);
  const entry = Array.isArray(entries) ? entries[0] : entries;
  if (entry === undefined || typeof entry !== "object" || entry === null) {
    throw new Error(`npm pack produced no manifest for ${label}`);
  }
  return entry as NpmPackEntry;
};

const requireFilename = (entry: NpmPackEntry, packageDir: string): string => {
  if (typeof entry.filename !== "string") {
    throw new Error(`npm pack produced no manifest for ${packageDir}`);
  }
  return entry.filename;
};

const packReal = async (packageDir: string): Promise<PackMeasurement> => {
  // Pack into the OS temp dir: the worktree must not accumulate tarballs, and
  // a packages/* sibling directory would race other workspace tooling.
  const packDestination = await mkdtemp(join(tmpdir(), "ot-pack-size-"));
  try {
    const stdout = await runNpm(
      ["pack", "--json", "--pack-destination", packDestination],
      { cwd: packageDir }
    );
    const entry = parsePackManifest(stdout, packageDir);
    const tarballPath = join(packDestination, requireFilename(entry, packageDir));
    const bytes = (await stat(tarballPath)).size;
    return { entry, tarballPath, bytes, mode: "real" };
  } finally {
    // The receipt keeps the recorded absolute path; the tarball itself is
    // reproducible from a clean checkout and must not linger.
    await rm(packDestination, { force: true, recursive: true }).catch(() => {});
  }
};

/** Development early-warning arm: no tarball, unpacked approximation from npm. */
const packDryRun = async (packageDir: string): Promise<PackMeasurement> => {
  const stdout = await runNpm(["pack", "--dry-run", "--json"], { cwd: packageDir });
  const entry = parsePackManifest(stdout, packageDir);
  const bytes = Number(entry.unpackedSize ?? entry.size ?? 0);
  return {
    entry,
    tarballPath: "(dry-run: no tarball written)",
    bytes,
    mode: "dry-run",
  };
};

const platformFilesOf = (entry: NpmPackEntry): string[] =>
  (Array.isArray(entry.files) ? (entry.files as NpmPackFileEntry[]) : [])
    .filter((file) => typeof file.path === "string" && file.path.split("/")[0] === "platforms")
    .map((file) => `${String(file.path)} (${Number(file.size)}B unpacked)`);

export interface MeasurePackageOptions {
  dryRun?: boolean;
}

/**
 * Measure one package directory. `pack` is injectable for deterministic tests;
 * the default is a real (or dry-run) npm pack.
 */
export const measurePackage = async (
  packageDir: string,
  options: MeasurePackageOptions = {},
  pack: (packageDir: string) => Promise<PackMeasurement> = options.dryRun
    ? packDryRun
    : packReal
): Promise<PackSizeReceipt> => {
  const measurement = await pack(packageDir);
  const verdict = evaluateSize(measurement.bytes);
  return {
    packageDir,
    packageName: typeof measurement.entry.name === "string" ? measurement.entry.name : "(unknown)",
    tarballPath: measurement.tarballPath,
    bytes: measurement.bytes,
    verdict,
    mode: measurement.mode,
    platformFiles: platformFilesOf(measurement.entry),
  };
};

export const formatReceiptLine = (receipt: PackSizeReceipt): string => {
  const files =
    receipt.platformFiles.length > 0 ? receipt.platformFiles.join(", ") : "(no platforms/ files)";
  const base = `pack-size ${receipt.verdict.toUpperCase()} ${receipt.packageName} tarball=${receipt.tarballPath} bytes=${receipt.bytes} npm=${receipt.npmVersion ?? "(unavailable)"} [${receipt.mode}] targets=[${files}]`;
  if (receipt.verdict === "warn") {
    return `${base} -- WARN >= 2MiB: packaging requires an Owner split-decision record before release (Owner ruling 2026-09-16)`;
  }
  if (receipt.verdict === "fail") {
    return `${base} -- FAIL > 3MiB: must split into @opentray/<name>-<os>-<arch> platform packages before release`;
  }
  return base;
};

export interface RunCheckOptions {
  root?: string;
  packageDirs?: string[];
  packageArgs?: string[];
  dryRun?: boolean;
  pack?: (packageDir: string) => Promise<PackMeasurement>;
}

export interface RunCheckResult {
  receipts: PackSizeReceipt[];
  failed: PackSizeReceipt[];
  exitCode: number;
}

export const runCheck = async (options: RunCheckOptions = {}): Promise<RunCheckResult> => {
  const root = options.root ?? ROOT;
  const packageDirs =
    options.packageDirs ??
    (options.packageArgs && options.packageArgs.length > 0
      ? options.packageArgs.map((dir) => resolve(process.cwd(), dir))
      : await discoverEmbeddedPackageDirs(root));
  const npmVersion = await runNpm(["--version"], { cwd: process.cwd() })
    .then((stdout) => stdout.trim())
    .catch(() => undefined);

  const receipts: PackSizeReceipt[] = [];
  for (const packageDir of packageDirs) {
    const receipt = await measurePackage(
      packageDir,
      { dryRun: options.dryRun === true },
      options.pack
    );
    receipt.npmVersion = npmVersion;
    receipt.relativeDir = relative(root, packageDir) || ".";
    receipts.push(receipt);
  }
  const failed = receipts.filter((receipt) => receipt.verdict === "fail");
  return { receipts, failed, exitCode: failed.length > 0 ? 1 : 0 };
};

const parseArgs = (argv: string[]): { packageArgs: string[]; dryRun: boolean } => {
  const packageArgs: string[] = [];
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--package") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--package requires a directory argument");
      }
      packageArgs.push(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { packageArgs, dryRun };
};

export const main = async (argv: string[] = process.argv.slice(2)): Promise<number> => {
  const { packageArgs, dryRun } = parseArgs(argv);
  if (dryRun) {
    console.log(
      "pack-size DRY-RUN WARNING: development early-warning only; NOT release evidence and NOT eligible for the packaging GO (add-ext-dialog section 6.3)"
    );
  }
  const { receipts, exitCode } = await runCheck({ packageArgs, dryRun });
  if (receipts.length === 0) {
    console.log("pack-size OK: no embedded platform-binary packages found (nothing to measure)");
    return 0;
  }
  for (const receipt of receipts) {
    console.log(formatReceiptLine(receipt));
  }
  if (exitCode !== 0) {
    console.error(
      `pack-size gate FAILED: ${receipts.filter((r) => r.verdict === "fail").length} package(s) exceed 3MiB compressed`
    );
  }
  return exitCode;
};

// URL-safe entry detection (Windows drive paths break naive file:// compares).
if (pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
