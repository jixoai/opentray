// Generated-runtime ownership records (openspec change
// unify-create-opentray-core).
//
// Generated applications publish a caller-owned runtime record (PID + unique
// ownership token + process start fingerprint) under the registration's
// authority. Stop/restart target ONLY a process whose live identity and
// token still match; Core never kills by process name or appId alone, and a
// reused PID can never authorize termination.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { err, ok, type Result } from "./errors";

const execFileAsync = promisify(execFile);

export const RUNTIME_FILENAME = "runtime.json";

export interface RuntimeRecord {
  readonly pid: number;
  /** Unique per-launch ownership token (hex). */
  readonly token: string;
  /** Process start fingerprint (epoch ms) when the platform can report it. */
  readonly startedAt: number | null;
  readonly launchedAt: number;
}

export const newRuntimeToken = (): string => randomBytes(16).toString("hex");

export const readRuntimeRecord = async (
  registrationDir: string,
): Promise<RuntimeRecord | undefined> => {
  try {
    const raw = JSON.parse(await readFile(join(registrationDir, RUNTIME_FILENAME), "utf8")) as
      | RuntimeRecord
      | { [key: string]: unknown };
    if (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as { pid?: unknown }).pid === "number" &&
      typeof (raw as { token?: unknown }).token === "string"
    ) {
      const record = raw as RuntimeRecord;
      return {
        pid: record.pid,
        token: record.token,
        startedAt: typeof record.startedAt === "number" ? record.startedAt : null,
        launchedAt: typeof record.launchedAt === "number" ? record.launchedAt : Date.now(),
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export const writeRuntimeRecord = async (
  registrationDir: string,
  record: RuntimeRecord,
): Promise<void> => {
  await writeFile(join(registrationDir, RUNTIME_FILENAME), `${JSON.stringify(record, null, 2)}\n`, "utf8");
};

export const clearRuntimeRecord = async (registrationDir: string): Promise<void> => {
  await rm(join(registrationDir, RUNTIME_FILENAME), { force: true });
};

export type ProcessState = "live" | "dead" | "reused" | "unverified";

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Linux: /proc/<pid>/stat field 22 (starttime in clock ticks since boot). */
const linuxStartTicks = async (pid: number): Promise<number | undefined> => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // Comm may contain spaces; fields after the closing ')' are stable.
    const close = stat.lastIndexOf(")");
    if (close < 0) return undefined;
    const fields = stat.slice(close + 2).split(" ");
    const ticks = Number.parseInt(fields[19] ?? "", 10); // field 22 overall
    return Number.isInteger(ticks) ? ticks : undefined;
  } catch {
    return undefined;
  }
};

const bootEpochMs = async (): Promise<number | undefined> => {
  try {
    const stat = await readFile("/proc/stat", "utf8");
    const btime = /btime (\d+)/u.exec(stat);
    return btime === null ? undefined : Number.parseInt(btime[1]!, 10) * 1_000;
  } catch {
    return undefined;
  }
};

/** macOS: `ps -o lstart= -p <pid>` prints the absolute start timestamp. */
const macosStartEpochMs = async (pid: number): Promise<number | undefined> => {
  try {
    // Force the C locale: localized month/day names would break Date.parse.
    const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], {
      timeout: 5_000,
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
    const parsed = Date.parse(stdout.trim());
    return Number.isNaN(parsed) ? undefined : parsed;
  } catch {
    return undefined;
  }
};

/** Windows: PowerShell Get-Process StartTime for the pid. */
const windowsStartEpochMs = async (pid: number): Promise<number | undefined> => {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CreationDate`,
      ],
      { timeout: 10_000, windowsHide: true },
    );
    // CIM returns e.g. "20260818120000.123456+480" (DMTF) or a DateTime string.
    const trimmed = stdout.trim();
    const dmtf = /^(\d{14})(?:\.(\d+))?(?:([+-]\d+))?$/u.exec(trimmed);
    if (dmtf !== null) {
      const stamp = dmtf[1] ?? "";
      const fraction = dmtf[2];
      const offset = dmtf[3];
      const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}${fraction === undefined ? "" : `.${fraction.slice(0, 3)}`}${offset ?? "Z"}`;
      const parsed = Date.parse(iso);
      if (!Number.isNaN(parsed)) {
        // DMTF timestamps without an explicit offset are UTC.
        return parsed;
      }
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  } catch {
    return undefined;
  }
};

/**
 * Read a process's start fingerprint (epoch ms) on the current platform;
 * undefined when the platform cannot report it.
 */
export const readProcessStartEpochMs = async (
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<number | undefined> => {
  if (platform === "linux") {
    const [ticks, boot] = await Promise.all([linuxStartTicks(pid), bootEpochMs()]);
    if (ticks !== undefined && boot !== undefined) {
      const hz = 100; // USER_HZ on all mainstream Linux builds
      return boot + Math.floor((ticks / hz) * 1_000);
    }
    return undefined;
  }
  if (platform === "darwin") {
    return macosStartEpochMs(pid);
  }
  if (platform === "win32") {
    return windowsStartEpochMs(pid);
  }
  return undefined;
};

/**
 * Inspect a recorded PID against its recorded start fingerprint.
 *
 * - `dead`: the process does not exist (stale record).
 * - `reused`: a different process now owns the PID (start mismatch).
 * - `live`: alive and (when the platform reports start times) the same launch.
 * - `unverified`: alive but identity cannot be verified on this platform.
 */
export const inspectProcess = async (
  pid: number,
  expectedStartedAt: number | null,
  platform: NodeJS.Platform = process.platform,
): Promise<ProcessState> => {
  if (!isPidAlive(pid)) {
    return "dead";
  }
  if (expectedStartedAt === null) {
    // No recorded fingerprint: aliveness alone can never authorize a kill.
    return "unverified";
  }
  const toleranceMs = 2_000;
  const observed = await readProcessStartEpochMs(pid, platform);
  if (observed === undefined) {
    return "unverified";
  }
  return Math.abs(observed - expectedStartedAt) <= toleranceMs ? "live" : "reused";
};

/** Terminate a verified process tree (never called for unverified PIDs). */
export const killProcessTree = async (
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<Result<{ readonly pid: number }>> => {
  try {
    if (platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        timeout: 15_000,
        windowsHide: true,
      });
    } else {
      // Collect descendants first (SIGTERM races re-parenting).
      const { stdout } = await execFileAsync("pgrep", ["-P", String(pid)], { timeout: 5_000 }).catch(() => ({ stdout: "" }));
      const children = stdout.split("\n").map((line) => Number.parseInt(line.trim(), 10)).filter((value) => Number.isInteger(value) && value > 0);
      process.kill(pid, "SIGTERM");
      for (const child of children) {
        try {
          process.kill(child, "SIGTERM");
        } catch {
          // already gone
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      for (const target of [pid, ...children]) {
        if (isPidAlive(target)) {
          try {
            process.kill(target, "SIGKILL");
          } catch {
            // already gone
          }
        }
      }
    }
    return ok({ pid });
  } catch (error) {
    return err(
      "process_unverified",
      `failed to terminate process tree for pid ${pid}: ${error instanceof Error ? error.message : String(error)}`,
      { pid },
    );
  }
};
