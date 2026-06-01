import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./npm";
import type { AuthContext, AuthMode } from "./types";

export const sanitizedEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    const normalized = key.toLowerCase();
    if (normalized.startsWith("pnpm_config_")) continue;
    if (normalized.startsWith("npm_config_")) continue;
    env[key] = value;
  }
  return env;
};

const normalizeSecret = (value: string): string => {
  const trimmed = value.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
};

const readDotEnv = async (): Promise<Record<string, string>> => {
  let content = "";
  try {
    content = await readFile(".env", "utf8");
  } catch {
    return {};
  }
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    env[line.slice(0, separator)] = normalizeSecret(line.slice(separator + 1));
  }
  return env;
};

const base32Decode = (value: string): Uint8Array => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.replace(/\s/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid NPM_2FA_SECRET.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
};

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

export const generateTotp = async (secret: string): Promise<string> => {
  const secondsRemaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsRemaining < 10) await sleep((secondsRemaining + 1) * 1000);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = signature[signature.length - 1] & 0x0f;
  const code =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
};

const createTokenAuth = async (): Promise<AuthContext> => {
  const dotEnv = await readDotEnv();
  const token = dotEnv.NPM_TOKEN ?? process.env.NPM_TOKEN;
  if (!token) throw new Error("NPM_TOKEN is required for token auth.");
  if (token.includes("*") || token.includes("...") || token.includes("\u2026")) {
    throw new Error("NPM_TOKEN appears masked or abbreviated.");
  }
  const dir = await mkdtemp(join(tmpdir(), "opentray-bootstrap-token-"));
  const userconfig = join(dir, ".npmrc");
  await writeFile(userconfig, `registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${token}\n`, {
    mode: 0o600,
  });
  return {
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
    env: {
      ...sanitizedEnv(),
      NODE_AUTH_TOKEN: token,
      NPM_CONFIG_USERCONFIG: userconfig,
      npm_config_userconfig: userconfig,
    },
    secrets: [token],
  };
};

const createAmbientAuth = async (): Promise<AuthContext> => ({
  cleanup: async () => {},
  env: sanitizedEnv(),
  secrets: [],
});

const createLegacyEnvAuth = async (): Promise<AuthContext> => {
  const dotEnv = await readDotEnv();
  const username = dotEnv.NPM_WHOAMI;
  const password = dotEnv.NPM_PASSWORD;
  const secret = dotEnv.NPM_2FA_SECRET;
  const email = dotEnv.NPM_EMAIL ?? "gaubeebangeel@gmail.com";
  if (!username || !password || !secret) {
    throw new Error("NPM_WHOAMI, NPM_PASSWORD, and NPM_2FA_SECRET are required for legacy-env auth.");
  }

  const dir = await mkdtemp(join(tmpdir(), "opentray-bootstrap-login-"));
  const userconfig = join(dir, ".npmrc");
  const expectScript = join(dir, "login.exp");
  await writeFile(userconfig, "registry=https://registry.npmjs.org/\n", { mode: 0o600 });
  await writeFile(expectScript, loginExpectScript, { mode: 0o700 });
  await chmod(expectScript, 0o700);
  const otp = await generateTotp(secret);
  const env = {
    ...sanitizedEnv(),
    NPM_CONFIG_USERCONFIG: userconfig,
    npm_config_userconfig: userconfig,
    NPM_WHOAMI: username,
    NPM_PASSWORD: password,
    NPM_EMAIL: email,
    NPM_LOGIN_OTP: otp,
  };
  const secrets = [username, password, email, otp];
  const login = await run(["expect", expectScript], env, secrets);
  if (login.exitCode !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`npm legacy login failed:\n${login.stderr || login.stdout}`);
  }
  return {
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
    env,
    secrets: [username, password, email, secret],
  };
};

const loginExpectScript = String.raw`log_user 0
set timeout 60
spawn npm login --auth-type legacy --registry https://registry.npmjs.org/
expect {
  -re "Username:" { send "$env(NPM_WHOAMI)\r"; exp_continue }
  -re "Password:" { send "$env(NPM_PASSWORD)\r"; exp_continue }
  -re "Email.*:" { send "$env(NPM_EMAIL)\r"; exp_continue }
  -re "(?i)(one-time password|otp|2fa)" { send "$env(NPM_LOGIN_OTP)\r"; exp_continue }
  eof { catch wait result; exit [lindex $result 3] }
  timeout { exit 124 }
}
`;

export const authFor = async (mode: AuthMode): Promise<AuthContext> => {
  if (mode === "token") return await createTokenAuth();
  if (mode === "legacy-env") return await createLegacyEnvAuth();
  return await createAmbientAuth();
};

export const authWithOtp = async (auth: AuthContext): Promise<AuthContext> => {
  const dotEnv = await readDotEnv();
  const secret = dotEnv.NPM_2FA_SECRET;
  if (!secret) return auth;
  const otp = await generateTotp(secret);
  return {
    cleanup: auth.cleanup,
    env: { ...auth.env, NPM_CONFIG_OTP: otp, npm_config_otp: otp },
    secrets: [...auth.secrets, otp],
  };
};
