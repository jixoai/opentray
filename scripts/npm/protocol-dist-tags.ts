#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";

import {
  formatOpenTrayProtocolLine,
  formatProtocolDistTag,
  OPENTRAY_PROTOCOL_LINE,
  protocolLineReleaseChannels,
  type ProtocolLineReleaseChannel,
} from "../../packages/spec/src/index";

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
}

export interface ProtocolDistTagPlanEntry {
  readonly packageName: string;
  readonly version: string;
  readonly tag: string;
  readonly command: readonly string[];
}

export interface ProtocolDistTagPlan {
  readonly dryRun: boolean;
  readonly channel: ProtocolLineReleaseChannel;
  readonly protocolLine: string;
  readonly tag: string;
  readonly entries: readonly ProtocolDistTagPlanEntry[];
}

export interface ProtocolDistTagOptions {
  readonly root: string;
  readonly channel: ProtocolLineReleaseChannel;
  readonly apply: boolean;
  readonly packages: readonly string[];
}

export const resolveProtocolDistTagPlan = async ({
  root,
  channel,
  apply,
  packages,
}: ProtocolDistTagOptions): Promise<ProtocolDistTagPlan> => {
  // The plan exposes both the protocol line and the install selector so release agents can see the bump.
  const protocolLine = formatOpenTrayProtocolLine(OPENTRAY_PROTOCOL_LINE);
  const tag = formatProtocolDistTag({ channel });
  const packageFilter = new Set(packages);
  const manifests = await listPublicWorkspaceManifests(root);
  const entries = manifests
    .filter((manifest) => packageFilter.size === 0 || packageFilter.has(manifest.name))
    .map((manifest) => ({
      packageName: manifest.name,
      version: manifest.version,
      tag,
      command: ["npm", "dist-tag", "add", `${manifest.name}@${manifest.version}`, tag] as const,
    }));

  for (const packageName of packageFilter) {
    if (!entries.some((entry) => entry.packageName === packageName)) {
      throw new Error(`package is not a public workspace package: ${packageName}`);
    }
  }

  return {
    dryRun: !apply,
    channel,
    protocolLine,
    tag,
    entries,
  };
};

export const applyProtocolDistTagPlan = async (plan: ProtocolDistTagPlan): Promise<void> => {
  if (plan.dryRun) {
    return;
  }

  for (const entry of plan.entries) {
    const proc = Bun.spawn({
      cmd: [...entry.command],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `failed to apply protocol dist-tag for ${entry.packageName}:\n${stderr.trim() || stdout.trim()}`,
      );
    }
  }
};

const listPublicWorkspaceManifests = async (
  root: string,
): Promise<readonly Required<Pick<PackageManifest, "name" | "version">>[]> => {
  const packagesRoot = join(root, "packages");
  const packageDirs = await readdir(packagesRoot, { withFileTypes: true });
  const manifests: Required<Pick<PackageManifest, "name" | "version">>[] = [];

  for (const dirent of packageDirs) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const manifestPath = join(packagesRoot, dirent.name, "package.json");
    const manifest = parsePackageManifest(await readFile(manifestPath, "utf8"), manifestPath);
    if (manifest.private === true) {
      continue;
    }
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(`${manifestPath} is missing package name`);
    }
    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
      throw new Error(`${manifestPath} is missing package version`);
    }
    manifests.push({
      name: manifest.name,
      version: manifest.version,
    });
  }

  return manifests.sort((left, right) => left.name.localeCompare(right.name));
};

const parsePackageManifest = (content: string, path: string): PackageManifest => {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return {
    name: readOptionalStringProperty(parsed, "name"),
    version: readOptionalStringProperty(parsed, "version"),
    private: readOptionalBooleanProperty(parsed, "private"),
  };
};

const parseChannel = (value: string): ProtocolLineReleaseChannel => {
  if (protocolLineReleaseChannels.includes(value as ProtocolLineReleaseChannel)) {
    return value as ProtocolLineReleaseChannel;
  }
  throw new Error(`unsupported protocol dist-tag channel: ${value}`);
};

const readOptionalStringProperty = (record: object, key: string): string | undefined => {
  const value = Reflect.get(record, key);
  return typeof value === "string" ? value : undefined;
};

const readOptionalBooleanProperty = (record: object, key: string): boolean | undefined => {
  const value = Reflect.get(record, key);
  return typeof value === "boolean" ? value : undefined;
};

const parseOptions = (argv: readonly string[]): ProtocolDistTagOptions => {
  const { values } = parseNodeArgs({
    args: [...argv],
    options: {
      root: {
        type: "string",
        default: process.cwd(),
      },
      channel: {
        type: "string",
        default: "stable",
      },
      package: {
        type: "string",
        multiple: true,
        default: [],
      },
      apply: {
        type: "boolean",
        default: false,
      },
    },
  });

  return {
    root: resolve(values.root ?? process.cwd()),
    channel: parseChannel(values.channel ?? "stable"),
    apply: values.apply ?? false,
    packages: values.package ?? [],
  };
};

if (import.meta.main) {
  try {
    const options = parseOptions(Bun.argv.slice(2));
    const plan = await resolveProtocolDistTagPlan(options);
    console.log(JSON.stringify(plan, null, 2));
    await applyProtocolDistTagPlan(plan);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
