// Orthogonal intents (maintained 2026-07-22; original user requests: run the
// start command once and stream its shell output; owner acceptance then asked
// for a real interactive terminal because commands may need stdin):
// 1. Spawn the tokenized command without a shell whenever possible.
// 2. Prefer a pseudo-terminal so interactive stdin, prompts, and TUI output work.
// 3. Degrade to pipe mode when the native PTY dependency is unavailable.
// 4. Own process-tree teardown on stop/exit across POSIX and Windows.

import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";

export interface CommandRunEvent {
  readonly type: "stdout" | "stderr" | "exit" | "spawn-error" | "pty-ready" | "pty-unavailable";
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
  /** Write keystrokes to the command's stdin (PTY mode only). */
  write(data: string): void;
  /** Resize the pseudo-terminal (PTY mode only). */
  resize(size: CommandRunTerminalSize): void;
  kill(): Promise<void>;
}

const SHELL_METACHARS = /[<>&|;$`"'%]/u;

/** True when the command line needs a shell (only Windows uses cmd /c). */
export const needsShell = (tokens: readonly string[]): boolean =>
  tokens.some((token) => SHELL_METACHARS.test(token) && token.length > 1);

/** Minimal shape of the node-pty module this module needs. */
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
  try {
    const require = createRequire(import.meta.url);
    const raw: unknown = require("node-pty");
    const module = raw as { spawn?: unknown } & Record<string, unknown>;
    if (typeof module.spawn !== "function") {
      return undefined;
    }
    await healSpawnHelperPermissions(raw);
    return raw as PtyModule;
  } catch {
    return undefined;
  }
};

/**
 * npm tarballs can strip the execute bit from node-pty's prebuilt
 * `spawn-helper`, making every spawn fail with `posix_spawnp failed`. The
 * package's own post-install repairs this; when a package manager skipped it
 * (observed with pnpm), restore the bit next to the loaded binding.
 */
const healSpawnHelperPermissions = async (ptyModule: unknown): Promise<void> => {
  if (process.platform === "win32") {
    return;
  }
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve("node-pty/package.json");
    const { dirname, join } = await import("node:path");
    const { access, chmod, constants, readdir } = await import("node:fs/promises");
    const prebuildsDir = join(dirname(packageJsonPath), "prebuilds");
    for (const entry of await readdir(prebuildsDir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) {
        continue;
      }
      const helper = join(prebuildsDir, entry.name, "spawn-helper");
      try {
        await access(helper, constants.X_OK);
      } catch {
        await chmod(helper, 0o755).catch(() => undefined);
      }
    }
  } catch {
    // Healing is best-effort; a genuinely broken PTY falls back to pipe mode.
  }
};

/** Test seam: reset the cached PTY probe. */
export const resetPtyProbeCache = (): void => {
  ptyProbe = undefined;
};

const DEFAULT_TERMINAL_SIZE: CommandRunTerminalSize = { cols: 100, rows: 30 };

export const startCommandRun = async (options: CommandRunOptions): Promise<CommandRun> => {
  if (options.pty !== false) {
    const ptyModule = await loadPtyModule();
    if (ptyModule !== undefined) {
      try {
        return startPtyRun(options, ptyModule);
      } catch (error) {
        // PTY spawn failures fall through to pipe mode so the wizard stays usable.
        options.onEvent({
          type: "spawn-error",
          message: `pty spawn failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } else {
      options.onEvent({
        type: "pty-unavailable",
        message:
          "node-pty 不可用，预览以非交互模式运行（无法向命令输入内容）。安装 build 工具链后重装 create-opentray 可启用交互。",
      });
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
  // A PTY delivers bytes that may split UTF-8 sequences across chunks; decode
  // incrementally so the event stream always carries valid strings.
  const decoder = new TextDecoder("utf-8");

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
    const text = decoder.decode(Buffer.from(data, "binary"), { stream: true });
    if (text.length === 0) {
      return;
    }
    append(text);
    onEvent({ type: "stdout", chunk: text });
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
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      append(chunk);
      onEvent({ type, chunk });
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
