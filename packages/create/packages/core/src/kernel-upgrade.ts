// Kernel upgrade (add-create-kernel-upgrade, 2026-10-07). The kernel of a
// generated project is exactly its `dependencies` entries `opentray` and
// `@opentray/ext-webview`; an upgrade advances that graph through the
// project's own package manager and never touches config, icons, payload
// files, or the registration envelope (plan D1/D6).
//
// Version truth is `node_modules/<pkg>/package.json`, never the lockfile or
// the dependency range: a manifest describes the requested graph, not the
// installed one (D3). Live entry instances are stopped before the install
// (argv-identity replace semantics, D2); no broker cleanup belongs here —
// the runtime's artifact-identity check replaces a live old broker on the
// next start. Install failures surface a bounded output tail (D5), and the
// optional restart reopens through the observed open path so a post-upgrade
// startup failure arrives with its app.log tail.

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { openMaterializedApp, stopLiveAppInstances, type OpenAppProbeSeams, type OpenAppResult } from "./open-app";
import { detectPackageManager } from "./materialize";
import type { PackageManagerName } from "./config";

/** The kernel packages every generated project carries in `dependencies`. */
export const KERNEL_PACKAGES = ["opentray", "@opentray/ext-webview"] as const;

/** Bounded install-output tail: enough for the actionable error lines. */
const INSTALL_TAIL_BYTES = 4096;
/** Wall-clock budget for one package-manager install (network + extract). */
const INSTALL_TIMEOUT_MS = 180_000;

export interface KernelUpgradeOptions {
  /** Dependency spec for both kernel packages; default `latest` (registry
   * resolution belongs to the package manager, never to this layer). */
  readonly target?: string | undefined;
  /** Reopen through the observed open path after a successful install. */
  readonly restart?: boolean | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  /** Test seams (defaults: real spawn / real stop / real node_modules reads). */
  readonly probe?: OpenAppProbeSeams | undefined;
  readonly runInstall?: (input: RunKernelInstallInput) => Promise<RunKernelInstallResult>;
  readonly observeMs?: number | undefined;
}

export interface RunKernelInstallInput {
  readonly projectDir: string;
  readonly packageManager: PackageManagerName;
  readonly specs: readonly string[];
}

export interface RunKernelInstallResult {
  readonly code: number | null;
  readonly output: string;
}

export interface KernelUpgradeResult {
  readonly ok: boolean;
  readonly projectDir: string;
  readonly packageManager: PackageManagerName;
  readonly target: string;
  /** pkg → actually-installed version before the upgrade (D3). */
  readonly from: Readonly<Record<string, string>>;
  /** pkg → actually-installed version after the upgrade. */
  readonly to: Readonly<Record<string, string>>;
  readonly upgraded: readonly string[];
  readonly alreadyUpToDate: boolean;
  readonly stoppedPids: readonly number[];
  /** Present on failure: bounded package-manager output tail (D5). */
  readonly installTail: string | undefined;
  /** Present when a restart was requested (and the install succeeded). */
  readonly restart: OpenAppResult | undefined;
  readonly error: string | undefined;
}

const tail = (text: string): string =>
  text.length > INSTALL_TAIL_BYTES ? text.slice(-INSTALL_TAIL_BYTES) : text;

/** Version truth: the installed package's own manifest, not the lockfile. */
const installedVersion = async (projectDir: string, name: string): Promise<string | undefined> => {
  try {
    const raw = JSON.parse(await readFile(join(projectDir, "node_modules", name, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof raw.version === "string" ? raw.version : undefined;
  } catch {
    return undefined;
  }
};

const installedVersions = async (
  projectDir: string,
  packages: readonly string[],
): Promise<Record<string, string>> => {
  const entries: Record<string, string> = {};
  for (const name of packages) {
    const version = await installedVersion(projectDir, name);
    if (version !== undefined) {
      entries[name] = version;
    }
  }
  return entries;
};

const defaultRunInstall = async (input: RunKernelInstallInput): Promise<RunKernelInstallResult> => {
  // `add` semantics with an explicit spec for every runner; the project's
  // lockfile is rewritten exactly like a hand-run install would.
  const command: Record<PackageManagerName, { cmd: string; args: readonly string[] }> = {
    npm: { cmd: "npm", args: ["install", "--no-fund", "--no-audit"] },
    pnpm: { cmd: "pnpm", args: ["add"] },
    bun: { cmd: "bun", args: ["add"] },
  };
  const { cmd, args } = command[input.packageManager];
  return await new Promise<RunKernelInstallResult>((resolvePromise) => {
    const child = spawn(cmd, [...args, ...input.specs], {
      cwd: input.projectDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const collect = (chunk: string): void => {
      output += chunk;
      if (output.length > INSTALL_TAIL_BYTES * 4) {
        output = output.slice(-INSTALL_TAIL_BYTES * 2);
      }
    };
    child.stdout?.setEncoding("utf8").on("data", collect);
    child.stderr?.setEncoding("utf8").on("data", collect);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, INSTALL_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: null, output: `${error.message}\n${output}` });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, output });
    });
  });
};

export const upgradeAppKernel = async (
  projectDir: string,
  options: KernelUpgradeOptions = {},
): Promise<KernelUpgradeResult> => {
  const target = options.target ?? "latest";
  const base: Omit<KernelUpgradeResult, "ok" | "error"> = {
    projectDir,
    packageManager: "npm",
    target,
    from: {},
    to: {},
    upgraded: [],
    alreadyUpToDate: false,
    stoppedPids: [],
    installTail: undefined,
    restart: undefined,
  };
  const fail = (rest: Partial<KernelUpgradeResult> & { error: string }): KernelUpgradeResult => ({
    ...base,
    ...rest,
    ok: false,
  });

  // D1: the kernel is whatever the generated project's dependencies declare
  // from the known family; a project that carries neither is not ours to touch.
  let declared: readonly string[];
  try {
    const manifest = JSON.parse(await readFile(join(projectDir, "package.json"), "utf8")) as {
      dependencies?: Record<string, unknown>;
    };
    declared = KERNEL_PACKAGES.filter(
      (name) => typeof manifest.dependencies?.[name] === "string",
    );
  } catch (error) {
    return fail({
      error: `unreadable package.json: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (declared.length === 0) {
    return fail({
      error: "no kernel packages (opentray / @opentray/ext-webview) found in dependencies",
    });
  }

  // Runner detection mirrors materialize: lockfiles first, then user agent.
  let files: readonly string[] = [];
  try {
    files = await readdir(projectDir);
  } catch {
    // fall through to user-agent detection
  }
  const packageManager = detectPackageManager(files, process.env.npm_config_user_agent);

  const from = await installedVersions(projectDir, declared);

  // D2: stop live entry instances before touching node_modules — the running
  // instance owns the broker endpoint and (on Windows) the loaded binaries.
  const stopped = await stopLiveAppInstances(projectDir, {
    platform: options.platform,
    probe: options.probe,
  });

  const runInstall = options.runInstall ?? defaultRunInstall;
  const install = await runInstall({
    projectDir,
    packageManager,
    specs: declared.map((name) => `${name}@${target}`),
  });
  if (install.code !== 0) {
    return fail({
      packageManager,
      from,
      stoppedPids: stopped.stoppedPids,
      installTail: tail(install.output),
      error: `kernel install exited with ${install.code ?? "spawn error"}`,
    });
  }

  const to = await installedVersions(projectDir, declared);
  const upgraded = declared.filter((name) => to[name] !== undefined && to[name] !== from[name]);
  const alreadyUpToDate = upgraded.length === 0;

  let restart: OpenAppResult | undefined;
  if (options.restart === true) {
    restart = await openMaterializedApp({
      projectDir,
      bundlePath: undefined,
      platform: options.platform,
      observeMs: options.observeMs ?? 4000,
    });
  }

  return {
    ok: true,
    projectDir,
    packageManager,
    target,
    from,
    to,
    upgraded,
    alreadyUpToDate,
    stoppedPids: stopped.stoppedPids,
    installTail: undefined,
    restart,
    error: undefined,
  };
};
