#!/usr/bin/env bun

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  auth: "env" | "ambient";
  dryRun: boolean;
  check: boolean;
  allowStagePublish: boolean;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface NpmAuth {
  cleanup: () => Promise<void>;
  env: Record<string, string>;
  source: "env-file" | "ambient";
  token?: string;
}

interface NpmRuntime {
  cmd: string[];
  label: string;
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
  auth: "env",
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
    "  --auth <env|ambient>      Use .env NPM_TOKEN or existing npm login. Default: env",
    "  --dry-run                 Print intended configure commands without mutating npm",
    "  --check                   Fail if any package is missing the expected publisher",
    "  --no-stage-publish        Do not request npm stage publish permission",
    "",
    "Environment:",
    "  Reads NPM_TOKEN from .env when present and injects it via a temporary npm userconfig.",
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
      options.packages.push(
        ...next
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      );
      index += 1;
      continue;
    }
    if (arg === "--auth") {
      if (!next) throw new Error("Missing --auth value.");
      if (next !== "env" && next !== "ambient") {
        throw new Error("Invalid --auth value. Expected env or ambient.");
      }
      options.auth = next;
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
    const manifest = parseManifest(
      await readFile(manifestPath, "utf8"),
      manifestPath
    );
    if (!manifest.private) {
      names.push(manifest.name);
    }
  }
  return names.sort((left, right) => left.localeCompare(right));
};

const isMaskedOrAbbreviatedNpmToken = (value: string): boolean =>
  value.includes("*") || value.includes("...") || value.includes("\u2026");

const normalizeToken = (value: string): string => {
  const trimmed = value.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
};

const assertUsableTokenShape = (value: string, source: string): void => {
  if (value.length === 0) {
    throw new Error(`${source} contains an empty NPM_TOKEN.`);
  }
  if (isMaskedOrAbbreviatedNpmToken(value)) {
    throw new Error(
      `${source} contains a masked or abbreviated NPM_TOKEN; trusted publishing needs a full token.`
    );
  }
};

const readEnvToken = async (): Promise<string | undefined> => {
  if (process.env.NPM_TOKEN) {
    const value = normalizeToken(process.env.NPM_TOKEN);
    assertUsableTokenShape(value, "process.env");
    return value;
  }

  let content: string;
  try {
    content = await readFile(".env", "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) continue;
    if (line.slice(0, separatorIndex).trim() !== "NPM_TOKEN") continue;
    const value = normalizeToken(line.slice(separatorIndex + 1));
    assertUsableTokenShape(value, ".env");
    return value;
  }
  return undefined;
};

const npmEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    const normalized = key.toLowerCase();
    if (normalized.startsWith("npm_config_")) continue;
    if (normalized.startsWith("pnpm_config_")) continue;
    env[key] = value;
  }
  return env;
};

const createNpmAuth = async (options: Options): Promise<NpmAuth> => {
  const env = npmEnv();
  if (options.auth === "ambient") {
    return {
      cleanup: async () => {},
      env,
      source: "ambient",
    };
  }

  const token = await readEnvToken();
  if (!token) {
    return {
      cleanup: async () => {},
      env,
      source: "ambient",
    };
  }

  const dir = await mkdtemp(join(tmpdir(), "opentray-npm-"));
  const userconfig = join(dir, ".npmrc");
  await writeFile(
    userconfig,
    `registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${token}\n`,
    {
      mode: 0o600,
    }
  );

  return {
    cleanup: async () => {
      await rm(dir, { force: true, recursive: true });
    },
    env: {
      ...env,
      NODE_AUTH_TOKEN: token,
      NPM_CONFIG_USERCONFIG: userconfig,
      npm_config_userconfig: userconfig,
    },
    source: "env-file",
    token,
  };
};

const redact = (text: string, auth: NpmAuth): string => {
  const withoutToken = auth.token
    ? text.split(auth.token).join("<NPM_TOKEN>")
    : text;
  return withoutToken.replace(
    /npm_[A-Za-z0-9._-]+(?:\u2026)?/gu,
    "npm_<redacted>"
  );
};

const run = async (cmd: string[], auth: NpmAuth): Promise<CommandResult> => {
  const proc = Bun.spawn({
    cmd,
    env: auth.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout: redact(stdout, auth),
    stderr: redact(stderr, auth),
  };
};

const supportsTrustedPublishActions = (help: string): boolean =>
  help.includes("--allow-publish") && help.includes("--allow-stage-publish");

const runNpm = (
  runtime: NpmRuntime,
  args: string[],
  auth: NpmAuth
): Promise<CommandResult> => run([...runtime.cmd, ...args], auth);

const resolveNpmRuntime = async (auth: NpmAuth): Promise<NpmRuntime> => {
  const bundled: NpmRuntime = { cmd: ["npm"], label: "npm" };
  const bundledHelp = await runNpm(
    bundled,
    ["trust", "github", "--help"],
    auth
  );
  if (
    bundledHelp.exitCode === 0 &&
    supportsTrustedPublishActions(bundledHelp.stdout)
  ) {
    return bundled;
  }

  const latest: NpmRuntime = {
    cmd: ["npx", "-y", "npm@latest"],
    label: "npx -y npm@latest",
  };
  const latestHelp = await runNpm(latest, ["trust", "github", "--help"], auth);
  if (
    latestHelp.exitCode === 0 &&
    supportsTrustedPublishActions(latestHelp.stdout)
  ) {
    console.warn(
      "Path npm does not support trusted publisher action flags; using npx -y npm@latest."
    );
    return latest;
  }

  throw new Error(
    [
      "Could not find an npm CLI with trusted publisher action flag support.",
      `npm trust github --help:\n${bundledHelp.stderr || bundledHelp.stdout}`,
      `npx -y npm@latest trust github --help:\n${
        latestHelp.stderr || latestHelp.stdout
      }`,
    ].join("\n\n")
  );
};

const assertSupportedNpm = async (
  runtime: NpmRuntime,
  auth: NpmAuth
): Promise<void> => {
  const result = await runNpm(runtime, ["--version"], auth);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read npm version:\n${result.stderr}`);
  }
  console.log(`npm runtime: ${runtime.label} (${result.stdout.trim()})`);
};

const normalize = (value: string): string =>
  value.toLowerCase().replaceAll("_", "-");

const trustMatches = (raw: string, options: Options): boolean => {
  const text = normalize(raw);
  const required = [
    options.repo,
    options.file,
    options.env,
    "github",
    "publish",
  ].map(normalize);
  const hasRequired = required.every((part) => text.includes(part));
  const hasStage = !options.allowStagePublish || text.includes("stage");
  return hasRequired && hasStage;
};

const trustState = async (
  pkg: string,
  options: Options,
  runtime: NpmRuntime,
  auth: NpmAuth
): Promise<TrustState> => {
  const result = await runNpm(runtime, ["trust", "list", pkg, "--json"], auth);
  if (result.exitCode !== 0) {
    const message = result.stderr || result.stdout;
    if (message.includes("EOTP") || message.includes("one-time password")) {
      return { type: "auth-required", message };
    }
    return { type: "error", message };
  }
  return trustMatches(result.stdout, options)
    ? { type: "trusted" }
    : { type: "missing" };
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

const quote = (part: string): string =>
  part.includes(" ") ? JSON.stringify(part) : part;

const configureFailureMessage = (
  pkg: string,
  result: CommandResult,
  auth: NpmAuth
): string => {
  const message = result.stderr || result.stdout;
  if (auth.source === "env-file" && message.includes("E403")) {
    return [
      `Failed to configure ${pkg}:`,
      message,
      "",
      "The .env NPM_TOKEN was injected into npm, but npm rejected the trusted-publisher mutation.",
      "For npm trust commands, the account must have 2FA enabled and the token must be allowed to manage trusted publishers.",
      "npm trust explicitly rejects Granular Access Tokens created with the bypass-2FA option and legacy basic auth.",
    ].join("\n");
  }
  return `Failed to configure ${pkg}:\n${message}`;
};

const inspectFailureMessage = (
  pkg: string,
  message: string,
  auth: NpmAuth
): string => {
  if (auth.source === "env-file" && message.includes("E403")) {
    return [
      `Failed to inspect ${pkg} trusted publisher state:`,
      message,
      "",
      "The .env NPM_TOKEN authenticated npm but is not allowed to read or write trusted-publisher configuration.",
      "Because this script must skip already configured packages, it stops before mutating any package when state inspection fails.",
      "Use an npm auth context accepted by `npm trust`, such as browser login or a Granular Access Token that is not created with bypass-2FA.",
    ].join("\n");
  }
  return `Failed to inspect ${pkg} trusted publisher state:\n${message}`;
};

const main = async (): Promise<void> => {
  const options = parseArgs(Bun.argv.slice(2));
  const auth = await createNpmAuth(options);
  try {
    console.log(
      `npm auth: ${
        auth.source === "env-file"
          ? "using .env NPM_TOKEN"
          : "using ambient npm login"
      }`
    );
    const runtime = await resolveNpmRuntime(auth);
    await assertSupportedNpm(runtime, auth);
    const discovered = await discoverPackages(process.cwd());
    const packages =
      options.packages.length > 0 ? options.packages : discovered;
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

      const state = await trustState(pkg, options, runtime, auth);
      if (state.type === "trusted") {
        console.log(`skip ${pkg}: trusted publisher already matches`);
        continue;
      }
      if (state.type === "auth-required") {
        throw new Error(
          [
            `npm requires browser/OTP authentication before trusted publisher state can be read for ${pkg}.`,
            "Run `npm login --auth-type=web` or complete the npm CLI auth URL, then retry.",
          ].join("\n")
        );
      }
      if (state.type === "error") {
        throw new Error(inspectFailureMessage(pkg, state.message, auth));
      }
      if (options.check) {
        missing.push(pkg);
        console.log(`missing ${pkg}: ${cmd.map(quote).join(" ")}`);
        continue;
      }
      console.log(`configure ${pkg}: ${cmd.map(quote).join(" ")}`);
      const result = await runNpm(runtime, cmd.slice(1), auth);
      if (result.exitCode !== 0) {
        throw new Error(configureFailureMessage(pkg, result, auth));
      }
    }

    if (missing.length > 0) {
      console.error(
        `Missing trusted publisher configuration for: ${missing.join(", ")}`
      );
      process.exit(1);
    }
  } finally {
    await auth.cleanup();
  }
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
