#!/usr/bin/env bun

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface PackageManifest {
  name: string;
  private?: boolean;
}

interface Options {
  repo: string;
  file: string;
  env: string;
  packages: string[];
  dryRun: boolean;
  check: boolean;
  allowStagePublish: boolean;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type TrustState =
  | { type: "trusted" }
  | { type: "missing" }
  | { type: "auth-required"; message: string }
  | { type: "error"; message: string };

const defaultOptions: Options = {
  repo: "jixoai/opentray",
  file: "release.yml",
  env: "npm-release",
  packages: [],
  dryRun: false,
  check: false,
  allowStagePublish: true,
};

const usage = (): string =>
  [
    "Usage:",
    "  bun run scripts/npm/configure-trusted-publish.ts [options]",
    "",
    "Options:",
    "  --repo <owner/repo>        GitHub repository. Default: jixoai/opentray",
    "  --file <workflow.yml>      GitHub workflow filename. Default: release.yml",
    "  --workflow <workflow.yml>  Alias for --file",
    "  --env <name>              GitHub Actions environment. Default: npm-release",
    "  --package <name>          Limit to one package; repeatable",
    "  --packages <a,b>          Limit to a comma-separated package list",
    "  --dry-run                 Print intended configure commands without mutating npm",
    "  --check                   Fail if any package is missing the expected publisher",
    "  --no-stage-publish        Do not request npm stage publish permission",
  ].join("\n");

const parseArgs = (args: string[]): Options => {
  const options: Options = { ...defaultOptions, packages: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--repo") {
      if (!next) throw new Error("Missing --repo value.");
      options.repo = next;
      index += 1;
      continue;
    }
    if (arg === "--file" || arg === "--workflow") {
      if (!next) throw new Error(`Missing ${arg} value.`);
      options.file = next;
      index += 1;
      continue;
    }
    if (arg === "--env") {
      if (!next) throw new Error("Missing --env value.");
      options.env = next;
      index += 1;
      continue;
    }
    if (arg === "--package") {
      if (!next) throw new Error("Missing --package value.");
      options.packages.push(next);
      index += 1;
      continue;
    }
    if (arg === "--packages") {
      if (!next) throw new Error("Missing --packages value.");
      options.packages.push(...next.split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--no-stage-publish") {
      options.allowStagePublish = false;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n${usage()}`);
  }
  return options;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseManifest = (content: string, path: string): PackageManifest => {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed) || typeof parsed.name !== "string") {
    throw new Error(`Invalid package manifest: ${path}`);
  }
  return {
    name: parsed.name,
    private: typeof parsed.private === "boolean" ? parsed.private : undefined,
  };
};

const discoverPackages = async (projectRoot: string): Promise<string[]> => {
  const packagesRoot = join(projectRoot, "packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesRoot, entry.name, "package.json");
    const manifest = parseManifest(await readFile(manifestPath, "utf8"), manifestPath);
    if (!manifest.private) {
      names.push(manifest.name);
    }
  }
  return names.sort((left, right) => left.localeCompare(right));
};

const run = async (cmd: string[]): Promise<CommandResult> => {
  const proc = Bun.spawn({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

const assertSupportedNpm = async (): Promise<void> => {
  const result = await run(["npm", "--version"]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read npm version:\n${result.stderr}`);
  }
  const [major = 0, minor = 0] = result.stdout.trim().split(".").map((part) => Number.parseInt(part, 10));
  if (major < 11 || (major === 11 && minor < 10)) {
    throw new Error(`npm >= 11.10.0 is required for npm trust; found ${result.stdout.trim()}`);
  }
};

const normalize = (value: string): string => value.toLowerCase().replaceAll("_", "-");

const trustMatches = (raw: string, options: Options): boolean => {
  const text = normalize(raw);
  const required = [options.repo, options.file, options.env, "github", "publish"].map(normalize);
  const hasRequired = required.every((part) => text.includes(part));
  const hasStage = !options.allowStagePublish || text.includes("stage");
  return hasRequired && hasStage;
};

const trustState = async (pkg: string, options: Options): Promise<TrustState> => {
  const result = await run(["npm", "trust", "list", pkg, "--json"]);
  if (result.exitCode !== 0) {
    const message = result.stderr || result.stdout;
    if (message.includes("EOTP") || message.includes("one-time password")) {
      return { type: "auth-required", message };
    }
    return { type: "error", message };
  }
  return trustMatches(result.stdout, options) ? { type: "trusted" } : { type: "missing" };
};

const trustCommand = (pkg: string, options: Options): string[] => [
  "npm",
  "trust",
  "github",
  pkg,
  "--repo",
  options.repo,
  "--file",
  options.file,
  "--env",
  options.env,
  "--allow-publish",
  ...(options.allowStagePublish ? ["--allow-stage-publish"] : []),
  "--yes",
];

const quote = (part: string): string => (part.includes(" ") ? JSON.stringify(part) : part);

const main = async (): Promise<void> => {
  const options = parseArgs(Bun.argv.slice(2));
  await assertSupportedNpm();
  const discovered = await discoverPackages(process.cwd());
  const packages = options.packages.length > 0 ? options.packages : discovered;
  const known = new Set(discovered);
  for (const pkg of packages) {
    if (!known.has(pkg)) {
      throw new Error(`Package is not a public workspace package: ${pkg}`);
    }
  }

  const missing: string[] = [];
  for (const pkg of packages) {
    const cmd = trustCommand(pkg, options);
    if (options.dryRun) {
      console.log(`dry-run ${pkg}: ${cmd.map(quote).join(" ")}`);
      continue;
    }

    const state = await trustState(pkg, options);
    if (state.type === "trusted") {
      console.log(`skip ${pkg}: trusted publisher already matches`);
      continue;
    }
    if (state.type === "auth-required") {
      throw new Error(
        [
          `npm requires browser/OTP authentication before trusted publisher state can be read for ${pkg}.`,
          "Run `npm login --auth-type=web` or complete the npm CLI auth URL, then retry.",
        ].join("\n"),
      );
    }
    if (state.type === "error" && options.check) {
      throw new Error(`Failed to inspect ${pkg} trusted publisher state:\n${state.message}`);
    }
    if (options.check) {
      missing.push(pkg);
      console.log(`missing ${pkg}: ${cmd.map(quote).join(" ")}`);
      continue;
    }
    console.log(`configure ${pkg}: ${cmd.map(quote).join(" ")}`);
    const result = await run(cmd);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to configure ${pkg}:\n${result.stderr || result.stdout}`);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing trusted publisher configuration for: ${missing.join(", ")}`);
    process.exit(1);
  }
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
