#!/usr/bin/env bun
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

import { nativeTargets } from "./artifacts";

export interface RequiredPackageEntry {
  readonly path: string;
  readonly executable: boolean;
}

export interface PackedTarEntry {
  readonly mode: string;
  readonly path: string;
}

const packageEntryExpectations = createPackageEntryExpectations();

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "package-dirs-json": {
        type: "string",
      },
    },
  });

  if (
    values["package-dirs-json"] === undefined ||
    values["package-dirs-json"].trim().length === 0
  ) {
    throw new Error("--package-dirs-json is required");
  }

  const packageDirs = parsePackageDirs(values["package-dirs-json"]);
  for (const packageDir of packageDirs) {
    await validatePackageDir(process.cwd(), packageDir);
  }
}

export async function validatePackageDir(
  workspaceRoot: string,
  packageDir: string
): Promise<void> {
  const requiredEntries = resolveRequiredPackageEntries(packageDir);
  const packDirectory = await mkdtemp(
    join(tmpdir(), "opentray-validate-package-dirs-")
  );
  try {
    const tarballPath = await packPackageDir(workspaceRoot, packageDir, packDirectory);
    const entries = await listPackedTarEntries(tarballPath);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));

    const missing = requiredEntries.filter((entry) => !byPath.has(entry.path));
    if (missing.length > 0) {
      throw new Error(
        [
          `packed ${packageDir} is missing required native artifacts:`,
          ...missing.map((entry) => `- ${entry.path}`),
          "packed entries:",
          ...entries.map((entry) => `- ${entry.path}`),
        ].join("\n")
      );
    }

    const nonExecutable = requiredEntries.filter((entry) => {
      if (!entry.executable) {
        return false;
      }
      const packedEntry = byPath.get(entry.path);
      return packedEntry === undefined || !isExecutableMode(packedEntry.mode);
    });
    if (nonExecutable.length > 0) {
      throw new Error(
        [
          `packed ${packageDir} lost executable permissions:`,
          ...nonExecutable.map((entry) => {
            const packedEntry = byPath.get(entry.path);
            return `- ${entry.path} (${packedEntry?.mode ?? "missing"})`;
          }),
        ].join("\n")
      );
    }
  } finally {
    await rm(packDirectory, { force: true, recursive: true });
  }
}

export function resolveRequiredPackageEntries(
  packageDir: string
): readonly RequiredPackageEntry[] {
  const expected = packageEntryExpectations.get(packageDir);
  if (expected === undefined) {
    throw new Error(`unsupported native package directory: ${packageDir}`);
  }
  return expected;
}

export function parsePackedTarEntries(listing: string): readonly PackedTarEntry[] {
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(/\s+/u);
      const mode = parts[0];
      const path = parts.at(-1);
      if (mode === undefined || path === undefined) {
        throw new Error(`invalid tar listing line: ${line}`);
      }
      return {
        mode,
        path: path.replace(/^package\//u, ""),
      };
    });
}

function parsePackageDirs(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`--package-dirs-json must be valid JSON: ${message}`);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("--package-dirs-json must be a JSON array of strings");
  }
  return parsed;
}

function createPackageEntryExpectations(): ReadonlyMap<string, readonly RequiredPackageEntry[]> {
  const expectations = new Map<string, readonly RequiredPackageEntry[]>();
  for (const target of nativeTargets) {
    expectations.set(target.runtimePackageDir, [
      {
        path: relativeArtifactPath(target.runtimePackageDir, target.runtimeArtifact),
        executable: target.packageOs !== "windows",
      },
    ]);
    if (target.webviewPackageDir !== undefined && target.webviewArtifact !== undefined) {
      expectations.set(target.webviewPackageDir, [
        {
          path: relativeArtifactPath(target.webviewPackageDir, target.webviewArtifact),
          executable: false,
        },
      ]);
    }
    if (target.badgePackageDir !== undefined && target.badgeArtifact !== undefined) {
      expectations.set(target.badgePackageDir, [
        {
          path: relativeArtifactPath(target.badgePackageDir, target.badgeArtifact),
          executable: false,
        },
        ...(target.badgeHelperArtifact === undefined
          ? []
          : [
              {
                path: relativeArtifactPath(
                  target.badgePackageDir,
                  target.badgeHelperArtifact
                ),
                executable: false,
              } satisfies RequiredPackageEntry,
            ]),
      ]);
    }
  }
  return expectations;
}

function relativeArtifactPath(packageDir: string, artifactPath: string): string {
  const prefix = `${packageDir}/`;
  if (!artifactPath.startsWith(prefix)) {
    throw new Error(`artifact ${artifactPath} is not inside package dir ${packageDir}`);
  }
  return artifactPath.slice(prefix.length);
}

async function packPackageDir(
  workspaceRoot: string,
  packageDir: string,
  packDirectory: string
): Promise<string> {
  const output = await runCommand(
    "pnpm",
    ["pack", "--json", "--pack-destination", packDirectory],
    join(workspaceRoot, packageDir)
  );
  const parsed: unknown = JSON.parse(output);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("filename" in parsed) ||
    typeof parsed.filename !== "string"
  ) {
    throw new Error(`invalid pnpm pack output for ${packageDir}: ${output}`);
  }
  return parsed.filename;
}

async function listPackedTarEntries(tarballPath: string): Promise<readonly PackedTarEntry[]> {
  const listing = await runCommand("tar", ["-tvzf", tarballPath], process.cwd());
  return parsePackedTarEntries(listing);
}

function isExecutableMode(mode: string): boolean {
  return mode.slice(1).includes("x");
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code ?? "unknown"}\n${stderr || stdout}`
        )
      );
    });
  });
}
