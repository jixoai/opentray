import { join } from "node:path";

import type { AuthMode, Options, PackageKind } from "./types";

const defaultOptions: Omit<Options, "packageName" | "dir"> = {
  kind: "plain",
  initialVersion: "0.0.0",
  createWorkspace: false,
  publishIfMissing: false,
  configureTrust: false,
  publishAuth: "token",
  trustAuth: "legacy-env",
  dryRun: true,
  yes: false,
  replaceTrust: false,
  repo: "jixoai/opentray",
  file: "release.yml",
  environment: "npm-release",
  registry: "https://registry.npmjs.org/",
  visibilityTimeoutMs: 120_000,
  visibilityIntervalMs: 5_000,
};

const usage = (): string =>
  [
    "Usage:",
    "  bun run scripts/npm/bootstrap-package.ts --package <name> [options]",
    "",
    "Options:",
    "  --package <name>                  Required npm package name",
    "  --dir <path>                      Package directory. Default: packages/<name>",
    "  --kind <plain|platform|extension-platform>",
    "  --initial-version <version>       Default: 0.0.0",
    "  --create-workspace                Create minimal package files when missing",
    "  --publish-if-missing              Publish initial version when npm package is missing",
    "  --configure-trust                 Configure npm trusted publishing after package exists",
    "  --publish-auth <token|ambient|legacy-env>",
    "  --trust-auth <ambient|legacy-env>",
    "  --dry-run                         Do not mutate npm or files. Default",
    "  --yes                             Allow live file/npm mutations",
    "  --replace-trust                   Reserved: allow trust replacement in a future change",
    "  --repo <owner/repo>               Default: jixoai/opentray",
    "  --file <workflow.yml>             Default: release.yml",
    "  --env <name>                      Default: npm-release",
    "",
    "Live mutations require --yes. The script never prints npm tokens, passwords, or OTP values.",
  ].join("\n");

export const defaultPackageDir = (packageName: string): string => {
  const unscoped = packageName.startsWith("@") ? packageName.split("/").at(1) : packageName;
  if (!unscoped) throw new Error(`Invalid package name: ${packageName}`);
  return join("packages", unscoped);
};

const requireValue = (arg: string, next: string | undefined): string => {
  if (!next) throw new Error(`Missing ${arg} value.`);
  return next;
};

const parseKind = (value: string): PackageKind => {
  if (value === "plain" || value === "platform" || value === "extension-platform") return value;
  throw new Error(`Invalid --kind value: ${value}`);
};

const parseAuthMode = (value: string): AuthMode => {
  if (value === "token" || value === "ambient" || value === "legacy-env") return value;
  throw new Error(`Invalid auth mode: ${value}`);
};

export const parseArgs = (args: string[]): Options => {
  let packageName: string | undefined;
  let dir: string | undefined;
  const options = { ...defaultOptions };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--package") {
      packageName = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--dir") {
      dir = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--kind") {
      options.kind = parseKind(requireValue(arg, next));
      index += 1;
      continue;
    }
    if (arg === "--initial-version") {
      options.initialVersion = requireValue(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--create-workspace") options.createWorkspace = true;
    else if (arg === "--publish-if-missing") options.publishIfMissing = true;
    else if (arg === "--configure-trust") options.configureTrust = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--yes") {
      options.yes = true;
      options.dryRun = false;
    } else if (arg === "--replace-trust") options.replaceTrust = true;
    else if (arg === "--publish-auth") {
      options.publishAuth = parseAuthMode(requireValue(arg, next));
      index += 1;
    } else if (arg === "--trust-auth") {
      const mode = parseAuthMode(requireValue(arg, next));
      if (mode === "token") throw new Error("--trust-auth does not support token.");
      options.trustAuth = mode;
      index += 1;
    } else if (arg === "--repo") {
      options.repo = requireValue(arg, next);
      index += 1;
    } else if (arg === "--file" || arg === "--workflow") {
      options.file = requireValue(arg, next);
      index += 1;
    } else if (arg === "--env") {
      options.environment = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}\n${usage()}`);
    }
  }

  if (!packageName) throw new Error(`Missing --package value.\n${usage()}`);
  return { ...options, packageName, dir: dir ?? defaultPackageDir(packageName) };
};
