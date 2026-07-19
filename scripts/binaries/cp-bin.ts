#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  type NativeStageKind,
  resolveNativeTarget,
  resolveStageDestination,
  stageArtifact,
} from "./artifacts";
import { releaseArtifactName } from "./native-build-graph";

type LocalBuildKind = Extract<NativeStageKind, "runtime" | "webview">;
type LocalBuildTarget = "debug" | "release";

const localBuildKinds = ["runtime", "webview"] as const;
const localBuildTargets = ["debug", "release"] as const;
const cargoPackageByKind = {
  runtime: "opentray-bin",
  webview: "opentray-ext-webview",
} as const satisfies Record<LocalBuildKind, string>;
const cliArgs = Bun.argv.slice(2).filter((arg) => arg !== "--");

const { values } = parseArgs({
  args: cliArgs,
  options: {
    kind: {
      type: "string",
      multiple: true,
      default: ["runtime", "webview"],
    },
    root: {
      type: "string",
      default: process.cwd(),
    },
    target: {
      type: "string",
      short: "t",
    },
  },
});

const root = values.root ?? process.cwd();
const kinds = normalizeKinds(values.kind ?? ["runtime", "webview"]);
const buildTarget =
  values.target === undefined ? undefined : normalizeBuildTarget(values.target);
const nativeTarget = resolveNativeTarget();
const cargoPackages = [...new Set(kinds.map((kind) => cargoPackageByKind[kind]))];

if (buildTarget !== undefined) {
  await runCommand(
    "cargo",
    [
      "build",
      ...(buildTarget === "release" ? ["--release"] : []),
      ...cargoPackages.flatMap((pkg) => ["-p", pkg]),
    ],
    root
  );
}

for (const kind of kinds) {
  const { source, target } = await resolveSourceArtifact(kind, buildTarget);
  const destination = resolveStageDestination(nativeTarget, kind);
  await stageArtifact(root, source, destination);
  console.log(`copied ${target} ${kind} artifact: ${source} -> ${destination}`);
  if (kind === "runtime" && nativeTarget.runtimeCarrierArtifact !== undefined) {
    const carrierDestination = join(root, nativeTarget.runtimeCarrierArtifact);
    await runCommand(
      "bash",
      ["scripts/release/build-darwin-runtime-carrier.sh", carrierDestination, source],
      root,
    );
  }
}

function normalizeKinds(values: readonly string[]): LocalBuildKind[] {
  const kinds = values.flatMap((value) =>
    value.split(",").map((part) => part.trim()).filter(Boolean)
  );
  if (kinds.length === 0) {
    throw new Error("--kind must include runtime, webview, or both");
  }
  for (const kind of kinds) {
    if (!isLocalBuildKind(kind)) {
      throw new Error("--kind must be runtime or webview");
    }
  }
  return [...new Set(kinds)];
}

function normalizeBuildTarget(value: string): LocalBuildTarget {
  if (!isLocalBuildTarget(value)) {
    throw new Error("--target must be debug or release");
  }
  return value;
}

function isLocalBuildKind(value: string): value is LocalBuildKind {
  return localBuildKinds.includes(value as LocalBuildKind);
}

function isLocalBuildTarget(value: string): value is LocalBuildTarget {
  return localBuildTargets.includes(value as LocalBuildTarget);
}

async function resolveSourceArtifact(
  kind: LocalBuildKind,
  buildTarget: LocalBuildTarget | undefined
): Promise<{ source: string; target: LocalBuildTarget }> {
  if (buildTarget !== undefined) {
    const source = sourcePath(kind, buildTarget);
    await assertArtifactExists(source, kind, buildTarget);
    return { source, target: buildTarget };
  }

  const candidates = await Promise.all(
    localBuildTargets.map(async (target) => {
      const source = sourcePath(kind, target);
      try {
        const stats = await stat(source);
        return { source, target, mtimeMs: stats.mtimeMs };
      } catch {
        return null;
      }
    })
  );
  const latest = candidates
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];

  if (latest === undefined) {
    const checked = localBuildTargets.map((target) => sourcePath(kind, target));
    throw new Error(
      `missing ${kind} artifact; checked ${checked.join(" and ")}`
    );
  }
  return { source: latest.source, target: latest.target };
}

function sourcePath(kind: LocalBuildKind, target: LocalBuildTarget): string {
  return join(root, "target", target, releaseArtifactName(kind, nativeTarget.packageOs));
}

async function assertArtifactExists(
  path: string,
  kind: LocalBuildKind,
  buildTarget: LocalBuildTarget
): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    throw new Error(`missing ${buildTarget} ${kind} artifact: ${path}`, {
      cause: error,
    });
  }
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`${command} ${args.join(" ")} failed with code ${code}`)
      );
    });
  });
}
