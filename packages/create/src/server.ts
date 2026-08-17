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
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  WizardCommandOptions,
  WizardEnvEntry,
  WizardEvent,
  WizardFormValues,
  WizardSession,
} from "./wizard";
import { openMaterializedApp } from "@create-opentray/core";
import { handleWorkbenchApi } from "./workbench-api";

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

  const indexHtml = await readWebUiIndex();

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

    if (url.pathname.startsWith("/assets/")) {
      await handleAssetFile(url.pathname, response);
      return;
    }

    // ghostty-web resolves its WASM document-relative: /ghostty-vt.wasm.
    if (url.pathname === "/ghostty-vt.wasm") {
      await handleAssetFile("/ghostty-vt.wasm", response);
      return;
    }

    if (url.pathname.startsWith("/vendor/")) {
      await handleVendorAsset(url.pathname, response);
      return;
    }

    // Composed app-icon preview bytes (wizard compose cache), token-scoped.
  const composedMatch = /^\/api\/icon-composed\/([a-f0-9]+)$/.exec(url.pathname);
  if (composedMatch !== null) {
    if (!isAuthorized(request, url, token)) {
      respond(response, 401, "text/plain", "unauthorized\n");
      return;
    }
    const key = composedMatch[1] as string;
    const composed = session.iconComposition(key);
    if (composed === undefined) {
      respond(response, 404, "text/plain", "not found\n");
      return;
    }
    try {
      const bytes = await readFile(composed.compositePath);
      response.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "no-store",
        "content-length": bytes.byteLength,
      });
      response.end(bytes);
      return;
    } catch {
      respond(response, 404, "text/plain", "not found\n");
      return;
    }
  }

  // Icon bytes for candidate thumbnails: <img> tags cannot send headers, so
  // auth accepts the same ?token= query the SSE stream uses.
  const iconDataMatch = /^\/api\/icon-data\/(\d+)\/(\d+)$/.exec(url.pathname);
  if (iconDataMatch !== null) {
    if (!isAuthorized(request, url, token)) {
      respond(response, 401, "text/plain", "unauthorized\n");
      return;
    }
    const port = Number.parseInt(iconDataMatch[1] as string, 10);
    const index = Number.parseInt(iconDataMatch[2] as string, 10);
    const candidate = session.iconCandidate(port, index);
    if (candidate === undefined) {
      respond(response, 404, "text/plain", "not found\n");
      return;
    }
    const bytes = await readFile(candidate.path).catch(() => undefined);
    if (bytes === undefined) {
      respond(response, 404, "text/plain", "not found\n");
      return;
    }
    response.writeHead(200, {
      "content-type": ICON_CONTENT_TYPES[candidate.format] ?? "application/octet-stream",
      "content-length": bytes.length,
      "cache-control": "no-store",
    });
    response.end(bytes);
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
      // Workbench routes (apps/skill/export) are Core projections with
      // their own body contract. The raw-bytes icon-upload route must NOT
      // have its stream consumed here, so only workbench paths pre-read.
      const isWorkbenchPath =
        url.pathname === "/api/apps" ||
        url.pathname.startsWith("/api/apps/") ||
        url.pathname === "/api/skill" ||
        url.pathname === "/api/skill/list";
      if (isWorkbenchPath) {
        let body: Record<string, unknown> = {};
        if (request.method === "POST") {
          body = await readJsonBody(request);
        }
        const workbench = await handleWorkbenchApi({
          method: request.method ?? "GET",
          pathname: url.pathname,
          query: url.searchParams,
          body,
        });
        if (workbench !== undefined) {
          respond(response, workbench.status, "application/json", `${JSON.stringify(workbench.body)}\n`);
          return;
        }
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

const ICON_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  svg: "image/svg+xml",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
};

const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

/**
 * Serve one file from the built webui directory (dist/webui). Only simple
 * relative names are accepted: resolve first, then require the resolved path
 * to stay inside the webui root, so traversal cannot escape.
 */
const handleAssetFile = async (
  pathname: string,
  response: ServerResponse,
): Promise<void> => {
  const relative = pathname.replace(/^\/+/, "");
  if (relative.length === 0 || relative.includes("\u0000")) {
    respond(response, 404, "text/plain", "not found\n");
    return;
  }
  // Built package layout first; source checkout falls back to create-webui's
  // vite output. Resolve-then-contain so traversal cannot escape any root.
  const roots = [
    join(moduleDir(), "webui"),
    join(moduleDir(), "..", "..", "create-webui", "dist"),
  ];
  for (const root of roots) {
    const resolved = resolve(root, relative);
    if (!(resolved === root || resolved.startsWith(`${root}${sep}`))) {
      continue;
    }
    const bytes = await readFile(resolved).catch(() => undefined);
    if (bytes === undefined) {
      continue;
    }
    const extension = extname(resolved).toLowerCase();
    response.writeHead(200, {
      "content-type": ASSET_CONTENT_TYPES[extension] ?? "application/octet-stream",
      "content-length": bytes.length,
      "cache-control": "no-store",
    });
    response.end(bytes);
    return;
  }
  respond(response, 404, "text/plain", "not found\n");
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

/** Containment: icon routes must only read sources the wizard itself
 *  produced (its temp dirs / saved uploads), never arbitrary paths. */
const isWizardOwnedIconPath = (session: WizardSession, target: string): boolean => {
  for (const root of session.iconSourceRoots()) {
    if (root.length > 0 && target.startsWith(root + sep)) {
      return true;
    }
  }
  return false;
};

const handleApi = async (
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
  session: WizardSession,
  preReadBody?: Record<string, unknown>,
): Promise<void> => {
  if (request.method !== "POST") {
    respond(response, 405, "application/json", '{"error":"method not allowed"}\n');
    return;
  }
  if (pathname === "/api/icon-upload") {
    // Raw image bytes in the request body — must not pass the JSON reader.
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const piece = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      chunks.push(piece);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 64) {
      respond(response, 400, "application/json", '{"error":"image bytes are required"}\n');
      return;
    }
    const path = await session.saveIconUpload(bytes);
    respond(response, 200, "application/json", JSON.stringify({ path }) + "\n");
    return;
  }
  const body = preReadBody ?? (await readJsonBody(request));
  switch (pathname) {
    case "/api/command": {
      // Array form: argv elements used verbatim (array input mode).
      if (Array.isArray(body.argv)) {
        const argv = body.argv.filter((element: unknown): element is string => typeof element === "string");
        if (argv.length === 0 || (argv[0] ?? "").trim().length === 0) {
          respond(response, 400, "application/json", '{"error":"argv requires the program element"}\n');
          return;
        }
        await session.submitCommand(argv);
        respond(response, 200, "application/json", '{"ok":true}\n');
        return;
      }
      const command = typeof body.command === "string" ? body.command : "";
      if (command.trim().length === 0) {
        respond(response, 400, "application/json", '{"error":"command is required"}\n');
        return;
      }
      await session.submitCommand(command);
      respond(response, 200, "application/json", '{"ok":true}\n');
      return;
    }
    case "/api/command-options": {
      const patch: Partial<{ -readonly [K in keyof WizardCommandOptions]: WizardCommandOptions[K] }> = {};
      if (typeof body.cwd === "string") {
        patch.cwd = body.cwd;
      }
      if (body.argsMode === "string" || body.argsMode === "array") {
        patch.argsMode = body.argsMode;
      }
      if (Array.isArray(body.env)) {
        const entries: WizardEnvEntry[] = [];
        for (const entry of body.env) {
          if (
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { key?: unknown }).key === "string" &&
            typeof (entry as { value?: unknown }).value === "string"
          ) {
            entries.push({ key: (entry as { key: string }).key, value: (entry as { value: string }).value });
          }
        }
        patch.env = entries;
      }
      session.updateCommandOptions(patch);
      respond(response, 200, "application/json", '{"ok":true}\n');
      return;
    }
    case "/api/prime": {
      const command = typeof body.command === "string" ? body.command : "";
      if (command.trim().length === 0) {
        respond(response, 400, "application/json", '{"error":"command is required"}\n');
        return;
      }
      session.prime(command);
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
      const patch: Partial<{ -readonly [K in keyof WizardFormValues]: WizardFormValues[K] }> = {};
      for (const key of ["appId", "appName", "iconPath", "trayIconPath"] as const) {
        const value = body[key];
        if (typeof value === "string") {
          patch[key] = value;
        }
      }
      if (body.pm === "npm" || body.pm === "pnpm" || body.pm === "bun") {
        patch.pm = body.pm;
      }
      if (
        body.iconBackground === "black" ||
        body.iconBackground === "white" ||
        body.iconBackground === "transparent"
      ) {
        patch.iconBackground = body.iconBackground;
      }
      if (typeof body.iconScale === "number" && body.iconScale >= 0.5 && body.iconScale <= 0.95) {
        patch.iconScale = body.iconScale;
      }
      for (const key of ["showStartupTerminal", "showAddressBar", "imageSmoothingEnabled", "developerMode", "force"] as const) {
        const value = body[key];
        if (typeof value === "boolean") {
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
    case "/api/icon-analyze": {
      const path = typeof body.path === "string" ? body.path.trim() : "";
      if (path.length === 0) {
        respond(response, 400, "application/json", '{"error":"path is required"}\n');
        return;
      }
      if (!isWizardOwnedIconPath(session, path)) {
        respond(response, 403, "application/json", '{"error":"path is not a wizard icon source"}\n');
        return;
      }
      try {
        const analysis = await session.analyzeIconForeground(path);
        respond(response, 200, "application/json", JSON.stringify(analysis) + "\n");
      } catch (error) {
        respond(response, 500, "application/json", JSON.stringify({ error: String(error) }) + "\n");
      }
      return;
    }
    case "/api/icon-compose": {
      const foregroundPath = typeof body.foregroundPath === "string" ? body.foregroundPath.trim() : "";
      if (foregroundPath.length === 0) {
        respond(response, 400, "application/json", '{"error":"foregroundPath is required"}\n');
        return;
      }
      if (!isWizardOwnedIconPath(session, foregroundPath)) {
        respond(response, 403, "application/json", '{"error":"foregroundPath is not a wizard icon source"}\n');
        return;
      }
      const background =
        body.background === "black" || body.background === "white" || body.background === "transparent"
          ? body.background
          : undefined;
      const scale =
        typeof body.scale === "number" && body.scale >= 0.5 && body.scale <= 0.95
          ? body.scale
          : undefined;
      try {
        const composed = await session.composeIcon({
          foregroundPath,
          ...(background === undefined ? {} : { background }),
          ...(scale === undefined ? {} : { scale }),
        });
        respond(response, 200, "application/json", JSON.stringify(composed) + "\n");
      } catch (error) {
        respond(response, 500, "application/json", JSON.stringify({ error: String(error) }) + "\n");
      }
      return;
    }
    case "/api/tray-icon-select": {
      const port = typeof body.port === "number" ? body.port : Number.NaN;
      const index = typeof body.index === "number" ? body.index : Number.NaN;
      if (!Number.isInteger(port) || !Number.isInteger(index)) {
        respond(response, 400, "application/json", '{"error":"port and index are required"}\n');
        return;
      }
      const ok = session.selectTrayIconCandidate(port, index);
      respond(response, 200, "application/json", JSON.stringify({ ok }) + "\n");
      return;
    }
    case "/api/icon-select": {
      const port = typeof body.port === "number" ? body.port : Number.NaN;
      const index = typeof body.index === "number" ? body.index : Number.NaN;
      if (!Number.isInteger(port) || !Number.isInteger(index)) {
        respond(response, 400, "application/json", '{"error":"port and index are required"}\n');
        return;
      }
      const ok = session.selectIconCandidate(port, index);
      respond(response, 200, "application/json", JSON.stringify({ ok }) + "\n");
      return;
    }
    case "/api/icon-source": {
      const path = typeof body.path === "string" ? body.path.trim() : "";
      if (path.length === 0) {
        respond(response, 400, "application/json", '{"error":"path is required"}\n');
        return;
      }
      session.updateForm({ iconPath: path });
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

/** Built package: dist/webui/index.html; source checkout falls back to the create-webui vite output. */
const webUiIndexPaths = (): readonly string[] => [
  join(moduleDir(), "webui", "index.html"),
  join(moduleDir(), "..", "..", "create-webui", "dist", "index.html"),
];

const readWebUiIndex = async (): Promise<string | undefined> => {
  for (const candidate of webUiIndexPaths()) {
    const html = await readFile(candidate, "utf8").catch(() => undefined);
    if (html !== undefined) {
      return html;
    }
  }
  return undefined;
};

/** Token fingerprint helper used in tests and diagnostics. */
export const fingerprintToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex").slice(0, 12);
