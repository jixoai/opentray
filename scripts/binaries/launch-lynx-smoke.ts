#!/usr/bin/env bun
import { existsSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { resolveNativeTarget } from "./artifacts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    run: {
      type: "string",
    },
    bundle: {
      type: "string",
    },
    profile: {
      type: "string",
      default: "baseline",
    },
    root: {
      type: "string",
      default: process.cwd(),
    },
    debug: {
      type: "string",
    },
    "log-path": {
      type: "string",
    },
  },
});

if (values.run === undefined || values.run.length === 0) {
  throw new Error("--run is required");
}
if (values.bundle === undefined || values.bundle.length === 0) {
  throw new Error("--bundle is required");
}
if (!["baseline", "full"].includes(values.profile)) {
  throw new Error("--profile must be baseline or full");
}

const workspaceRoot = resolve(values.root ?? process.cwd());
const bundlePath = resolve(workspaceRoot, values.bundle);
if (!existsSync(bundlePath)) {
  throw new Error(`lynx smoke bundle does not exist: ${bundlePath}`);
}

const target = resolveNativeTarget();
if (target.packageOs !== "darwin" || target.lynxArtifact === undefined || target.lynxRuntimeArtifact === undefined) {
  throw new Error(
    `launch-lynx-smoke currently requires a darwin target with Lynx artifacts; resolved ${target.packageOs}-${target.arch}`,
  );
}

const artifactName = `native-${target.packageOs}-${target.arch}`;
const artifactDir = `/tmp/opentray-ci-${values.run}`;
let artifactRoot = join(artifactDir, artifactName);
const logPath =
  values["log-path"] ??
  `/private/tmp/opentray-lynx-${values.profile}-${values.run}.log`;

console.log(`[opentray] lynx smoke profile=${values.profile}`);
console.log(`[opentray] run=${values.run} artifact=${artifactName}`);
console.log(`[opentray] bundle=${realpathSync(bundlePath)}`);
console.log(`[opentray] log=${logPath}`);

await runAllowFailure(["pnpm", "--filter", "opentray", "cli", "--", "daemon", "stop"], {
  cwd: workspaceRoot,
});
await runAllowFailure(["pkill", "-f", "smoke daemon-lynx"]);
await runAllowFailure(["pkill", "-f", "OpenTrayLynxRuntime"]);
await runAllowFailure(["pkill", "-f", "LynxExplorer"]);

rmSync(artifactDir, { recursive: true, force: true });
rmSync(logPath, { force: true });
rmSync(`${logPath}.smoke`, { force: true });

await run(["gh", "run", "download", values.run, "-n", artifactName, "-D", artifactDir], {
  cwd: workspaceRoot,
});
if (!existsSync(join(artifactRoot, "opentray"))) {
  artifactRoot = artifactDir;
}
if (!existsSync(join(artifactRoot, "opentray"))) {
  throw new Error(`downloaded artifact layout is unexpected under ${artifactDir}`);
}

const baseEnv = {
  ...process.env,
  OPENTRAY_DAEMON_IDLE_TIMEOUT_MS: "0",
} satisfies Record<string, string | undefined>;

await run(
  [
    "bun",
    "run",
    "scripts/binaries/stage-local.ts",
    "--kind",
    "daemon",
    "--source",
    join(artifactRoot, "opentray"),
  ],
  { cwd: workspaceRoot, env: baseEnv },
);
await run(
  [
    "bun",
    "run",
    "scripts/binaries/stage-local.ts",
    "--kind",
    "lynx",
    "--source",
    join(artifactRoot, "libopentray_ext_lynx.dylib"),
  ],
  { cwd: workspaceRoot, env: baseEnv },
);
await run(
  [
    "bun",
    "run",
    "scripts/binaries/stage-local.ts",
    "--kind",
    "lynx-runtime",
    "--source",
    join(artifactRoot, "OpenTrayLynxRuntime.app.zip"),
  ],
  { cwd: workspaceRoot, env: baseEnv },
);

const smokeEnv = {
  ...baseEnv,
  OPENTRAY_LYNX_HOST_PROFILE: values.profile,
} satisfies Record<string, string | undefined>;
if (values.debug !== undefined && values.debug.length > 0) {
  smokeEnv.OPENTRAY_LYNX_RUNTIME_STDIO = "inherit";
  smokeEnv.OPENTRAY_LYNX_DEBUG = values.debug;
  smokeEnv.OPENTRAY_LYNX_DEBUG_LOG_PATH = logPath;
}

const smokeCommand = [
  "bash",
  "-lc",
  `pnpm --filter opentray cli -- smoke daemon-lynx --bundle "${escapeDoubleQuoted(
    realpathSync(bundlePath),
  )}" 2>&1 | tee "${escapeDoubleQuoted(`${logPath}.smoke`)}"`,
];
await run(smokeCommand, { cwd: workspaceRoot, env: smokeEnv });

function escapeDoubleQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function run(
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<void> {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: toSpawnEnv(options.env),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`command failed (${exitCode}): ${cmd.join(" ")}`);
  }
}

async function runAllowFailure(
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<void> {
  try {
    await run(cmd, options);
  } catch {
    // Cleanup commands are best-effort because the smoke launcher should be able
    // to converge local state even when no prior daemon/runtime is running.
  }
}

function toSpawnEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> | undefined {
  if (env === undefined) {
    return undefined;
  }
  const entries = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return Object.fromEntries(entries);
}
