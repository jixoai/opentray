// Orthogonal intents (2026-07-14; original user request: `example:webview-control` exits before Vite readiness):
// 1. Start the loopback Vite server used by source WebView examples.
// 2. Expose a reachable Local URL to the native WebView host.
// 3. Derive readiness from Vite server state instead of terminal output.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const EXAMPLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_URL_HOSTS = new Set(["localhost", LOOPBACK_HOST, "::1", "[::1]"]);

// The unified SvelteKit examples app. Every WebView example loads a route from
// here via a loopback dev server, which the native runtime classifies as Local.
export const APP_DIR = resolve(EXAMPLES_DIR, "app");
const VITE_NODE_ENTRY_URL = pathToFileURL(
  resolve(APP_DIR, "node_modules", "vite", "dist", "node", "index.js"),
).href;

export interface DevServer {
  /** Full URL including route, e.g. http://127.0.0.1:5173/download */
  readonly url: string;
  close(): Promise<void>;
}

interface WaitForUrlReadyOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: typeof sleep;
  now?: () => number;
  intervalMs?: number;
}

interface ViteDevServer {
  listen(): Promise<void>;
  close(): Promise<void>;
  localUrls(): readonly string[];
}

type ViteServerFactory = (config: {
  root: string;
  logLevel: "silent";
  server: { host: typeof LOOPBACK_HOST; strictPort: false };
}) => Promise<unknown>;

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

/** Selects the loopback URL Vite resolved after a successful listen operation. */
export function resolveViteLocalUrl(urls: readonly string[]): string {
  for (const candidate of urls) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" && LOOPBACK_URL_HOSTS.has(url.hostname)) {
        return url.origin;
      }
    } catch {
      // Ignore malformed dynamic Vite values and retain one stable error shape.
    }
  }
  throw new Error("Vite did not expose a loopback URL after listen()");
}

/**
 * Start the SvelteKit dev server on loopback and resolve once `route` is
 * reachable. Vite's programmatic server API is the readiness authority; its
 * formatted CLI output is intentionally ignored.
 */
export async function startDevServer(route: string): Promise<DevServer> {
  const vite = await createViteDevServer();
  try {
    await vite.listen();
    const cleanRoute = route.startsWith("/") ? route : `/${route}`;
    const fullUrl = `${resolveViteLocalUrl(vite.localUrls())}${cleanRoute}`;

    // The first route request may compile on demand. Loopback fetches bypass
    // the system proxy via NO_PROXY (set at module load above).
    if (!(await waitForUrlReady(fullUrl, Date.now() + 20_000))) {
      throw new Error(
        `examples app Vite server did not respond on ${fullUrl} within 20s.`,
      );
    }

    return { url: fullUrl, close: () => vite.close() };
  } catch (error) {
    await closeViteQuietly(vite);
    throw error;
  }
}

export async function waitForUrlReady(
  url: string,
  deadlineMs: number,
  options: WaitForUrlReadyOptions = {},
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  const now = options.now ?? Date.now;
  const intervalMs = Math.max(10, Math.round(options.intervalMs ?? 150));
  while (now() < deadlineMs) {
    try {
      const remainingMs = Math.max(1, deadlineMs - now());
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), remainingMs);
      try {
        const response = await fetchImpl(url, { signal: abort.signal });
        if (response.ok || response.status === 404 || response.status === 500) {
          return true;
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Not ready yet.
    }
    await sleepImpl(intervalMs);
  }
  return false;
}

async function createViteDevServer(): Promise<ViteDevServer> {
  return withAppWorkingDirectory(async () => {
    const viteModule: unknown = await import(VITE_NODE_ENTRY_URL);
    const createServer = readViteServerFactory(viteModule);
    return readViteDevServer(
      await createServer({
        root: APP_DIR,
        logLevel: "silent",
        server: { host: LOOPBACK_HOST, strictPort: false },
      }),
    );
  });
}

async function withAppWorkingDirectory<T>(operation: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(APP_DIR);
  try {
    return await operation();
  } finally {
    process.chdir(previous);
  }
}

function readViteServerFactory(value: unknown): ViteServerFactory {
  const module = readRecord(value, "Vite module");
  const createServer = module.createServer;
  if (typeof createServer !== "function") {
    throw new Error("Vite module does not export createServer()");
  }
  return async (config) =>
    await Reflect.apply(createServer, undefined, [config]);
}

function readViteDevServer(value: unknown): ViteDevServer {
  const server = readRecord(value, "Vite server");
  const listen = readAsyncMethod(server, "listen");
  const close = readAsyncMethod(server, "close");
  return {
    async listen() {
      await listen();
    },
    async close() {
      await close();
    },
    localUrls() {
      const resolvedUrls = server.resolvedUrls;
      if (!isRecord(resolvedUrls) || !Array.isArray(resolvedUrls.local)) {
        return [];
      }
      const urls: string[] = [];
      for (const url of resolvedUrls.local) {
        if (typeof url !== "string") {
          return [];
        }
        urls.push(url);
      }
      return urls;
    },
  };
}

function readAsyncMethod(
  record: Readonly<Record<string, unknown>>,
  name: string,
): () => Promise<unknown> {
  const method = record[name];
  if (typeof method !== "function") {
    throw new Error(`Vite server does not expose ${name}()`);
  }
  return async () => await Reflect.apply(method, record, []);
}

function readRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${name} is not an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function closeViteQuietly(vite: ViteDevServer): Promise<void> {
  try {
    await vite.close();
  } catch {
    // Preserve the original startup error.
  }
}
