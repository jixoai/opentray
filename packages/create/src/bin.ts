#!/usr/bin/env node
// Orthogonal intents (maintained 2026-08-18; original user requests: the
// original `npx create-opentray` WebUI wizard; the add-create-opentray-cli
// yargs command tree with non-interactive create, app management, and the
// packaged AI skill):
// 1. Dispatch every invocation through the yargs CLI adapter.
// 2. Keep the bare root dispatching to the WebUI adapter for compatibility.
// 3. Tear down the preview process tree on exit signals.

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { dispatchCli, consoleStreams } from "@create-opentray/cli";
import { createWizardServer } from "./server";
import { createWizardSession } from "./wizard";
import { ensureLoopbackNoProxy } from "@create-opentray/core";

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

const runWebAdapter = async (options: {
  readonly port?: number;
  readonly open: boolean;
}): Promise<number> => {
  ensureLoopbackNoProxy();

  // pnpm/npm run scripts execute with the package directory as cwd; INIT_CWD
  // preserves the directory the user actually invoked the command from.
  const invocationDir = process.env.INIT_CWD || process.cwd();
  const dependencyRange = await readDependencyRange();

  const server = await createWizardServer(
    (emit) =>
      createWizardSession({
        cwd: invocationDir,
        skipInstall: false,
        force: false,
        dependencyRange,
        emit,
      }),
    options.port === undefined ? {} : { port: options.port },
  );

  console.log(`create-opentray wizard: ${server.url}`);
  console.log(`working directory: ${invocationDir}`);

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

  // Keep the process alive until the wizard is closed.
  await new Promise<void>(() => {});
  return 0;
};

export const main = async (argv: readonly string[]): Promise<number> => {
  // Legacy wizard flags (bare root) keep working through the same parser.
  const legacy = parseWizardCli(argv.filter((arg) => !arg.startsWith("--") || ["--no-open","--port","--pm","--skip-install","--force","--help","-h"].includes(arg)));
  return dispatchCli(argv, {
    streams: consoleStreams,
    runWeb: async (webOptions) =>
      runWebAdapter({
        ...webOptions,
        ...(webOptions.port === undefined && legacy.port !== undefined ? { port: legacy.port } : {}),
        open: webOptions.open && legacy.open,
      }),
  });
};

const isMainModule = (): boolean => {
  // The bin entry is the module Node loaded as the main script (argv[1]).
  // tsdown bundles this file into the bin chunk, and argv[1] points at the
  // bin.mjs re-export, so also accept that adjacency: when this module is
  // imported through the bin entry rather than the library entry.
  // Path comparisons use realpath: npx/npm invoke the bin through a
  // node_modules/.bin SYMLINK, and resolve() alone keeps the link path —
  // argv[1] would never equal the real module file and main() silently
  // never ran (npx create-opentray exited 0 with no output).
  const entryPath = process.argv[1];
  if (entryPath === undefined) return false;
  const sameFile = (a: string, b: string): boolean => {
    try {
      return realpathSync(resolve(a)) === realpathSync(resolve(b));
    } catch {
      return resolve(a) === resolve(b);
    }
  };
  const modulePath = fileURLToPath(import.meta.url);
  if (sameFile(entryPath, modulePath)) return true;
  return sameFile(entryPath, modulePath.replace(/bin-[^/]*\.mjs$/u, "bin.mjs"));
};

if (isMainModule()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
