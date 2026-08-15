#!/usr/bin/env node
// Orthogonal intents (maintained 2026-07-22; original user request: `npx
// create-opentray` opens a WebUI wizard that packages a start command into an
// OpenTray-hosted app):
// 1. Parse wizard flags and resolve the working directory.
// 2. Serve the wizard on loopback and open the default browser unless disabled.
// 3. Tear down the preview process tree on exit signals.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createWizardServer } from "./server";
import { createWizardSession } from "./wizard";
import { ensureLoopbackNoProxy } from "./port-scan";

export interface WizardCliOptions {
  readonly open: boolean;
  readonly port: number | undefined;
  readonly pm: "npm" | "pnpm" | "bun" | undefined;
  readonly skipInstall: boolean;
  readonly force: boolean;
  readonly targetDir: string | undefined;
}


export const parseWizardCli = (argv: readonly string[]): WizardCliOptions => {
  const options: {
    open: boolean;
    port?: number;
    pm?: "npm" | "pnpm" | "bun";
    skipInstall: boolean;
    force: boolean;
    targetDir?: string;
  } = { open: true, skipInstall: false, force: false };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--no-open") {
      options.open = false;
    } else if (arg === "--skip-install") {
      options.skipInstall = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--port") {
      const value = argv[index + 1];
      const port = Number.parseInt(value ?? "", 10);
      if (Number.isInteger(port) && port > 0 && port < 65_536) {
        options.port = port;
        index += 1;
      }
    } else if (arg === "--pm") {
      const value = argv[index + 1];
      if (value === "npm" || value === "pnpm" || value === "bun") {
        options.pm = value;
        index += 1;
      }
    } else if (arg === "--help" || arg === "-h") {
      options.open = false;
      positional.length = 0;
      break;
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }
  const [target] = positional;
  return {
    open: options.open,
    port: options.port,
    pm: options.pm,
    skipInstall: options.skipInstall,
    force: options.force,
    targetDir: target,
  };
};

const WIZARD_HELP = [
  "create-opentray — turn a start command into an OpenTray-hosted desktop app",
  "",
  "Usage: create-opentray [targetDir] [options]",
  "",
  "Options:",
  "  --no-open        do not open the default browser",
  "  --port <n>       bind the wizard server to a specific loopback port",
  "  --pm <name>      package manager for the generated app (npm | pnpm | bun)",
  "  --skip-install   scaffold without installing dependencies",
  "  --force          allow materializing into a non-empty directory",
  "  -h, --help       show this help",
].join("\n");

const readDependencyRange = async (): Promise<string> => {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  try {
    const parsed = JSON.parse(await readFile(packageJsonUrl, "utf8")) as {
      version?: string;
    };
    if (typeof parsed.version === "string" && /^\d/u.test(parsed.version)) {
      // Generated apps stay on the same release line as this initializer.
      return `^${parsed.version}`;
    }
  } catch {
    // Fall through to the workspace dev default below.
  }
  return "latest";
};

export const openBrowser = async (url: string): Promise<void> => {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : platform === "darwin" ? [url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
  child.unref();
};

export const main = async (argv: readonly string[]): Promise<number> => {
  const options = parseWizardCli(argv);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(WIZARD_HELP);
    return 0;
  }
  ensureLoopbackNoProxy();

  const cwd = resolve(
    options.targetDir === undefined
      ? process.cwd()
      : resolve(process.cwd(), options.targetDir),
  );
  const dependencyRange = await readDependencyRange();

  const server = await createWizardServer(
    (emit) =>
      createWizardSession({
        cwd,
        skipInstall: options.skipInstall,
        force: options.force,
        ...(options.pm === undefined ? {} : { packageManager: options.pm }),
        dependencyRange,
        emit,
      }),
    options.port === undefined ? {} : { port: options.port },
  );

  console.log(`create-opentray wizard: ${server.url}`);
  console.log(`working directory: ${cwd}`);

  if (options.open) {
    await openBrowser(server.url);
  }

  const shutdown = (): void => {
    void (async () => {
      await server.session.stop();
      await server.close();
      process.exit(0);
    })();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  // Keep the process alive until the wizard is closed or both the server
  // socket and the preview run are gone.
  await new Promise<void>(() => {});
  return 0;
};

const isMainModule = (): boolean => {
  // The bin entry is the module Node loaded as the main script (argv[1]).
  // tsdown bundles this file into the bin chunk, and argv[1] points at the
  // bin.mjs re-export, so also accept that adjacency: when this module is
  // imported through the bin entry rather than the library entry.
  const entryPath = process.argv[1];
  if (entryPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  if (resolve(entryPath) === resolve(modulePath)) return true;
  return resolve(entryPath) === resolve(modulePath.replace(/bin-[^/]*\.mjs$/u, "bin.mjs"));
};

if (isMainModule()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
