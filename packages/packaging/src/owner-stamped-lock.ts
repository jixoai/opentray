// harden-lifecycle-ownership D1 (openspec change harden-lifecycle-ownership;
// trace: darwin-runtime-carrier ADDED "Stable bundle lock SHALL be
// owner-stamped and self-healing" / darwin-launch-descriptor ADDED
// "Launch-state lock SHALL use the shared owner-stamped helper").
//
// One shared, platform-neutral lock helper for the two stable-bundle
// serialization points (bundle materialization and launch-descriptor update).
// Laws (plan §5 D1):
// - the lock is held only after the owner record (PID + unique token) has been
//   written and flushed; a `kill -9` therefore always leaves a reclaimable
//   stamp (or an empty file that the bounded grace window reclaims);
// - an empty, unparseable, or dead-owner lock is reclaimed within the bounded
//   acquire budget — the user never deletes a lock file by hand;
// - release removes the lock only when the on-disk token still matches, so a
//   delayed release cannot delete a replacement owner's lock.
//
// The implementation deliberately uses only plain fs primitives (exclusive
// create, hard-link claim, unlink) — no POSIX flock/lockf — so Windows
// resolves the same semantics through CreateHardLink on NTFS.

import { createHash, randomUUID } from "node:crypto";
import { link, open, readFile, stat, unlink } from "node:fs/promises";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 25;
const DEFAULT_UNCLAIMED_GRACE_MS = 250;
/** A fresh reclaim claim means another reclaimer is mid-flight; an older one
 * is garbage from a crashed reclaimer and may be cleared. */
const ABANDONED_RECLAIM_CLAIM_MS = 1_000;

export interface OwnerStampedLock {
  /** Removes the lock only while its on-disk token still matches this holder. */
  readonly release: () => Promise<void>;
}

export interface OwnerStampedLockOptions {
  /** Bounded acquire budget. Defaults to 5000 ms. */
  readonly timeoutMs?: number;
  /** Contention poll interval. Defaults to 25 ms. */
  readonly pollIntervalMs?: number;
  /**
   * How long an empty/unparseable lock is first treated as a live writer's
   * in-flight stamp before it becomes reclaimable. Defaults to 250 ms.
   */
  readonly unclaimedGraceMs?: number;
  /** Injectable liveness probe (tests). Defaults to signal-0 probing. */
  readonly isProcessAlive?: (pid: number) => boolean | Promise<boolean>;
}

export type OwnerStampedLockErrorCode = "lock_timeout";

export class OwnerStampedLockError extends Error {
  constructor(
    readonly code: OwnerStampedLockErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OwnerStampedLockError";
  }
}

/**
 * Acquires the owner-stamped lock at `lockPath`, reclaiming stale locks
 * (empty, unparseable, or dead-owner) within the bounded budget.
 */
export const acquireOwnerStampedLock = async (
  lockPath: string,
  options: OwnerStampedLockOptions = {},
): Promise<OwnerStampedLock> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const unclaimedGraceMs = options.unclaimedGraceMs ?? DEFAULT_UNCLAIMED_GRACE_MS;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const deadline = Date.now() + timeoutMs;
  const owner = `${JSON.stringify({ pid: process.pid, token: randomUUID() })}\n`;
  let unclaimedSince: { readonly content: string; readonly at: number } | undefined;

  while (Date.now() <= deadline) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(owner, "utf8");
        // "Held" requires the record on disk, not just an exclusive inode:
        // flush before anything else may treat this lock as owned.
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Read-back verification: a concurrent reclaimer may have moved this
      // still-empty file away (grace window) while the write was in flight.
      // Only a matching on-disk stamp is authority to proceed.
      if ((await readLockSource(lockPath)) === owner) {
        return {
          release: async () => {
            // Token guard: a delayed release must not delete a replacement
            // owner's lock (the content match includes this holder's token).
            if ((await readLockSource(lockPath)) !== owner) return;
            await unlink(lockPath).catch((error: unknown) => {
              if (!isNodeError(error) || error.code !== "ENOENT") throw error;
            });
          },
        };
      }
      // The path was replaced under us — fall through to normal contention.
      continue;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    }

    const observed = await readLockSource(lockPath);
    if (observed === undefined) {
      unclaimedSince = undefined;
      continue;
    }
    const observedOwner = parseLockOwner(observed);
    if (observedOwner === undefined) {
      // Empty/unparseable: first give a live writer the grace window to
      // complete its stamp, then reclaim within the same bounded budget.
      const now = Date.now();
      if (unclaimedSince === undefined || unclaimedSince.content !== observed) {
        unclaimedSince = { content: observed, at: now };
      }
      if (now - unclaimedSince.at >= unclaimedGraceMs) {
        await reclaimLock(lockPath, observed, isProcessAlive);
        unclaimedSince = undefined;
        continue;
      }
      await sleep(pollIntervalMs);
      continue;
    }
    unclaimedSince = undefined;
    if (await isProcessAlive(observedOwner.pid)) {
      await sleep(pollIntervalMs);
      continue;
    }
    await reclaimLock(lockPath, observed, isProcessAlive);
  }

  throw new OwnerStampedLockError(
    "lock_timeout",
    `timed out acquiring owner-stamped lock: ${lockPath}`,
  );
};

/**
 * Removes one stale lock file. The hard-link claim arbitrates concurrent
 * reclaimers: `link()` never disturbs the lock path itself, is content-
 * addressed (same stale content → same claim name), and only the claim winner
 * may unlink — after re-reading that the path still carries the exact stale
 * content it observed.
 */
const reclaimLock = async (
  lockPath: string,
  observed: string,
  isProcessAlive: (pid: number) => boolean | Promise<boolean>,
): Promise<void> => {
  const claimPath = `${lockPath}.reclaim-${createHash("sha256")
    .update(observed)
    .digest("hex")
    .slice(0, 16)}`;
  try {
    await link(lockPath, claimPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    if (isNodeError(error) && error.code === "EEXIST") {
      await clearAbandonedReclaimClaim(claimPath);
      return;
    }
    throw error;
  }
  try {
    const current = await readLockSource(lockPath);
    if (current !== undefined && current !== observed) return;
    const observedOwner = parseLockOwner(observed);
    if (observedOwner !== undefined && (await isProcessAlive(observedOwner.pid))) return;
    await unlink(lockPath).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  } finally {
    await unlink(claimPath).catch((error: unknown) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    });
  }
};

const clearAbandonedReclaimClaim = async (claimPath: string): Promise<void> => {
  try {
    const claim = await stat(claimPath);
    if (Date.now() - claim.ctimeMs < ABANDONED_RECLAIM_CLAIM_MS) return;
    await unlink(claimPath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
};

const readLockSource = async (lockPath: string): Promise<string | undefined> => {
  try {
    return await readFile(lockPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const parseLockOwner = (source: string): { readonly pid: number } | undefined => {
  // Earlier PID-only stamps remain honored owners (dead ones reclaim).
  const legacyPid = Number(source.trim());
  if (Number.isInteger(legacyPid) && legacyPid > 0) return { pid: legacyPid };
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.token !== "string" ||
    value.token.length === 0
  ) {
    return undefined;
  }
  return { pid: value.pid };
};

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user.
    return isNodeError(error) && error.code === "EPERM";
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
