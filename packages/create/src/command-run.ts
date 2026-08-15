// Orthogonal intents (maintained 2026-07-22; original user request: run the
// start command once locally and stream its shell output into the WebUI):
// 1. Spawn the tokenized command without a shell whenever possible.
// 2. Stream stdout/stderr chunks through bounded ring buffers.
// 3. Own process-tree teardown on stop/exit across POSIX and Windows.

import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";

export interface CommandRunEvent {
  readonly type: "stdout" | "stderr" | "exit" | "spawn-error";
  readonly chunk?: string;
  readonly code?: number | null;
  readonly message?: string;
}

export interface CommandRunOptions {
  readonly tokens: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly ringLimit?: number;
  readonly onEvent: (event: CommandRunEvent) => void;
}

export interface CommandRun {
  readonly pid: number | undefined;
  readonly exited: Promise<{ code: number | null; spawnError?: string }>;
  readonly output: readonly string[];
  kill(): Promise<void>;
}

const SHELL_METACHARS = /[<>&|;$`"']*%/u;

/** True when the command line needs a shell (only Windows uses cmd /c). */
export const needsShell = (tokens: readonly string[]): boolean =>
  tokens.some((token) => SHELL_METACHARS.test(token) && token.length > 1);

export const startCommandRun = (options: CommandRunOptions): CommandRun => {
  const [command, ...args] = options.tokens;
  if (command === undefined) {
    const error = "command is empty";
    options.onEvent({ type: "spawn-error", message: error });
    return {
      pid: undefined,
      exited: Promise.resolve({ code: null, spawnError: error }),
      output: [],
      kill: async () => {},
    };
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
    const message = error instanceof Error ? error.message : String(error);
    onEvent({ type: "spawn-error", message });
    return {
      pid: undefined,
      exited: Promise.resolve({ code: null, spawnError: message }),
      output: [],
      kill: async () => {},
    };
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
    exited,
    output: ring,
    kill: () => {
      killPromise ??= killProcessTree(child);
      return killPromise;
    },
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
