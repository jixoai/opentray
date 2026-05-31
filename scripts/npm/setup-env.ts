#!/usr/bin/env bun

import { $, type ShellOutput } from "bun";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

type Permission = "read-only" | "read-write" | "no-access";

interface Options {
  force: boolean;
  name: string;
  description: string;
  expires?: string;
  bypass2fa: boolean;
  packagesAndScopesPermission: Permission;
  orgsPermission: Permission;
  debugSpawn: boolean;
  unsafeDebugSecrets: boolean;
}

interface Credentials {
  password: string;
  otp: string;
}

interface ListedToken {
  displayToken: string;
  id: string;
  name: string;
  revoked: boolean;
}

interface JsonToken {
  displayToken: string;
  name: string;
  revoked: boolean;
}

interface TextToken {
  displayToken: string;
  id: string;
}

const envPath = ".env";
const envKey = "NPM_TOKEN";
const decoder = new TextDecoder();

const usage = (): string =>
  [
    "Usage:",
    "  bun run scripts/npm/setup-env.ts [options]",
    "",
    "Options:",
    "  --force                         Replace an existing NPM_TOKEN in .env",
    "  --name <name>                   Token name. Default: opentray-local",
    "  --description <text>            Token description",
    "  --expires <days>                Token expiration in days",
    "  --bypass-2fa                    Create a token that bypasses 2FA; not accepted by npm trust",
    "  --no-bypass-2fa                 Keep the token trusted-publish compatible. Default",
    "  --packages-permission <level>   read-only | read-write | no-access. Default: read-write",
    "  --orgs-permission <level>       read-only | read-write | no-access. Default: read-write",
    "  --debug-spawn                   Print npm spawn argv, exit code, stdout, and stderr",
    "  --unsafe-debug-secrets          Print raw secrets in debug output; do not paste the output",
  ].join("\n");

const parsePermission = (value: string, option: string): Permission => {
  if (
    value === "read-only" ||
    value === "read-write" ||
    value === "no-access"
  ) {
    return value;
  }
  throw new Error(`Invalid ${option}: ${value}`);
};

const defaultOptions: Options = {
  force: false,
  name: "opentray-local",
  description: "OpenTray local npm token",
  bypass2fa: false,
  packagesAndScopesPermission: "read-write",
  orgsPermission: "read-write",
  debugSpawn: false,
  unsafeDebugSecrets: false,
};

const parseArgs = (args: string[]): Options => {
  const options: Options = { ...defaultOptions };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--force" || arg === "-f") {
      options.force = true;
      continue;
    }
    if (arg === "--name") {
      if (!next) throw new Error("Missing --name value.");
      options.name = next;
      index += 1;
      continue;
    }
    if (arg === "--description") {
      if (!next) throw new Error("Missing --description value.");
      options.description = next;
      index += 1;
      continue;
    }
    if (arg === "--expires") {
      if (!next) throw new Error("Missing --expires value.");
      options.expires = next;
      index += 1;
      continue;
    }
    if (arg === "--bypass-2fa") {
      options.bypass2fa = true;
      continue;
    }
    if (arg === "--no-bypass-2fa") {
      options.bypass2fa = false;
      continue;
    }
    if (arg === "--debug-spawn") {
      options.debugSpawn = true;
      continue;
    }
    if (arg === "--unsafe-debug-secrets") {
      options.unsafeDebugSecrets = true;
      continue;
    }
    if (arg === "--packages-permission") {
      if (!next) throw new Error("Missing --packages-permission value.");
      options.packagesAndScopesPermission = parsePermission(next, arg);
      index += 1;
      continue;
    }
    if (arg === "--orgs-permission") {
      if (!next) throw new Error("Missing --orgs-permission value.");
      options.orgsPermission = parsePermission(next, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n${usage()}`);
  }
  return options;
};

const readEnv = async (): Promise<string> => {
  try {
    return await readFile(envPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
};

const hasEnvKey = (content: string, key: string): boolean => {
  const pattern = new RegExp(`^${key}=`, "m");
  return pattern.test(content);
};

const readEnvValue = (content: string, key: string): string | undefined => {
  const line = content
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
};

const upsertEnvValue = (
  content: string,
  key: string,
  value: string
): string => {
  const line = `${key}=${value}`;
  if (hasEnvKey(content, key)) {
    return content.replace(new RegExp(`^${key}=.*$`, "m"), line);
  }
  const prefix =
    content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
  return `${prefix}${line}\n`;
};

const withHiddenInput = async <T>(operation: () => Promise<T>): Promise<T> => {
  if (!process.stdin.isTTY) {
    throw new Error("A TTY is required to read npm credentials.");
  }
  await $`stty -echo`;
  try {
    return await operation();
  } finally {
    await $`stty echo`.quiet().throws(false);
    process.stderr.write("\n");
  }
};

const promptHidden = async (label: string): Promise<string> =>
  withHiddenInput(async () => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    try {
      const value = await rl.question(label);
      return value.trim();
    } finally {
      rl.close();
    }
  });

const outputText = (output: ShellOutput): string =>
  decoder.decode(output.stdout).trim();

const errorText = (output: ShellOutput): string => {
  const stderr = decoder.decode(output.stderr).trim();
  const stdout = decoder.decode(output.stdout).trim();
  return stderr.length > 0 ? stderr : stdout;
};

const stderrText = (output: ShellOutput): string =>
  decoder.decode(output.stderr).trim();

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

const quoteArg = (arg: string): string =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg);

const redactDebugText = (
  text: string,
  options: Options,
  secrets: string[]
): string => {
  if (options.unsafeDebugSecrets) return text;
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join("<secret>");
  }
  return redacted.replace(/npm_[A-Za-z0-9._-]+(?:\u2026)?/gu, "npm_<redacted>");
};

const runNpm = async (
  args: string[],
  options: Options,
  secrets: string[] = []
): Promise<ShellOutput> => {
  const npm = $.env(npmEnv());
  if (options.debugSpawn) {
    const command = ["npm", ...args]
      .map((arg) => quoteArg(redactDebugText(arg, options, secrets)))
      .join(" ");
    console.error(`[npm spawn] ${command}`);
  }
  const result = await npm`npm ${args}`.quiet().throws(false);
  if (options.debugSpawn) {
    console.error(`[npm exit] ${result.exitCode}`);
    console.error(
      `[npm stdout]\n${redactDebugText(outputText(result), options, secrets)}`
    );
    console.error(
      `[npm stderr]\n${redactDebugText(stderrText(result), options, secrets)}`
    );
  }
  return result;
};

const createTokenArgs = (
  options: Options,
  password: string,
  otp: string
): string[] => [
  "token",
  "create",
  "--name",
  options.name,
  "--token-description",
  options.description,
  "--packages",
  "opentray",
  "--scopes",
  "@opentray",
  "--orgs",
  "opentray",
  "--packages-and-scopes-permission",
  options.packagesAndScopesPermission,
  "--orgs-permission",
  options.orgsPermission,
  ...(options.expires ? ["--expires", options.expires] : []),
  ...(options.bypass2fa ? ["--bypass-2fa"] : []),
  "--password",
  password,
  "--otp",
  otp,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeDisplayToken = (value: string): string =>
  value.trim().replace(/\u2026+$/u, "");

const isMaskedOrAbbreviatedNpmToken = (value: string): boolean =>
  value.includes("*") || value.includes("...") || value.includes("\u2026");

const parseCreatedToken = (raw: string): string => {
  const match = /Created token\s+(npm_\S+)/.exec(raw);
  const token = match?.[1];
  if (token) {
    if (isMaskedOrAbbreviatedNpmToken(token)) {
      throw new Error(
        "npm token create returned a masked token; cannot write a usable NPM_TOKEN to .env."
      );
    }
    return token;
  }
  throw new Error(
    "npm token create did not print a recognizable `Created token npm_...` line."
  );
};

const parseJsonTokenList = (raw: string): JsonToken[] => {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("npm token list did not return a token array.");
  }
  const tokens: JsonToken[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    if (typeof item.name !== "string") continue;
    if (typeof item.token !== "string" || item.token.includes("*")) continue;
    tokens.push({
      displayToken: normalizeDisplayToken(item.token),
      name: item.name,
      revoked: item.revoked === true,
    });
  }
  return tokens;
};

const parseTextTokenList = (raw: string): TextToken[] => {
  const tokens: TextToken[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /^Token\s+(\S+)\s+with id\s+(\S+)\s+created\b/.exec(
      line.trim()
    );
    if (!match) continue;
    const [, displayToken, id] = match;
    if (!displayToken || !id) continue;
    tokens.push({
      displayToken: normalizeDisplayToken(displayToken),
      id,
    });
  }
  return tokens;
};

const listJsonNpmTokens = async (options: Options): Promise<JsonToken[]> => {
  const result = await runNpm(["token", "list", "--json"], options);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list npm tokens as JSON:\n${errorText(result)}`);
  }
  return parseJsonTokenList(outputText(result));
};

const listTextNpmTokens = async (options: Options): Promise<TextToken[]> => {
  const result = await runNpm(["token", "list"], options);
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to list npm tokens with ids:\n${errorText(result)}`
    );
  }
  return parseTextTokenList(outputText(result));
};

const revokeNpmToken = async (
  token: ListedToken,
  credentials: Credentials,
  options: Options
): Promise<void> => {
  const result = await runNpm(
    ["token", "revoke", token.id, "--otp", credentials.otp, "--json"],
    options,
    [credentials.otp]
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to revoke existing npm token named "${token.name}":\n${errorText(
        result
      )}`
    );
  }
};

const findExistingTokens = async (
  name: string,
  options: Options
): Promise<ListedToken[]> => {
  const jsonTokens = await listJsonNpmTokens(options);
  const textTokens = await listTextNpmTokens(options);
  const idByDisplayToken = new Map(
    textTokens.map((token) => [token.displayToken, token.id])
  );
  const matching = jsonTokens.filter(
    (token) => token.name === name && !token.revoked
  );
  const tokens: ListedToken[] = [];
  for (const token of matching) {
    const id = idByDisplayToken.get(token.displayToken);
    if (!id) {
      throw new Error(
        `Found npm token named "${name}" but could not resolve its revoke id from \`npm token list\`.`
      );
    }
    tokens.push({ ...token, id });
  }
  return tokens;
};

const revokeExistingTokens = async (
  existing: ListedToken[],
  credentials: Credentials,
  options: Options
): Promise<void> => {
  if (existing.length === 0) return;

  console.log(
    `Found ${existing.length} existing npm token(s) named "${existing[0]?.name}"; revoking before recreate.`
  );
  for (const token of existing) {
    await revokeNpmToken(token, credentials, options);
  }
};

const readCredentials = async (): Promise<Credentials> => ({
  password: await promptHidden("npm password: "),
  otp: await promptHidden("npm otp: "),
});

const createNpmToken = async (
  options: Options,
  credentials: Credentials
): Promise<string> => {
  const result = await runNpm(
    createTokenArgs(options, credentials.password, credentials.otp),
    options,
    [credentials.password, credentials.otp]
  );
  if (result.exitCode !== 0) {
    const message = errorText(result);
    if (message.includes("Duplicate token names are not allowed")) {
      throw new Error(
        [
          `Failed to create npm token: token name "${options.name}" already exists.`,
          "Automatic revoke did not remove the duplicate name; inspect `npm token list --json`.",
        ].join("\n")
      );
    }
    throw new Error(`Failed to create npm token:\n${message}`);
  }
  return parseCreatedToken(outputText(result));
};

const main = async (): Promise<void> => {
  const options = parseArgs(Bun.argv.slice(2));
  const env = await readEnv();
  if (hasEnvKey(env, envKey) && !options.force) {
    const currentToken = readEnvValue(env, envKey);
    const state =
      currentToken && isMaskedOrAbbreviatedNpmToken(currentToken)
        ? "contains a masked or abbreviated token"
        : `already contains ${envKey}`;
    console.log(`${envPath} ${state}; pass --force to replace it.`);
    return;
  }

  const existing = await findExistingTokens(options.name, options);
  const credentials = await readCredentials();
  await revokeExistingTokens(existing, credentials, options);
  const token = await createNpmToken(options, credentials);
  await writeFile(envPath, upsertEnvValue(env, envKey, token), { mode: 0o600 });
  await $`chmod 600 ${envPath}`.quiet();
  console.log(`Wrote ${envKey} to ${envPath}.`);
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
