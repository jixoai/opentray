/**
 * Shared Git-evidence helper for phase transitions.
 *
 * Extracted from the original `vision-driven.ts` `checkCommitEvidence`. It
 * inspects the working tree and reports which dirty paths belong to the
 * current change vs. unrelated work, plus a suggested commit message. It never
 * commits on its own — the user intent is evidence retention, not automation.
 */

import { runCapture } from "./run";
import { assertChangeExists, getArgValue } from "./change-paths";

export interface CommitCheckConfig {
  /** Valid `--phase` values for this schema. */
  phases: string[];
  /** Map a phase to a suggested conventional commit message body. */
  commitMessageFor: (change: string, phase: string) => string;
}

const requirePhase = (value: string | undefined, phases: string[]): string => {
  if (value && phases.includes(value)) {
    return value;
  }
  throw new Error(`Invalid or missing --phase value: ${value ?? ""}. Valid: ${phases.join(", ")}`);
};

/** Report dirty paths grouped by change vs. other, plus a suggested commit message. */
export const checkCommitEvidence = async (
  projectRoot: string,
  change: string,
  args: string[],
  config: CommitCheckConfig,
): Promise<void> => {
  assertChangeExists(projectRoot, change);
  const phase = requirePhase(getArgValue(args, "--phase"), config.phases);
  const status = await runCapture(["git", "status", "--short", "--untracked-files=all"], projectRoot);
  const head = await runCapture(["git", "log", "-1", "--oneline"], projectRoot);
  const changePrefix = `openspec/changes/${change}/`;
  const statusLines = status.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const changePaths = statusLines.filter((line) => line.includes(changePrefix));
  const otherPaths = statusLines.filter((line) => !line.includes(changePrefix));
  const suggestedMessage = config.commitMessageFor(change, phase);

  console.log(
    JSON.stringify(
      {
        ok: true,
        change,
        phase,
        latestCommit: head.exitCode === 0 ? head.stdout.trim() : null,
        changePaths,
        otherPaths,
        suggestedCommands: [
          `git add openspec/changes/${change}`,
          `git commit -m "${suggestedMessage}"`,
        ],
      },
      null,
      2,
    ),
  );
};
