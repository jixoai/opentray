// Orthogonal intents (maintained 2026-07-22; original user requests: run the
// start command once and stream its shell output; owner acceptance then asked
// for a real interactive terminal with completely objective stdio transport —
// the renderer owns all analysis):
// 1. Spawn the tokenized command without a shell whenever possible.
// 2. Prefer a pseudo-terminal (prebuilt @lydell/node-pty) for interactive stdin.
// 3. Transport the binding's strings VERBATIM: no re-decoding, no analysis.
//    node-pty's contract is a UTF-8 text channel (invalid bytes become U+FFFD
//    inside the binding, split multibyte chars are joined there — same
//    semantics as the ../openspecui reference stack). The wizard adds zero
//    interpretation on top; ghostty-web owns all rendering.
// 4. Degrade to pipe mode when the native PTY dependency is unavailable.
// 5. Own process-tree teardown on stop/exit across POSIX and Windows.

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

export interface CommandRunEvent {
  readonly type: "stdout" | "stderr" | "exit" | "spawn-error" | "pty-ready" | "pty-unavailable";
  /** The PTY binding's output chunk, verbatim; rendering is the frontend's job. */
  readonly chunk?: string;
  readonly code?: number | null;
  readonly message?: string;
}

export interface CommandRunTerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export interface CommandRunOptions {
  readonly tokens: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly ringLimit?: number;
  /** Attach through a PTY when available; defaults to true. */
  readonly pty?: boolean;
  readonly terminalSize?: CommandRunTerminalSize;
  readonly onEvent: (event: CommandRunEvent) => void;
}

export interface CommandRun {
  readonly pid: number | undefined;
  readonly pty: boolean;
  readonly exited: Promise<{ code: number | null; spawnError?: string }>;
  readonly output: readonly string[];
  /** Write terminal input bytes to the command's stdin (PTY mode only). */
  write(data: string): void;
  /** Resize the pseudo-terminal (PTY mode only). */
  resize(size: CommandRunTerminalSize): void;
  kill(): Promise<void>;
}

const SHELL_METACHARS = /[<>&|;$`"'%]/u;

/** True when the command line needs a shell (only Windows uses cmd /c). */
export const needsShell = (tokens: readonly string[]): boolean =>
  tokens.some((token) => SHELL_METACHARS.test(token) && token.length > 1);

/** Minimal shape of the node-pty API this module needs (@lydell/node-pty is API-compatible). */
interface PtyModule {
  spawn(
    file: string,
    args: readonly string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    },
  ): PtyProcess;
}

interface PtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
}

let ptyProbe: Promise<PtyModule | undefined> | undefined;

/**
 * Feature-detect the optional native PTY dependency. A failed or missing
 * install must never break the wizard: callers fall back to pipe mode.
 * The probe result is cached so repeated commands do not re-require it.
 */
export const loadPtyModule = (
  probe: () => Promise<PtyModule | undefined> = defaultPtyProbe,
): Promise<PtyModule | undefined> => {
  ptyProbe ??= probe().catch(() => undefined);
  return ptyProbe;
};

const defaultPtyProbe = async (): Promise<PtyModule | undefined> => {
  // Bun loads the native module and spawns fine, but its PTY read thread never
  // delivers onData — a silent empty terminal (verified 2026-08-16). Node is
  // the supported interactive host; under Bun degrade to pipes immediately.
  if (process.versions.bun !== undefined) {
    return undefined;
  }
  const require = createRequire(import.meta.url);
  for (const request of ["@lydell/node-pty", "node-pty"]) {
    try {
      const raw: unknown = require(request);
      const module = raw as { spawn?: unknown };
      if (typeof module.spawn === "function") {
        return raw as PtyModule;
      }
    } catch {
      // Try the next candidate distribution.
    }
  }
  return undefined;
};

/** Test seam: reset the cached PTY probe. */
export const resetPtyProbeCache = (): void => {
  ptyProbe = undefined;
};

const DEFAULT_TERMINAL_SIZE: CommandRunTerminalSize = { cols: 100, rows: 30 };

/** Minimal shapes of Bun's native PTY (Bun ≥ 1.2.19). */
interface BunTerminalOptions {
  cols?: number;
  rows?: number;
  name?: string;
  data?: (terminal: unknown, data: Uint8Array<ArrayBuffer>) => void;
  exit?: (terminal: unknown, exitCode: number, signal: string | null) => void;
}

interface BunTerminal {
  write(data: string | BufferSource): number;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunProcess {
  readonly pid: number;
  readonly exited: Promise<number>;
  kill(signal?: number | string): void;
}

interface BunRuntime {
  Terminal: new (options: BunTerminalOptions) => BunTerminal;
  spawn(
    command: readonly string[],
    options: { terminal: BunTerminal; cwd?: string; env?: Record<string, string> },
  ): BunProcess;
}

/** The Bun global when running under Bun with the native Terminal API. */
export const bunTerminalRuntime = (): BunRuntime | undefined => {
  const runtime = (globalThis as { Bun?: unknown }).Bun;
  if (typeof runtime !== "object" || runtime === null) {
    return undefined;
  }
  const candidate = runtime as Partial<BunRuntime>;
  if (typeof candidate.Terminal !== "function" || typeof candidate.spawn !== "function") {
    return undefined;
  }
  return candidate as BunRuntime;
};

/**
 * Native Bun PTY backend: `Bun.Terminal` + `Bun.spawn({ terminal })`. Under
 * Bun this replaces @lydell/node-pty entirely — the optional native module
 * loads but never delivers output under Bun, while the built-in Terminal is
 * first-class (verified Bun 1.3.14: output, stdin echo, resize, exit codes).
 */
export const startBunTerminalRun = (
  options: CommandRunOptions,
  bun: BunRuntime,
): CommandRun => {
  const [command, ...args] = options.tokens;
  if (command === undefined) {
    return emptyRun(options, "command is empty");
  }
  const size = options.terminalSize ?? DEFAULT_TERMINAL_SIZE;
  const ring: string[] = [];
  const ringLimit = options.ringLimit ?? 200;
  const decoder = new TextDecoder();
  const append = (chunk: string): void => {
    ring.push(chunk);
    if (ring.length > ringLimit) {
      ring.splice(0, ring.length - ringLimit);
    }
  };

  const terminal = new bun.Terminal({
    cols: size.cols,
    rows: size.rows,
    name: "xterm-256color",
    data: (_terminal, data) => {
      // Objective passthrough: decode the PTY's bytes verbatim; rendering and
      // all analysis stay in the frontend renderer.
      const text = decoder.decode(data);
      if (text.length === 0) {
        return;
      }
      append(text);
      options.onEvent({ type: "stdout", chunk: text });
    },
  });

  const proc = bun.spawn([command, ...args], {
    terminal,
    cwd: options.cwd ?? globalThis.process.cwd(),
    env: {
      ...globalThis.process.env,
      ...options.env,
      TERM: "xterm-256color",
    } as Record<string, string>,
  });
  options.onEvent({ type: "pty-ready" });

  const exited = proc.exited.then((code) => {
    options.onEvent({ type: "exit", code });
    return { code };
  });

  let killPromise: Promise<void> | undefined;
  return {
    pid: proc.pid,
    pty: true,
    exited,
    output: ring,
    write(data) {
      terminal.write(data);
    },
    resize({ cols, rows }) {
      terminal.resize(cols, rows);
    },
    kill() {
      killPromise ??= (async () => {
        // Closing the PTY sends SIGHUP to the session (children included);
        // the direct kill covers processes that detached the terminal.
        try {
          proc.kill();
        } catch {
          // already dead
        }
        try {
          terminal.close();
        } catch {
          // already closed
        }
        await exited.catch(() => undefined);
      })();
      return killPromise;
    },
  };
};

export const startCommandRun = async (options: CommandRunOptions): Promise<CommandRun> => {
  if (options.pty !== false) {
    const bun = bunTerminalRuntime();
    if (bun !== undefined) {
      try {
        return startBunTerminalRun(options, bun);
      } catch (error) {
        // PTY spawn failures fall through to pipe mode so the wizard stays usable.
        options.onEvent({
          type: "spawn-error",
          message: `bun terminal spawn failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else if (process.versions.bun !== undefined) {
      options.onEvent({
        type: "pty-unavailable",
        message:
          "Bun 版本缺少 Bun.Terminal（需要 Bun ≥ 1.2.19），预览以非交互模式运行。",
      });
    } else {
      const ptyModule = await loadPtyModule();
      if (ptyModule !== undefined) {
        try {
          return startPtyRun(options, ptyModule);
        } catch (error) {
          options.onEvent({
            type: "spawn-error",
            message: `pty spawn failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } else {
        options.onEvent({
          type: "pty-unavailable",
          message:
            "node-pty 不可用，预览以非交互模式运行（无法向命令输入内容）。可安装 @lydell/node-pty 启用交互。",
        });
      }
    }
  }
  return startPipeRun(options);
};

const startPtyRun = (options: CommandRunOptions, ptyModule: PtyModule): CommandRun => {
  const [command, ...args] = options.tokens;
  if (command === undefined) {
    return emptyRun(options, "command is empty");
  }
  const size = options.terminalSize ?? DEFAULT_TERMINAL_SIZE;
  const ring: string[] = [];
  const ringLimit = options.ringLimit ?? 200;
  const onEvent = options.onEvent;
  const append = (chunk: string): void => {
    ring.push(chunk);
    if (ring.length > ringLimit) {
      ring.splice(0, ring.length - ringLimit);
    }
  };

  const ptyProcess = ptyModule.spawn(command, args, {
    name: "xterm-256color",
    cols: size.cols,
    rows: size.rows,
    cwd: options.cwd ?? globalThis.process.cwd(),
    env: {
      ...globalThis.process.env,
      ...options.env,
      TERM: "xterm-256color",
    } as Record<string, string>,
  });
  onEvent({ type: "pty-ready" });

  const exited = new Promise<{ code: number | null; spawnError?: string }>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      onEvent({ type: "exit", code: exitCode });
      resolve({ code: exitCode });
    });
  });
  ptyProcess.onData((data) => {
    if (data.length === 0) {
      return;
    }
    append(data);
    onEvent({ type: "stdout", chunk: data });
  });

  let killPromise: Promise<void> | undefined;
  return {
    pid: ptyProcess.pid,
    pty: true,
    exited,
    output: ring,
    write(data) {
      ptyProcess.write(data);
    },
    resize({ cols, rows }) {
      try {
        ptyProcess.resize(cols, rows);
      } catch {
        // A dead PTY cannot be resized; teardown owns the rest.
      }
    },
    kill: () => {
      killPromise ??= (async () => {
        try {
          ptyProcess.kill();
        } catch {
          // Best-effort teardown: a dead process is the goal state.
        }
      })();
      return killPromise;
    },
  };
};

const startPipeRun = (options: CommandRunOptions): CommandRun => {
  const [command, ...args] = options.tokens;
  if (command === undefined) {
    return emptyRun(options, "command is empty");
  }

  const ring: string[] = [];
  const ringLimit = options.ringLimit ?? 200;
  const onEvent = options.onEvent;
  const append = (chunk: string): void => {
    ring.push(chunk);
    if (ring.length > ringLimit) {
      ring.splice(0, ring.length - ringLimit);
    }
  };

  const useShell = process.platform === "win32" && needsShell(options.tokens);
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: useShell,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
  } catch (error) {
    return emptyRun(
      options,
      error instanceof Error ? error.message : String(error),
      { code: null, spawnError: error instanceof Error ? error.message : String(error) },
    );
  }

  const exited = new Promise<{ code: number | null; spawnError?: string }>((resolve) => {
    child.once("error", (error: Error) => {
      onEvent({ type: "spawn-error", message: error.message });
      resolve({ code: null, spawnError: error.message });
    });
    child.once("exit", (code) => {
      onEvent({ type: "exit", code });
      resolve({ code });
    });
  });

  const pipe = (stream: NodeJS.ReadableStream | null, type: "stdout" | "stderr"): void => {
    if (stream === null) {
      return;
    }
    // Pipe fallback: standard one-shot UTF-8 text decode (the degraded path);
    // the renderer still owns all rendering.
    stream.on("data", (chunk: Buffer | string) => {
      const text = Buffer.from(chunk).toString("utf8");
      append(text);
      onEvent({ type, chunk: text });
    });
  };
  pipe(child.stdout, "stdout");
  pipe(child.stderr, "stderr");

  let killPromise: Promise<void> | undefined;
  return {
    pid: child.pid,
    pty: false,
    exited,
    output: ring,
    write() {
      // Pipe mode has no stdin; the WebUI shows the pty-unavailable notice.
    },
    resize() {
      // Nothing to resize without a PTY.
    },
    kill: () => {
      killPromise ??= killProcessTree(child);
      return killPromise;
    },
  };
};

const emptyRun = (
  options: CommandRunOptions,
  message: string,
  resolved?: { code: number | null; spawnError?: string },
): CommandRun => {
  options.onEvent({ type: "spawn-error", message });
  return {
    pid: undefined,
    pty: false,
    exited: Promise.resolve(resolved ?? { code: null, spawnError: message }),
    output: [],
    write() {},
    resize() {},
    kill: async () => {},
  };
};

/** Kill a command run and every descendant it spawned. */
export const killProcessTree = async (child: ChildProcess): Promise<void> => {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    if (process.platform === "win32") {
      await runExecFile("taskkill", ["/PID", String(pid), "/T", "/F"]);
    } else {
      // POSIX: signal the whole group (spawned detached) so children that
      // ignored the direct signal still terminate.
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      await waitForExit(child, 3_000).then((exited) => {
        if (!exited) {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      });
    }
  } catch {
    // Best-effort teardown: a dead process is the goal state.
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
};

const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

const runExecFile = (command: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: 5_000, windowsHide: true }, (error) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve();
    });
  });
