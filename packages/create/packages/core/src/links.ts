// Platform-truthful directory links (openspec change unify-create-opentray-core).
//
// External payloads keep the registration directory PHYSICAL; only `app/`
// becomes a directory link. POSIX uses a directory symlink; Windows uses a
// junction (no privilege required) or a directory symlink, and reports a
// typed unsupported error when neither can be created — never a silent copy.

import { lstat, mkdir, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { err, ok, type Result } from "./errors";

export interface LinkCapabilities {
  readonly platform: NodeJS.Platform;
  /** Windows junction creation through `fs.symlink(target, path, "junction")`. */
  readonly junction: boolean;
}

export const linkCapabilities = (platform: NodeJS.Platform = process.platform): LinkCapabilities => ({
  platform,
  junction: platform === "win32",
});

/**
 * Create a directory link at `linkPath` pointing at `target`.
 * - POSIX: relative-or-absolute symlink (caller supplies the raw target string).
 * - Windows: junction first, then directory symlink; typed failure otherwise.
 */
export const createDirectoryLink = async (
  linkPath: string,
  target: string,
  options: { readonly platform?: NodeJS.Platform } = {},
): Promise<Result<{ readonly linkPath: string; readonly target: string }>> => {
  const platform = options.platform ?? process.platform;
  await mkdir(dirname(linkPath), { recursive: true });
  // Remove a stale link/file at the path (never a physical directory).
  try {
    const existing = await lstat(linkPath);
    if (existing.isDirectory() && !existing.isSymbolicLink()) {
      return err(
        "not_empty",
        `cannot replace physical directory with a link: ${linkPath}`,
        { linkPath },
      );
    }
    await rm(linkPath, { force: true });
  } catch {
    // absent: nothing to clear
  }
  if (platform === "win32") {
    // Junctions need no developer mode and accept absolute targets; the
    // stored target string may be either form.
    try {
      await symlink(resolve(dirname(linkPath), target), linkPath, "junction");
      return ok({ linkPath, target });
    } catch {
      // Fall through to a directory symlink (requires developer mode or
      // SeCreateSymbolicLinkPrivilege).
    }
    try {
      await symlink(resolve(dirname(linkPath), target), linkPath, "dir");
      return ok({ linkPath, target });
    } catch (error) {
      return err(
        "link_unsupported",
        `cannot create a directory link on this Windows system for ${linkPath} (junction and symlink both failed): ${error instanceof Error ? error.message : String(error)}`,
        { linkPath },
      );
    }
  }
  try {
    await symlink(target, linkPath, "dir");
    return ok({ linkPath, target });
  } catch (error) {
    return err(
      "link_unsupported",
      `cannot create directory symlink at ${linkPath}: ${error instanceof Error ? error.message : String(error)}`,
      { linkPath },
    );
  }
};
