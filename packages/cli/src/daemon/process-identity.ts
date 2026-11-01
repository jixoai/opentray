// Orthogonal intent (2026-11-01; original user request: a recycled PID must
// never be mistaken for the detached broker, and must never be signalled):
// resolve the live executable behind a PID without side effects. The daemon
// lifecycle compares this path with ready.json before it reuses or stops a
// recorded broker. An unknown answer is not evidence: callers must fail closed
// instead of assuming the PID still belongs to the broker.

import { execFile } from "node:child_process";
import { readlink, realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/**
 * Best-effort executable path for a live PID. Returns undefined when the
 * platform cannot answer (permissions, process already gone, tooling absent);
 * it never throws and never signals the process.
 */
export const resolveProcessExecutablePath = async (
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> => {
  try {
    const value = await readExecutablePath(pid, platform);
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!isAbsolute(trimmed)) return undefined;
    // ready.json stores the broker's realpath; resolve symlinked launch paths
    // (notably macOS ps comm) before the caller compares identities.
    return await realpath(trimmed).catch(() => trimmed);
  } catch {
    return undefined;
  }
};

const readExecutablePath = async (
  pid: number,
  platform: NodeJS.Platform,
): Promise<string | undefined> => {
  if (platform === "win32") {
    // -EncodedCommand avoids Node -> PowerShell quote mangling. Get-Process is
    // ~2x faster than the CIM query and exposes the same full Path.
    const script = `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const { stdout } = await execute("powershell", ["-NoProfile", "-EncodedCommand", encoded], {
      timeout: 4_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    return stdout;
  }
  if (platform === "linux") {
    return (await readlink(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/u, "");
  }
  if (platform === "darwin") {
    const { stdout } = await execute("/bin/ps", ["-p", String(pid), "-o", "comm="], {
      timeout: 4_000,
    });
    return stdout;
  }
  return undefined;
};
