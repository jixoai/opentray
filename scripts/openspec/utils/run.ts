/**
 * Shared process-running helpers for OpenSpec workflow controllers.
 *
 * Extracted verbatim from the original `vision-driven.ts` so multiple schema
 * controllers (vision-driven, vision2-driven) can reuse the same mechanics
 * without duplicating spawn/inline-document logic.
 */

export interface RunOptions {
  cwd: string;
}

export interface CaptureResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Spawn the project-local `openspec` CLI inheriting stdio. Returns false on non-zero exit. */
export const runOpenspec = async (
  args: string[],
  opts: RunOptions,
): Promise<boolean> => {
  const proc = Bun.spawn({
    cmd: ["openspec", ...args],
    cwd: opts.cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return false;
  }
  return true;
};

/** Spawn a command capturing stdout/stderr. Does not touch process.exitCode. */
export const runCapture = async (cmd: string[], cwd: string): Promise<CaptureResult> => {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

/**
 * Read a non-empty inline document from stdin (shell Here Document), or null
 * when stdin is a TTY or empty. Used by file-writing commands that accept
 * operator-authored content as a source of truth.
 */
export const readInlineDocument = async (): Promise<string | null> => {
  if (process.stdin.isTTY) {
    return null;
  }
  const content = await new Response(Bun.stdin.stream()).text();
  return content.length > 0 ? content : null;
};
