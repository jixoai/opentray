// Packaged AI-skill access (openspec change add-create-opentray-cli).
//
// `create-opentray skill` reads the canonical English AI-facing tree from
// one stable packaged root. Access is read-only and contained: absolute
// paths, traversal, NUL bytes, and link escapes are rejected before any
// filesystem read. Skill output never depends on host locale.

import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { err, ok, type Result } from "@create-opentray/core";

/** Validate one logical skill path (slash-separated, contained, no NUL). */
export const validateSkillPath = (
  path: string,
): Result<string> => {
  if (path.includes("\0")) {
    return err("path_escape", "skill path contains NUL bytes");
  }
  if (path.length === 0) {
    return err("path_escape", "skill path must not be empty");
  }
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/u.test(path)) {
    return err("path_escape", `skill paths are relative, got absolute: ${path}`);
  }
  const segments = path.split(/[\\/]/u);
  if (segments.some((segment) => segment === ".." || segment === "")) {
    return err("path_escape", `skill path must not traverse upward or repeat separators: ${path}`);
  }
  return ok(segments.join("/"));
};

export interface SkillRoot {
  readonly root: string;
}

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Resolve the packaged skill root. Priority:
 * 1. `<moduleDir>/skill` — bundled beside this module (packed layout).
 * 2. `<moduleDir>/../skill` — the create package's dist/ staging.
 * 3. Source checkout: `packages/create/skill` (repo layout).
 */
export const resolveSkillRoot = async (): Promise<Result<SkillRoot>> => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "skill"),
    join(moduleDir, "..", "skill"),
    join(moduleDir, "..", "..", "..", "skill"),
  ];
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      return ok({ root: resolve(candidate) });
    }
  }
  return err("not_found", "packaged skill directory not found (expected beside the create-opentray module)");
};

/** Contained read: resolve inside the root, rejecting symlink escapes. */
const resolveContained = async (root: string, logical: string): Promise<Result<string>> => {
  const absolute = resolve(root, logical);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!absolute.startsWith(rootWithSep)) {
    return err("path_escape", `path escapes the packaged skill root: ${logical}`);
  }
  // Symlink-escape check: every component must stay inside the root.
  const relative = absolute.slice(rootWithSep.length);
  const segments = relative.split(sep);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (info === null) {
      return err("not_found", `skill file not found: ${logical}`);
    }
    if (info.isSymbolicLink()) {
      const real = await import("node:fs/promises").then((fs) => fs.realpath(current));
      if (!real.startsWith(rootWithSep)) {
        return err("path_escape", `skill entry escapes the packaged root: ${logical}`);
      }
    }
  }
  return ok(absolute);
};

export interface SkillListEntry {
  readonly path: string;
  readonly type: "file" | "directory";
}

const walk = async (root: string, prefix: string, out: SkillListEntry[]): Promise<void> => {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const logical = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push({ path: logical, type: "directory" });
      await walk(root, logical, out);
    } else if (entry.isFile()) {
      out.push({ path: logical, type: "file" });
    }
  }
};

/** List logical relative entries beneath a skill directory. */
export const listSkillFiles = async (
  root: SkillRoot,
  path = "",
): Promise<Result<readonly SkillListEntry[]>> => {
  if (path !== "") {
    const validated = validateSkillPath(path);
    if (!validated.ok) {
      return validated;
    }
    const target = await resolveContained(root.root, validated.value);
    if (!target.ok) {
      return target;
    }
    const info = await lstat(target.value);
    if (!info.isDirectory()) {
      return err("not_found", `skill path is a file, not a directory: ${path}`);
    }
    const out: SkillListEntry[] = [];
    await walk(root.root, validated.value, out);
    return ok(out);
  }
  const out: SkillListEntry[] = [];
  await walk(root.root, "", out);
  return ok(out);
};

/** Read one contained skill file's exact UTF-8 content. */
export const readSkillFile = async (
  root: SkillRoot,
  path: string,
): Promise<Result<string>> => {
  const validated = validateSkillPath(path);
  if (!validated.ok) {
    return validated;
  }
  const target = await resolveContained(root.root, validated.value);
  if (!target.ok) {
    return target;
  }
  const info = await lstat(target.value);
  if (info.isDirectory()) {
    return err("not_found", `skill path is a directory: ${path}`);
  }
  try {
    return ok(await readFile(target.value, "utf8"));
  } catch (error) {
    return err("not_found", `cannot read skill file ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
