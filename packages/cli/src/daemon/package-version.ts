import { readFile } from "node:fs/promises";

export const readPackageVersion = async (packageJsonUrl: URL): Promise<string> => {
  const value: unknown = JSON.parse(await readFile(packageJsonUrl, "utf8"));
  if (!isPackageJsonWithVersion(value)) {
    throw new Error(`package.json is missing a string version: ${packageJsonUrl.href}`);
  }

  return value.version;
};

const isPackageJsonWithVersion = (value: unknown): value is { version: string } =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "version" in value &&
  typeof value.version === "string";
