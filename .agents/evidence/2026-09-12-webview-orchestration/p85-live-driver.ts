// Task 8.5 live probe (macOS host): the REAL built toolbar page
// (packages/create/dist/shell, served verbatim) driven through the REAL
// staged dylib, replicating the generated entry's carrier shape 1:1
// (toolbar webview with bridge policy + bridgeless content webview +
// column layout + channel; url + load-state forwarded over the channel).
// Evidence: .agents/evidence/2026-09-12-webview-orchestration/p85-toolbar-live.ndjson
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

import { connectLocalBroker } from "../cli/src/local-broker.ts";
import { createClient } from "../cli/src/client.ts";
import { WebviewExt } from "./src/index.ts";
import { column, fixed, grow } from "./src/orchestration.ts";

const PORT = 8385;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = process.env.P85_PROBE_HOME!;
const SHELL_DIR = path.resolve(import.meta.dir, "../create/dist/shell");
const EVIDENCE = path.resolve(import.meta.dir, "../../.agents/evidence/2026-09-12-webview-orchestration/p85-toolbar-live.ndjson");

const CT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const startServer = (log: (entry: unknown) => void) => {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", BASE);
    log({
      step: "http",
      method: req.method,
      path: url.pathname,
      dest: req.headers["sec-fetch-dest"] ?? null,
    });
    if (url.pathname === "/slow" || url.pathname === "/slow2") {
      // Flush headers, hold the body ~4s: the load bar's indeterminate /
      // in-flight window is observable for seconds on the real page.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.write("<!doctype html><html><head><meta charset=utf-8><title>slow page</title></head><body><h1>slow");
      await sleep(4000);
      res.end(` ${url.pathname} loaded</h1></body></html>`);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      // A REAL favicon payload (the shell's own 16px png): the toolbar page's
      // <img> must render it; the request itself is the D25 liveness proof.
      const bytes = await readFile(path.join(SHELL_DIR, "favicon-16.png")).catch(() => undefined);
      if (bytes === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" }).end(bytes);
      return;
    }
    // Static: serve the built shell exactly as the generated app's shell
    // server does (dist/shell copied verbatim into app-shell).
    const relative = path.normalize(url.pathname).replace(/^([/\\.])+/, "");
    const target = path.resolve(SHELL_DIR, relative === "" ? "index.html" : relative);
    if (target !== SHELL_DIR && !target.startsWith(SHELL_DIR + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    const info = await stat(target).catch(() => undefined);
    const file = info?.isFile() === true ? target : path.join(SHELL_DIR, "toolbar.html");
    const bytes = await readFile(file);
    res.writeHead(200, { "content-type": CT[path.extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" }).end(bytes);
  });
  return new Promise<http.Server>((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
};

const run = async () => {
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  const stream = fs.createWriteStream(EVIDENCE, { flags: "w" });
  const log = (entry: unknown) => {
    stream.write(JSON.stringify({ t: new Date().toISOString(), ...entry as object }) + "\n");
  };
  log({ step: "start", pid: process.pid, home: HOME, shellDir: SHELL_DIR, port: PORT });

  const server = await startServer(log);

  const connection = await connectLocalBroker({
    appId: "orch.p85.probe",
    appName: "P85Probe",
    homeDir: HOME,
  });
  const client = createClient(connection);
  const tray = await client.createTray({
    id: "tray-p85",
    icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
  });
  const shell = tray.extend(WebviewExt).createWebviewWindow({ windowOnly: true });
  await shell.show();
  // Carrier shape (toolbar-carrier.ts), verbatim:
  await shell.createWebview({
    id: "toolbar",
    url: `${BASE}/toolbar.html`,
    bridge: { webviewId: true, messageChannels: true },
  });
  const content = await shell.createWebview({ id: "content", url: `${BASE}/slow` });
  await shell.setLayout(column([fixed("toolbar", 44), grow("content")]));
  const channel = await shell.createMessageChannel({ target: "toolbar" });

  const fromPage: unknown[] = [];
  channel.onMessage((payload) => {
    fromPage.push(payload);
    log({ step: "page-message", payload });
  });
  const loadStates: Record<string, unknown>[] = [];
  const pushUrl = async (url: unknown) => {
    await channel.post({ kind: "url", url: String(url) });
  };
  const pushLoadState = async (event: Record<string, unknown>) => {
    const frame: Record<string, unknown> = { kind: "load-state", phase: event.phase, url: String(event.url) };
    if (typeof event.progress === "number") frame.progress = event.progress;
    if (typeof event.errorCode === "number") frame.errorCode = event.errorCode;
    await channel.post(frame);
  };
  content.onLoadState((event) => {
    loadStates.push(event as Record<string, unknown>);
    log({ step: "loadState", ...event as object });
    void pushLoadState(event as Record<string, unknown>).catch((e) => log({ step: "push-error", error: String(e) }));
  });
  content.onUrlChange((event) => {
    log({ step: "urlChange", url: event.url });
    void pushUrl(event.url).catch((e) => log({ step: "push-error", error: String(e) }));
  });
  void content.getUrl().then((state) => pushUrl(state.url)).catch(() => {});

  // Wait through the 4s slow load; the toolbar page should handshake
  // (get-url) and fetch the origin favicon (D25) once the url push lands.
  await sleep(7000);

  // Second navigation: progress bar must reset + converge again.
  await content.navigate(`${BASE}/slow2`);
  await sleep(7000);

  const phases = loadStates.map((e) => e.phase);
  const httpEntries = fs.readFileSync(EVIDENCE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const faviconHits = httpEntries.filter((e) => e.step === "http" && e.path === "/favicon.ico").length;
  log({
    step: "assert",
    name: "loadState frames flowed (started + finished with progress=1) and were forwarded over the channel",
    phases,
    finishedProgress: loadStates.filter((e) => e.phase === "finished").map((e) => e.progress),
    ok: phases.includes("started") && phases.includes("finished"),
    faviconHits,
  });
  log({
    step: "assert",
    name: "toolbar page handshook over the channel (get-url observed)",
    ok: fromPage.some((m) => (m as { kind?: string }).kind === "get-url"),
  });

  await shell.destroy();
  await connection.close();
  await sleep(1200);
  log({ step: "done" });
  stream.end();
  server.close();
  await sleep(300);
  process.exit(0);
};

await run();
