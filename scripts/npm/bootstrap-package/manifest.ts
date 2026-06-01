import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { PackageJson, PackageKind } from "./types";

export const createPackageManifest = (packageName: string, version: string, kind: PackageKind): PackageJson => {
  const files =
    kind === "platform"
      ? ["bin", "README.md"]
      : kind === "extension-platform"
        ? ["dist", "platforms", "README.md"]
        : ["README.md"];
  const manifest: PackageJson = {
    name: packageName,
    version,
    description: `${packageName} package bootstrap placeholder.`,
    type: "module",
    license: "MIT",
    repository: { type: "git", url: "https://github.com/jixoai/opentray" },
    publishConfig: { access: "public" },
    files,
  };
  if (kind === "extension-platform") {
    manifest.peerDependencies = { opentray: ">=0.0.0" };
  }
  return manifest;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parsePackageJson = (content: string): PackageJson => {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) throw new Error("Invalid package.json.");
  return parsed as PackageJson;
};

export const readManifest = async (dir: string): Promise<PackageJson> =>
  parsePackageJson(await readFile(join(dir, "package.json"), "utf8"));

export const validateManifest = (manifest: PackageJson, packageName: string): void => {
  if (manifest.name !== packageName) throw new Error(`package.json name must be ${packageName}.`);
  if (manifest.private) throw new Error("package.json must not be private.");
  if (!manifest.version) throw new Error("package.json version is required.");
  const repository = manifest.repository;
  const url = typeof repository === "string" ? repository : repository?.url;
  if (url !== "https://github.com/jixoai/opentray") {
    throw new Error('package.json repository.url must be "https://github.com/jixoai/opentray".');
  }
};
