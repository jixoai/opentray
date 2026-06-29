/**
 * Shared versioned-document writer.
 *
 * Extracted from the original `vision-driven.ts`. Before overwriting a
 * user-visible file (plan/handoff), the current file is rotated to the next
 * available numbered backup so prior evidence is never silently lost.
 */

import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Move `targetPath` aside to the next available numbered backup, then write the
 * new content. The caller controls the backup filename via `nextBackupPath`.
 */
export const writeVersionedDocument = async (
  targetPath: string,
  content: string,
  nextBackupPath: () => string,
): Promise<void> => {
  if (existsSync(targetPath)) {
    await rename(targetPath, nextBackupPath());
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
};

/**
 * Return the first available numbered backup path inside `dir`. The filename is
 * `<prefix><index><suffix>`; the caller fully controls the prefix/suffix so
 * callers can produce `plan-v1.md` (`prefix="plan-v"`), `v1.HANDOFF.md`
 * (`prefix="v"`), etc.
 */
export const nextNumberedBackupPath = (
  dir: string,
  prefix: string,
  suffix: string,
): string => {
  for (let index = 1; index < 1000; index += 1) {
    const backupPath = join(dir, `${prefix}${index}${suffix}`);
    if (!existsSync(backupPath)) {
      return backupPath;
    }
  }
  throw new Error("Too many revisions.");
};

/** Read a file's content, or null when it does not exist. */
export const readOptionalFile = async (path: string): Promise<string | null> => {
  if (!existsSync(path)) {
    return null;
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf-8");
};

/** Return the first meaningful (non-table, non-checkbox) line of a document, or a fallback. */
export const summarizeFile = (content: string | null, fallback: string): string => {
  if (!content) {
    return fallback;
  }
  const firstMeaningfulLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("|") && !line.startsWith("- ["));
  return firstMeaningfulLine ?? fallback;
};
