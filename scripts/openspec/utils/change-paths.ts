/**
 * Shared change-name / path resolution helpers for OpenSpec workflow controllers.
 *
 * Extracted verbatim from the original `vision-driven.ts`. These enforce the
 * change-id and artifact-id conventions shared by every project-local schema.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export const CHANGE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const ARTIFACT_ID_RE = /^[a-z][a-z0-9-]*$/;

/** Resolve the change directory under `openspec/changes/<change>`. */
export const changeDirOf = (projectRoot: string, change: string): string =>
  join(projectRoot, "openspec", "changes", change);

/** Validate and return a positional change-name argument. */
export const requireChange = (value: string | undefined): string => {
  if (!value || value.startsWith("-")) {
    throw new Error("Missing change name.");
  }
  if (!CHANGE_NAME_RE.test(value)) {
    throw new Error(`Invalid change name: ${value}`);
  }
  return value;
};

/** Validate and return a positional artifact-id argument. */
export const requireArtifact = (value: string | undefined): string => {
  if (!value || value.startsWith("-")) {
    throw new Error("Missing artifact id.");
  }
  if (!ARTIFACT_ID_RE.test(value)) {
    throw new Error(`Invalid artifact id: ${value}`);
  }
  return value;
};

/** Assert that a change directory exists and return its path. */
export const assertChangeExists = (projectRoot: string, change: string): string => {
  const changeDir = changeDirOf(projectRoot, change);
  if (!existsSync(changeDir)) {
    throw new Error(`OpenSpec change not found: ${changeDir}`);
  }
  return changeDir;
};

/** Read a `--flag value` pair from argv, returning undefined when absent. */
export const getArgValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args.at(index + 1);
};
