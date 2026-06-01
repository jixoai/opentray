import { redact } from "./redact";
import type { AuthContext, CommandResult, NpmRuntime, Options, RegistryState, TrustState } from "./types";

export const run = async (
  cmd: string[],
  env: Record<string, string>,
  secrets: string[],
  cwd?: string,
): Promise<CommandResult> => {
  const proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout: redact(stdout.trim(), secrets),
    stderr: redact(stderr.trim(), secrets),
  };
};

export const classifyRegistryResult = (result: CommandResult): RegistryState => {
  if (result.exitCode === 0) {
    const version = result.stdout.trim().replace(/^"|"$/g, "");
    return { type: "exists", version };
  }
  const message = result.stderr || result.stdout;
  if (message.includes("E404") || message.includes("Not Found")) return { type: "missing" };
  return { type: "error", message };
};

export const registryState = async (
  packageName: string,
  env: Record<string, string>,
  secrets: string[],
): Promise<RegistryState> => classifyRegistryResult(await run(["npm", "view", packageName, "version", "--json"], env, secrets));

const supportsTrustedPublishActions = (help: string): boolean =>
  help.includes("--allow-publish") && help.includes("--allow-stage-publish");

export const resolveNpmRuntime = async (auth: AuthContext): Promise<NpmRuntime> => {
  const local: NpmRuntime = { cmd: ["npm"], label: "npm" };
  const localHelp = await run([...local.cmd, "trust", "github", "--help"], auth.env, auth.secrets);
  if (localHelp.exitCode === 0 && supportsTrustedPublishActions(localHelp.stdout)) return local;
  const latest: NpmRuntime = { cmd: ["npx", "-y", "npm@latest"], label: "npx -y npm@latest" };
  const latestHelp = await run([...latest.cmd, "trust", "github", "--help"], auth.env, auth.secrets);
  if (latestHelp.exitCode === 0 && supportsTrustedPublishActions(latestHelp.stdout)) return latest;
  throw new Error("Could not find npm with trusted publish action flags.");
};

export const trustMatches = (raw: string, options: Pick<Options, "repo" | "file" | "environment">): boolean => {
  if (!raw.trim()) return false;
  const normalized = raw.toLowerCase().replaceAll("_", "-");
  return [options.repo, options.file, options.environment, "github", "createpackage", "createstagedpackage"].every((part) =>
    normalized.includes(part.toLowerCase().replaceAll("_", "-")),
  );
};

export const trustState = async (options: Options, runtime: NpmRuntime, auth: AuthContext): Promise<TrustState> => {
  const result = await run([...runtime.cmd, "trust", "list", options.packageName, "--json"], auth.env, auth.secrets);
  if (result.exitCode !== 0) {
    const message = result.stderr || result.stdout;
    if (message.includes("EOTP") || message.includes("one-time password")) return { type: "auth-required", message };
    return { type: "error", message };
  }
  if (!result.stdout.trim()) return { type: "missing" };
  if (trustMatches(result.stdout, options)) return { type: "trusted" };
  return { type: "mismatch", message: result.stdout };
};

export const configureTrust = async (options: Options, runtime: NpmRuntime, auth: AuthContext): Promise<void> => {
  const result = await run(
    [
      ...runtime.cmd,
      "trust",
      "github",
      options.packageName,
      "--repo",
      options.repo,
      "--file",
      options.file,
      "--env",
      options.environment,
      "--allow-publish",
      "--allow-stage-publish",
      "--yes",
    ],
    auth.env,
    auth.secrets,
  );
  if (result.exitCode !== 0) throw new Error(`npm trust github failed:\n${result.stderr || result.stdout}`);
};
