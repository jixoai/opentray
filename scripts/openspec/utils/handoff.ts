/**
 * Shared handoff + rename mechanics for OpenSpec workflow controllers.
 *
 * Extracted and parameterized from the original `vision-driven.ts`. A handoff
 * is abnormal-exit continuation evidence built from repository facts (not
 * conversation memory). Rename moves an active change and rewrites any
 * controller-owned state that records the old change id.
 */

import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assertChangeExists } from "./change-paths";
import { readInlineDocument, runCapture } from "./run";
import { nextNumberedBackupPath, readOptionalFile, summarizeFile, writeVersionedDocument } from "./versioned-doc";

export interface HandoffPaths {
  /** Goal source file used to seed the "## Goal" section (e.g. plan.md / interview_plan.md). */
  goalPath: (projectRoot: string, change: string) => string;
  /** Optional progress files referenced in "What Worked". */
  progressFiles: Array<{ label: string; path: (projectRoot: string, change: string) => string }>;
  /** Tasks file used to compute unchecked items for "Next Steps". */
  tasksPath: (projectRoot: string, change: string) => string;
  /** Handoff output path inside the change dir. */
  handoffPath: (projectRoot: string, change: string) => string;
}

const nextHandoffBackupPath = (changeDir: string): string =>
  nextNumberedBackupPath(changeDir, "v", ".HANDOFF.md");

/** Write handoff evidence. Inline stdin content takes precedence; otherwise generate from repo. */
export const writeHandoff = async (
  projectRoot: string,
  change: string,
  schemaName: string,
  paths: HandoffPaths,
): Promise<void> => {
  const changeDir = assertChangeExists(projectRoot, change);
  const handoffPath = paths.handoffPath(projectRoot, change);
  const inlineDocument = await readInlineDocument();
  if (inlineDocument !== null) {
    // Here Document input is an operator-supplied source of truth; write it exactly while
    // preserving prior handoff evidence with the same versioning rule as generated handoffs.
    await writeVersionedDocument(handoffPath, inlineDocument, () => nextHandoffBackupPath(changeDir));
    console.log(JSON.stringify({ ok: true, change, handoffPath, source: "stdin" }, null, 2));
    return;
  }

  const metadata = await readOptionalFile(join(changeDir, ".openspec.yaml"));
  const schema = await readOptionalFile(join(projectRoot, "openspec", "schemas", schemaName, "schema.yaml"));
  const goalDoc = await readOptionalFile(paths.goalPath(projectRoot, change));
  const tasks = await readOptionalFile(paths.tasksPath(projectRoot, change));
  const progressEntries = await Promise.all(
    paths.progressFiles.map(async (entry) => ({
      label: entry.label,
      content: await readOptionalFile(entry.path(projectRoot, change)),
    })),
  );
  const status = await runCapture(["openspec", "status", "--change", change, "--schema", schemaName], projectRoot);
  const gitStatus = await runCapture(["git", "status", "--short", "--branch"], projectRoot);
  const latestCommit = await runCapture(["git", "log", "-1", "--oneline"], projectRoot);

  const uncheckedTasks =
    tasks
      ?.split("\n")
      .filter((line) => /^[-*]\s+\[ \]\s+/.test(line))
      .join("\n") || "No unchecked tasks found.";

  // Handoff is generated from repo evidence so a fresh agent can continue after context loss.
  const progressLines = progressEntries.map(
    (entry) => `- ${entry.label} was ${entry.content ? "found" : "not found"}.`,
  );

  const handoff = [
    `# Handoff: ${change}`,
    "",
    "## Goal",
    "",
    summarizeFile(goalDoc, "Goal not found; read the change artifacts before continuing."),
    "",
    "## Current Progress",
    "",
    `- Change: \`${change}\``,
    `- Schema: \`${schemaName}\``,
    `- Latest commit: ${latestCommit.exitCode === 0 ? latestCommit.stdout.trim() : "unknown"}`,
    "- OpenSpec status:",
    "```text",
    status.exitCode === 0 ? status.stdout.trim() : status.stderr.trim(),
    "```",
    "- Git status:",
    "```text",
    gitStatus.exitCode === 0 ? gitStatus.stdout.trim() : gitStatus.stderr.trim(),
    "```",
    "",
    "## What Worked",
    "",
    `- Schema definition was ${schema ? "found" : "not found"} for \`${schemaName}\`.`,
    `- Goal document was ${goalDoc ? "found" : "not found"}.`,
    `- Tasks file was ${tasks ? "found" : "not found"}.`,
    ...progressLines,
    "",
    "## What Didn't Work",
    "",
    "- This handoff was generated because the workflow could not exit normally or needs a fresh-context continuation.",
    "- Rebuild confidence from the evidence above before checking off any further tasks.",
    "",
    "## Next Steps",
    "",
    "```text",
    uncheckedTasks,
    "```",
    "",
  ].join("\n");

  await writeVersionedDocument(handoffPath, handoff, () => nextHandoffBackupPath(changeDir));
  console.log(JSON.stringify({ ok: true, change, handoffPath, source: "generated" }, null, 2));
};

export interface StateFileConfig {
  /** Path to a state file that records the change id (e.g. review/state.json). */
  statePath: (projectRoot: string, change: string) => string;
  /** Patch the parsed state object after a rename. Returns the new object, or null to skip. */
  patchState: (parsed: unknown, newChange: string) => Record<string, unknown> | null;
}

/**
 * Move a change directory from old to new id. Refuse to overwrite an existing
 * target. When a controller-owned state file records the old id, patch it in
 * place so it follows the rename.
 */
export const renameChange = async (
  projectRoot: string,
  oldChange: string,
  newChange: string,
  stateFile?: StateFileConfig,
): Promise<void> => {
  const oldDir = assertChangeExists(projectRoot, oldChange);
  const newDir = join(projectRoot, "openspec", "changes", newChange);
  if (existsSync(newDir)) {
    throw new Error(`Target OpenSpec change already exists: ${newDir}`);
  }

  await rename(oldDir, newDir);
  if (stateFile) {
    const statePath = stateFile.statePath(projectRoot, newChange);
    if (existsSync(statePath)) {
      try {
        const parsed = JSON.parse(await readFile(statePath, "utf-8"));
        const patched = stateFile.patchState(parsed, newChange);
        if (patched) {
          await writeFile(statePath, `${JSON.stringify({ ...patched, updatedAt: new Date().toISOString() }, null, 2)}\n`);
        }
      } catch {
        // State files are best-effort during rename; do not block the move.
      }
    }
  }
  console.log(JSON.stringify({ ok: true, from: oldChange, to: newChange, path: newDir }, null, 2));
};
