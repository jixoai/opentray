#!/usr/bin/env bun
import { existsSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { resolveNativeTarget } from "./artifacts";

const lynxArtifactEntries = [
  "opentray",
  "libopentray_ext_lynx.dylib",
  "OpenTrayLynxRuntime.app.zip",
] as const;

export function isCompleteLynxArtifactRoot(root: string): boolean {
  return lynxArtifactEntries.every((entry) => existsSync(join(root, entry)));
}

export function findExistingLynxArtifactRoot(
  artifactDir: string,
  artifactName: string,
): string | undefined {
  const nestedRoot = join(artifactDir, artifactName);
  if (isCompleteLynxArtifactRoot(nestedRoot)) {
    return nestedRoot;
  }
  if (isCompleteLynxArtifactRoot(artifactDir)) {
    return artifactDir;
  }
  return undefined;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      run: {
        type: "string",
      },
      bundle: {
        type: "string",
      },
      features: {
        type: "string",
      },
      profile: {
        type: "string",
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
  const featureExpression = resolveFeatureExpression(
    values.features,
    values.profile,
  );

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
  const logPath =
    values["log-path"] ??
    `/private/tmp/opentray-lynx-${sanitizeFeatureLabel(
      featureExpression,
    )}-${values.run}.log`;

  console.log(`[opentray] lynx smoke features=${featureExpression || "baseline"}`);
  console.log(`[opentray] run=${values.run} artifact=${artifactName}`);
  console.log(`[opentray] bundle=${realpathSync(bundlePath)}`);
  console.log(`[opentray] log=${logPath}`);

  await runAllowFailure(["pnpm", "--filter", "opentray", "cli", "--", "daemon", "stop"], {
    cwd: workspaceRoot,
  });
  await runAllowFailure(["pkill", "-f", "smoke daemon-lynx"]);
  await runAllowFailure(["pkill", "-f", "OpenTrayLynxRuntime"]);
  await runAllowFailure(["pkill", "-f", "LynxExplorer"]);

  rmSync(logPath, { force: true });
  rmSync(`${logPath}.smoke`, { force: true });

  let artifactRoot = findExistingLynxArtifactRoot(artifactDir, artifactName);
  if (artifactRoot === undefined) {
    rmSync(artifactDir, { recursive: true, force: true });
    await run(["gh", "run", "download", values.run, "-n", artifactName, "-D", artifactDir], {
      cwd: workspaceRoot,
    });
    artifactRoot = findExistingLynxArtifactRoot(artifactDir, artifactName);
    if (artifactRoot === undefined) {
      throw new Error(`downloaded artifact layout is unexpected under ${artifactDir}`);
    }
    console.log(`[opentray] downloaded artifact root=${artifactRoot}`);
  } else {
    console.log(`[opentray] reusing cached artifact root=${artifactRoot}`);
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
    OPENTRAY_LYNX_HOST_FEATURES: featureExpression,
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
}

function escapeDoubleQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function resolveFeatureExpression(
  features: string | undefined,
  profile: string | undefined,
): string {
  if (features !== undefined && profile !== undefined) {
    throw new Error("use either --features or deprecated --profile, not both");
  }
  if (features !== undefined) {
    return features;
  }
  if (profile === undefined || profile.length === 0 || profile === "baseline") {
    return "";
  }
  if (profile === "full") {
    return "*";
  }
  throw new Error("--profile must be baseline or full");
}

function sanitizeFeatureLabel(expression: string): string {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return "baseline";
  }
  return trimmed.replaceAll(/[^a-zA-Z0-9!*,_-]+/g, "-");
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

if (import.meta.main) {
  await main();
}
