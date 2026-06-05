import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const CHANGESET_DIR = ".changeset";

export const extractChangesetReleasePackages = (content: string): string[] => {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/u);
  if (frontmatterMatch === null) {
    return [];
  }
  const packages = new Set<string>();
  const regex = /^\s*"?([^"\n:]+)"?\s*:\s*(major|minor|patch)\s*$/gmu;
  for (const match of frontmatterMatch[1].matchAll(regex)) {
    packages.add(match[1].trim());
  }
  return [...packages];
};

export const listPendingChangesetFiles = async (root: string): Promise<string[]> => {
  const directory = join(root, CHANGESET_DIR);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .sort()
    .map((entry) => `${CHANGESET_DIR}/${entry}`);
};

export const readOptionalWorkspaceFile = async (
  root: string,
  relativePath: string,
): Promise<string | undefined> => {
  try {
    return await readFile(join(root, relativePath), "utf8");
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
};

const isErrnoException = (value: unknown, code: string): value is NodeJS.ErrnoException =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  value.code === code;
