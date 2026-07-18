#!/usr/bin/env bun
// Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
// 1. Pack one coherent official broker/WebView package closure from release-ready directories.
// 2. Install that closure with pnpm isolated or npm-compatible flat resolution.
// 3. Prove facade-relative native resolution ignores an orphan pnpm root package.

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

type PackageManager = "pnpm" | "npm";
type PackedTarget = "darwin-arm64" | "darwin-x64" | "windows-arm64" | "windows-x64";

interface PackageManifest {
  name: string;
  version: string;
}

interface TargetPackages {
  platform: "darwin" | "win32";
  arch: "arm64" | "x64";
  runtimeDir: string;
  runtimeName: string;
  extensionDir: string;
  extensionName: string;
}

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: { type: "string", default: process.cwd() },
    "package-manager": { type: "string", default: "pnpm" },
    target: { type: "string", default: defaultPackedTarget() },
    keep: { type: "boolean", default: false },
  },
});

const root = values.root ?? process.cwd();
const packageManager = parsePackageManager(values["package-manager"] ?? "pnpm");
const target = parseTarget(values.target ?? defaultPackedTarget());
const targetPackages = packagesForTarget(target);
const workspacePackageManager = await readWorkspacePackageManager(join(root, "package.json"));
const fixtureRoot = await mkdtemp(join(tmpdir(), `opentray-${packageManager}-consumer-`));

try {
  const packDir = join(fixtureRoot, "tarballs");
  const consumerDir = join(fixtureRoot, "consumer");
  await Promise.all([mkdir(packDir, { recursive: true }), mkdir(consumerDir, { recursive: true })]);

  const packageDirs = [
    "packages/spec",
    "packages/cli",
    "packages/ext-webview",
    targetPackages.runtimeDir,
    targetPackages.extensionDir,
  ];
  const tarballs = new Map<string, string>();
  for (const packageDir of packageDirs) {
    const absolutePackageDir = join(root, packageDir);
    const manifest = await readManifest(join(absolutePackageDir, "package.json"));
    await run("pnpm", ["--dir", absolutePackageDir, "pack", "--pack-destination", packDir], root);
    tarballs.set(manifest.name, join(packDir, tarballName(manifest)));
  }

  const specTarball = requireTarball(tarballs, "@opentray/spec");
  const runtimeTarball = requireTarball(tarballs, targetPackages.runtimeName);
  const extensionTarball = requireTarball(tarballs, targetPackages.extensionName);
  const dependencies: Record<string, string> = {
    opentray: fileDependency(requireTarball(tarballs, "opentray")),
    "@opentray/ext-webview": fileDependency(requireTarball(tarballs, "@opentray/ext-webview")),
  };
  const packageJson: Record<string, unknown> = {
    name: `opentray-${packageManager}-consumer-fixture`,
    private: true,
    type: "module",
    packageManager: workspacePackageManager,
    dependencies,
  };
  if (packageManager === "pnpm") {
    packageJson.pnpm = {
      overrides: {
        "@opentray/spec": fileDependency(specTarball),
        [targetPackages.runtimeName]: fileDependency(runtimeTarball),
        [targetPackages.extensionName]: fileDependency(extensionTarball),
      },
    };
  } else {
    dependencies["@opentray/spec"] = fileDependency(specTarball);
    dependencies[targetPackages.runtimeName] = fileDependency(runtimeTarball);
    dependencies[targetPackages.extensionName] = fileDependency(extensionTarball);
  }
  await writeFile(join(consumerDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

  await run(
    packageManager,
    packageManager === "pnpm"
      ? ["install", "--ignore-scripts"]
      : ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    consumerDir,
  );

  let orphanPath: string | undefined;
  if (packageManager === "pnpm") {
    const orphanDir = join(consumerDir, "node_modules", targetPackages.extensionName);
    orphanPath = join(orphanDir, nativeLibraryRelativePath(targetPackages.platform));
    await mkdir(dirname(orphanPath), { recursive: true });
    await writeFile(
      join(orphanDir, "package.json"),
      `${JSON.stringify(
        {
          name: targetPackages.extensionName,
          version: "0.0.1-orphan",
          os: [targetPackages.platform === "win32" ? "win32" : "darwin"],
          cpu: [targetPackages.arch],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(orphanPath, "orphan native artifact");
  }

  const verificationScript = join(consumerDir, "verify.mjs");
  await writeFile(verificationScript, createVerificationScript(targetPackages, orphanPath));
  await run(process.execPath, [verificationScript], consumerDir);
  console.log(
    JSON.stringify(
      { ok: true, packageManager, target, fixtureRoot, orphanPath: orphanPath ?? null },
      null,
      2,
    ),
  );
} finally {
  if (values.keep !== true) {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

function createVerificationScript(target: TargetPackages, orphanPath: string | undefined): string {
  return `
import { createRequire } from "node:module";
import { realpath } from "node:fs/promises";
import { createTray } from "opentray";
import { WebviewExt } from "@opentray/ext-webview";
import { resolveNativeExtensionArtifact } from "opentray";

const resolved = await resolveNativeExtensionArtifact(
  WebviewExt.artifact,
  ${JSON.stringify(target.platform)},
  ${JSON.stringify(target.arch)},
);
const actualPath = await realpath(resolved.path);
const orphanPath = ${JSON.stringify(orphanPath)};
if (orphanPath !== undefined && actualPath === await realpath(orphanPath)) {
  throw new Error("orphan top-level platform package won facade-relative resolution");
}
const requireFromConsumer = createRequire(import.meta.url);
const requireFromRuntime = createRequire(requireFromConsumer.resolve("opentray/package.json"));
const runtimeManifest = requireFromRuntime.resolve(${JSON.stringify(`${target.runtimeName}/package.json`)});
const tray = await createTray(
  {
    id: "com.opentray.verify-packed-consumer",
    icon: { "text-only": "OT" },
  },
  {
    appId: "com.opentray.verify-packed-consumer",
    appName: "OpenTray packed consumer verification",
  },
);
try {
  await tray.loadExtension({ name: WebviewExt.name, artifact: WebviewExt.artifact });
} finally {
  await tray.destroy();
}
console.log(JSON.stringify({ resolved, actualPath, runtimeManifest, loaded: true }, null, 2));
`;
}

function packagesForTarget(target: PackedTarget): TargetPackages {
  const [packagePlatform, arch] = target.split("-") as ["darwin" | "windows", "arm64" | "x64"];
  const platform = packagePlatform === "windows" ? "win32" : "darwin";
  return {
    platform,
    arch,
    runtimeDir: `packages/${packagePlatform}-${arch}`,
    runtimeName: `@opentray/${packagePlatform}-${arch}`,
    extensionDir: `packages/ext-webview-${packagePlatform}-${arch}`,
    extensionName: `@opentray/ext-webview-${packagePlatform}-${arch}`,
  };
}

function parsePackageManager(value: string): PackageManager {
  if (value === "pnpm" || value === "npm") return value;
  throw new Error(`unsupported package manager: ${value}`);
}

function parseTarget(value: string): PackedTarget {
  if (
    value === "darwin-arm64" ||
    value === "darwin-x64" ||
    value === "windows-arm64" ||
    value === "windows-x64"
  ) {
    return value;
  }
  throw new Error(`packed WebView consumer target is unsupported: ${value}`);
}

function defaultPackedTarget(): string {
  const packagePlatform = process.platform === "win32" ? "windows" : process.platform;
  return `${packagePlatform}-${process.arch}`;
}

async function readManifest(path: string): Promise<PackageManifest> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("version" in value) ||
    typeof value.version !== "string"
  ) {
    throw new Error(`invalid package manifest: ${path}`);
  }
  return { name: value.name, version: value.version };
}

async function readWorkspacePackageManager(path: string): Promise<string> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    typeof value !== "object" ||
    value === null ||
    !("packageManager" in value) ||
    typeof value.packageManager !== "string"
  ) {
    throw new Error(`workspace package manager is missing: ${path}`);
  }
  return value.packageManager;
}

function tarballName(manifest: PackageManifest): string {
  return `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`;
}

function requireTarball(tarballs: ReadonlyMap<string, string>, name: string): string {
  const path = tarballs.get(name);
  if (path === undefined) throw new Error(`package tarball was not created: ${name}`);
  return path;
}

function fileDependency(path: string): string {
  return `file:${path}`;
}

function nativeLibraryRelativePath(platform: "darwin" | "win32"): string {
  return platform === "darwin"
    ? "lib/libopentray_ext_webview.dylib"
    : "bin/opentray_ext_webview.dll";
}

function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "unknown"}`));
    });
  });
}
