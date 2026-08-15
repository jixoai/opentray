// Orthogonal intents (maintained 2026-07-22; original user request: the wizard
// is a local WebUI; mutating endpoints must be session-guarded):
// 1. Serve the static wizard page and its API on 127.0.0.1 only.
// 2. Stream wizard events over SSE with per-client replay of the event log.
// 3. Reject unauthenticated or non-loopback-Host mutations with 401/403.

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { WizardEvent, WizardSession } from "./wizard";
import { openMaterializedApp } from "./open-app";

export interface WizardServerHandle {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly session: WizardSession;
  close(): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const createWizardServer = async (
  createSession: (emit: (event: WizardEvent) => void) => WizardSession,
  options: { readonly port?: number } = {},
): Promise<WizardServerHandle> => {
  const token = randomBytes(16).toString("hex");
  const clients = new Set<ServerResponse>();
  const eventLog: WizardEvent[] = [];

  const emit = (event: WizardEvent): void => {
    eventLog.push(event);
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      client.write(frame);
    }
  };

  const session = createSession(emit);

  const indexHtml = await readFile(resolveWebUiPath(), "utf8").catch(() => undefined);

  const server: Server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      respond(
        response,
        500,
        "application/json",
        `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
      );
    });
  });

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!isAuthorized(request, url, token)) {
        respond(response, 401, "text/plain", "invalid wizard token\n");
        return;
      }
      if (indexHtml === undefined) {
        respond(response, 500, "text/plain", "wizard page is missing from this installation\n");
        return;
      }
      respond(response, 200, "text/html; charset=utf-8", indexHtml);
      return;
    }

    if (url.pathname === "/api/events") {
      if (!isAuthorized(request, url, token)) {
        respond(response, 401, "text/plain", "unauthorized\n");
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(": connected\n\n");
      for (const event of eventLog) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      clients.add(response);
      request.once("close", () => {
        clients.delete(response);
      });
      return;
    }

    if (url.pathname.startsWith("/vendor/")) {
      await handleVendorAsset(url.pathname, response);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(request, url, token)) {
        respond(response, 401, "application/json", '{"error":"unauthorized"}\n');
        return;
      }
      if (!isLoopbackHost(request)) {
        respond(response, 403, "application/json", '{"error":"forbidden host"}\n');
        return;
      }
      await handleApi(url.pathname, request, response, session);
      return;
    }

    respond(response, 404, "text/plain", "not found\n");
  };

  await listen(server, options.port);
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("wizard server did not bind a loopback port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/?token=${token}`,
    port: address.port,
    token,
    session,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of clients) {
          client.end();
        }
        clients.clear();
        server.close(() => resolve());
      }),
  };
};

/** Whitelisted static terminal-renderer assets; exact names only, no traversal. */
const VENDOR_ASSETS: Readonly<
  Record<string, { contentType: string; candidates: () => readonly string[] }>
> = {
  "/vendor/ghostty-web.js": {
    contentType: "text/javascript; charset=utf-8",
    candidates: () => [
      join(moduleDir(), "webui", "vendor", "ghostty-web.js"),
      ghosttyPackageFile("dist/ghostty-web.js"),
    ],
  },
  "/vendor/ghostty-vt.wasm": {
    contentType: "application/wasm",
    candidates: () => [
      join(moduleDir(), "webui", "vendor", "ghostty-vt.wasm"),
      ghosttyPackageFile("ghostty-vt.wasm"),
      ghosttyPackageFile("dist/ghostty-vt.wasm"),
    ],
  },
};

const moduleDir = (): string => dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a file inside the installed ghostty-web package. Deep paths are
 * blocked by the package `exports` map, so resolve the exported main module
 * and walk from the package root instead.
 */
const ghosttyPackageFile = (relative: string): string => {
  try {
    const require = createRequire(import.meta.url);
    const main = require.resolve("ghostty-web");
    const packageRoot = dirname(dirname(main));
    return join(packageRoot, relative);
  } catch {
    return "";
  }
};

const handleVendorAsset = async (pathname: string, response: ServerResponse): Promise<void> => {
  const asset = VENDOR_ASSETS[pathname];
  if (asset === undefined) {
    respond(response, 404, "text/plain", "not found\n");
    return;
  }
  for (const candidate of asset.candidates()) {
    if (candidate.length === 0) {
      continue;
    }
    const bytes = await readFile(candidate).catch(() => undefined);
    if (bytes !== undefined) {
      response.writeHead(200, {
        "content-type": asset.contentType,
        "content-length": bytes.length,
        "cache-control": "no-store",
      });
      response.end(bytes);
      return;
    }
  }
  respond(response, 404, "text/plain", "terminal renderer asset is missing\n");
};

const handleApi = async (
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
  session: WizardSession,
): Promise<void> => {
  if (request.method !== "POST") {
    respond(response, 405, "application/json", '{"error":"method not allowed"}\n');
    return;
  }
  const body = await readJsonBody(request);
  switch (pathname) {
    case "/api/command": {
      const command = typeof body.command === "string" ? body.command : "";
      if (command.trim().length === 0) {
        respond(response, 400, "application/json", '{"error":"command is required"}\n');
        return;
      }
      await session.submitCommand(command);
      respond(response, 200, "application/json", '{"ok":true}\n');
      return;
    }
    case "/api/select-service": {
      const port = Number(body.port);
      if (!Number.isInteger(port) || port <= 0) {
        respond(response, 400, "application/json", '{"error":"port is required"}\n');
        return;
      }
      session.selectService(port);
      respond(response, 200, "application/json", '{"ok":true}\n');
      return;
    }
    case "/api/form": {
      const patch: Record<string, string> = {};
      for (const key of ["appId", "appName", "targetDir", "pm"] as const) {
        const value = body[key];
        if (typeof value === "string") {
          patch[key] = value;
        }
      }
      session.updateForm(patch);
      respond(response, 200, "application/json", '{"ok":true}\n');
      return;
    }
    case "/api/confirm": {
      try {
        session.confirm();
        respond(response, 200, "application/json", '{"ok":true}\n');
      } catch (error) {
        respond(
          response,
          409,
          "application/json",
          `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
        );
      }
      return;
    }
    case "/api/create": {
      try {
        await session.create();
        respond(response, 200, "application/json", '{"ok":true}\n');
      } catch (error) {
        respond(
          response,
          409,
          "application/json",
          `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
        );
      }
      return;
    }
    case "/api/terminal-input": {
      const data = typeof body.data === "string" ? body.data : undefined;
      if (data === undefined) {
        respond(response, 400, "application/json", '{"error":"data is required"}\n');
        return;
      }
      session.terminalInput(data);
      respond(response, 200, "application/json", '{"ok":true}\n');
      return;
    }
    case "/api/terminal-resize": {
      const cols = Number(body.cols);
      const rows = Number(body.rows);
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
        respond(response, 400, "application/json", '{"error":"cols and rows are required"}\n');
        return;
      }
      session.terminalResize({ cols, rows });
      respond(response, 200, "application/json", '{"ok":true}\n');
      return;
    }
    case "/api/stop": {
      await session.stop();
      respond(response, 200, "application/json", '{"ok":true}\n');
      return;
    }
    case "/api/open-app": {
      const result = session.result;
      if (result === undefined) {
        respond(response, 409, "application/json", '{"error":"no materialized app"}\n');
        return;
      }
      const opened = await openMaterializedApp({
        projectDir: result.projectDir,
        bundlePath: result.bundlePath,
      });
      respond(
        response,
        opened.ok ? 200 : 500,
        "application/json",
        `${JSON.stringify({ ok: opened.ok, detail: opened.detail })}\n`,
      );
      return;
    }
    default:
      respond(response, 404, "application/json", '{"error":"unknown endpoint"}\n');
  }
};

const listen = (server: Server, port?: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

export const isAuthorized = (
  request: IncomingMessage,
  url: URL,
  token: string,
): boolean => {
  const header = request.headers.authorization;
  if (header === `Bearer ${token}`) {
    return true;
  }
  return url.searchParams.get("token") === token;
};

export const isLoopbackHost = (request: IncomingMessage): boolean => {
  const host = request.headers.host ?? "";
  const hostname = host.replace(/:\d+$/u, "").toLowerCase();
  return LOOPBACK_HOSTS.has(hostname);
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 1 << 20) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }
  return parsed as Record<string, unknown>;
};

const respond = (
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void => {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
};

const resolveWebUiPath = (): string => {
  // Works in both layouts: dist/webui/index.html (built package) and
  // src/webui/index.html (source checkout development).
  return join(moduleDir(), "webui", "index.html");
};

/** Token fingerprint helper used in tests and diagnostics. */
export const fingerprintToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex").slice(0, 12);
