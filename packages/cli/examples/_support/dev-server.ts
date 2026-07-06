import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sleep } from "./example-lifecycle";

// Ensure loopback fetches bypass any system HTTP proxy. A misconfigured or
// slow proxy returns 502 for localhost, and each retry burns the proxy
// timeout (~3.5s), turning a sub-second readiness probe into a 20s+ stall.
// Bun fetch reads NO_PROXY at call time, so amending it here is enough.
const LOOPBACK_NO_PROXY = "localhost,127.0.0.1,::1";
{
  const existing = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  const merged = [existing, LOOPBACK_NO_PROXY]
    .join(",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(merged));
  process.env.NO_PROXY = unique.join(",");
  process.env.no_proxy = unique.join(",");
}

const EXAMPLES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

// The unified SvelteKit examples app. Every WebView example loads a route from
// here via a loopback dev server, which the native runtime classifies as Local.
export const APP_DIR = resolve(EXAMPLES_DIR, "app");

export interface DevServer {
  /** Full URL including route, e.g. http://localhost:5173/download */
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Ensure the SvelteKit app dependencies are installed. Hard-exits with a clear
 * message if not, since the dev server cannot start without them.
 */
export function ensureAppInstalled(): void {
  if (existsSync(resolve(APP_DIR, "node_modules"))) return;
  console.error(
    `examples app dependencies are not installed.\n` +
      `Run: cd packages/cli/examples/app && bun install`,
  );
  process.exit(1);
}

/**
 * Start the SvelteKit dev server on loopback and resolve once `route` is
 * reachable. Returns the full URL to pass to createWebviewWindow({ url }).
 *
 * The dev server binds to localhost so the page origin classifies as Local,
 * which means the default nativeApiPolicy admits every capability without
 * per-route overrides.
 */
export async function startDevServer(route: string): Promise<DevServer> {
  const proc = spawn("bun", ["run", "dev"], {
    cwd: APP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const portRegex = /http:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d+)/;
  let baseUrl: string | undefined;
  const buffer: string[] = [];

  const collect = (stream: NodeJS.ReadableStream, label: string): void => {
    stream.setEncoding("utf8");
    let partial = "";
    stream.on("data", (chunk: string) => {
      partial += chunk;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        buffer.push(`[app ${label}] ${line}`);
        if (baseUrl === undefined) {
          const match = line.match(portRegex);
          if (match && match[2]) baseUrl = `http://localhost:${match[2]}`;
        }
      }
    });
  };
  if (proc.stdout) collect(proc.stdout, "out");
  if (proc.stderr) collect(proc.stderr, "err");

  // Wait for Vite/SvelteKit to print its Local URL.
  const printDeadline = Date.now() + 30_000;
  while (baseUrl === undefined && Date.now() < printDeadline) {
    await sleep(50);
  }
  if (baseUrl === undefined) {
    await killProc(proc);
    throw new Error(
      `examples app dev server did not print a URL within 30s.\n${buffer.slice(-20).join("\n")}`,
    );
  }

  const cleanRoute = route.startsWith("/") ? route : `/${route}`;
  const fullUrl = `${baseUrl}${cleanRoute}`;

  // Wait until the route actually responds. The first request may take longer
  // while Vite compiles the route on demand. Loopback fetches bypass the
  // system proxy via NO_PROXY (set at module load above).
  const readyDeadline = Date.now() + 20_000;
  while (Date.now() < readyDeadline) {
    try {
      const response = await fetch(fullUrl);
      if (response.ok || response.status === 404 || response.status === 500) {
        // 200 = ready; 404/500 means the server is up but the route may still
        // be compiling — accept and let the WebView load it.
        break;
      }
    } catch {
      // Not ready yet.
    }
    await sleep(150);
  }

  return {
    url: fullUrl,
    async close() {
      await killProc(proc);
    },
  };
}

function killProc(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }
    proc.once("exit", () => resolve());
    try {
      proc.kill("SIGTERM");
    } catch {
      // Already exiting.
    }
    // Force-kill safety net so shutdown never hangs the example.
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      resolve();
    }, 3000);
  });
}
