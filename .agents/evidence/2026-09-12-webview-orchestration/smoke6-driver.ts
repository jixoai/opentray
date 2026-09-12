// Task 8.3 real smoke (D24 loadState + D26 popup windows), macOS host.
// Parent = HTTP evidence server + session B; child (this file, --child) =
// session A whose process exit drives broker session_closed cleanup.
// Evidence: .agents/evidence/2026-09-12-webview-orchestration/smoke6-loadstate-popup.ndjson
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { connectLocalBroker } from "../cli/src/local-broker.ts";
import { createClient } from "../cli/src/client.ts";
import { WebviewExt } from "./src/index.ts";
import { column, fixed, grow } from "./src/orchestration.ts";

const EVIDENCE_DIR = path.resolve(
  import.meta.dir,
  "../../.agents/evidence/2026-09-12-webview-orchestration",
);
const PORT = 8367;
const BASE = `http://127.0.0.1:${PORT}`;
const HOME = process.env.OPENTRAY_SMOKE_HOME!;

const page = (title: string, body: string) => `<!doctype html><html><head>
<meta charset="utf-8"><title>${title}</title></head><body>
<h1>${title}</h1>${body}
<script>
new EventSource('/events?src=${title}');
</script></body></html>`;

const startServer = (log: (entry: unknown) => void) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", BASE);
    log({ step: "http", method: req.method, path: url.pathname, dest: req.headers["sec-fetch-dest"] ?? null });
    if (url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`retry: 1000\n\n`);
      const src = url.searchParams.get("src") ?? "?";
      log({ step: "sse-connect", src });
      req.on("close", () => log({ step: "sse-disconnect", src }));
      return;
    }
    if (url.pathname === "/a-main.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page("a-main", `
<a id="blank" href="/a-target.html" target="_blank">blank link</a>
<a id="plain" href="/a-target.html">plain link</a>
<script>
setTimeout(() => { window.open('/a-popup-open.html'); }, 1200);
setTimeout(() => { document.getElementById('blank').click(); }, 2600);
</script>`));
      return;
    }
    if (url.pathname === "/b-main.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page("b-main", `
<script>setTimeout(() => { window.open('/b-popup.html'); }, 1500);</script>`));
      return;
    }
    if (url.pathname === "/hang") {
      log({ step: "http", method: req.method, path: "/hang", dest: "hanging" });
      // Accept the request and never respond: a navigation here stays
      // provisional, so a following navigation cancels it deterministically.
      return;
    }
    if (url.pathname === "/b-second.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page("b-second", "<p>second page</p>"));
      return;
    }
    if (url.pathname.startsWith("/a-") || url.pathname.startsWith("/b-")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(page(url.pathname.replace(/[^a-z0-9-]/g, "-"), `<p>popup content</p>`));
      return;
    }
    res.writeHead(404); res.end("no");
  });
  return new Promise<{ server: http.Server }>((resolve) =>
    server.listen(PORT, "127.0.0.1", () => resolve({ server })),
  );
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const windowCount = (): { count: number; rows: string[] } => {
  try {
    const out = execFileSync("swift", ["/tmp/opentray-83-winlist.swift"], { encoding: "utf8" });
    const rows = out.trim() ? out.trim().split("\n") : [];
    return { count: rows.length, rows };
  } catch (error) {
    return { count: -1, rows: [`swift-failed: ${String(error)}`] };
  }
};

const runChild = async (log: (entry: unknown) => void) => {
  const connection = await connectLocalBroker({
    appId: "orch.eight3.a",
    appName: "83SmokeA",
    homeDir: HOME,
  });
  const client = createClient(connection);
  const tray = await client.createTray({
    id: "tray-83-a",
    icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
  });
  const ext = tray.extend(WebviewExt);
  const win = ext.createWebviewWindow({ style: { appMode: true } });
  await win.show();
  await win.createWebview({ id: "toolbar", html: "<h3>A toolbar</h3>" });
  await win.createWebview({ id: "content", url: `${BASE}/a-main.html` });
  await win.setLayout(column([fixed("toolbar", 44), grow("content")]));
  log({ step: "child-a-ready", url: `${BASE}/a-main.html` });
  // Parent tells us to exit by creating the "a-go-away" marker; keep the
  // session alive so the broker observes a real connection-close cleanup.
  while (!fs.existsSync("/tmp/opentray-83-smoke-exit")) {
    await sleep(200);
  }
  await connection.close();
  process.exit(0);
};

const runParent = async () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const outPath = path.join(EVIDENCE_DIR, "smoke6-loadstate-popup.ndjson");
  const stream = fs.createWriteStream(outPath, { flags: "w" });
  const log = (entry: unknown) => {
    stream.write(JSON.stringify({ t: new Date().toISOString(), ...entry as object }) + "\n");
  };
  log({ step: "start", pid: process.pid, home: HOME, port: PORT });

  const { server } = await startServer(log);
  fs.rmSync("/tmp/opentray-83-smoke-exit", { force: true });
  const child = spawn(process.execPath, [import.meta.path, "--child"], {
    stdio: "inherit",
    env: process.env,
  });
  log({ step: "child-spawned", pid: child.pid });
  // Let session A boot, open popups, and settle.
  await sleep(6500);
  log({ step: "windows-while-a-alive", ...windowCount() });

  // Session B: second connection (distinct broker session), own tray.
  const connection = await connectLocalBroker({
    appId: "orch.eight3.b",
    appName: "83SmokeB",
    homeDir: HOME,
  });
  const client = createClient(connection);
  const tray = await client.createTray({
    id: "tray-83-b",
    icon: { type: "rgba", data: [0, 0, 0, 0], width: 1, height: 1 },
  });
  const ext = tray.extend(WebviewExt);
  const win = ext.createWebviewWindow({ style: { appMode: true } });
  await win.show();
  await win.createWebview({ id: "toolbar", html: "<h3>B toolbar</h3>" });
  const content = await win.createWebview({ id: "content", url: `${BASE}/b-main.html` });
  await win.setLayout(column([fixed("toolbar", 44), grow("content")]));
  const loadStates: unknown[] = [];
  content.onLoadState((event) => {
    loadStates.push(event);
    log({ step: "loadState", ...event as object });
  });
  // Let b-main load and connect (its window.open for b-popup fires at +1.5s)
  // and let the subscribe frame land before the cancel probe below.
  await sleep(2500);
  // D24 failure path, deterministic on this substrate: navigate to a URL the
  // server accepts but never answers, then navigate again — WebKit cancels
  // the hanging provisional navigation and reports it through
  // didFailProvisionalNavigation, which the loadState delegate wrapper turns
  // into a failed frame carrying the NSError code. (Plain dead-port
  // loadRequests on this macOS 26 WebKit instead commit about:blank —
  // started/finished — without calling didFail; recorded in the assert note.)
  await content.navigate(`${BASE}/hang`);
  await sleep(800);
  await content.navigate("http://127.0.0.1:9/unreachable");
  await sleep(1500);
  // A settled, clean load proves started/finished with url + full progress.
  await content.navigate(`${BASE}/b-second.html`);
  await sleep(3000);
  await sleep(2000); // b-popup window.open from b-main
  log({ step: "windows-while-both-alive", ...windowCount() });
  const phases = loadStates.map((event) => (event as { phase: string; url: string }).phase);
  log({
    step: "assert",
    name: "loadState covers started+finished and failed(errorCode)",
    phases,
    failedFrames: loadStates.filter((e) => (e as { phase: string }).phase === "failed"),
    note: "dead-port loadRequest failures on macOS 26 WebKit commit about:blank (started/finished) instead of calling didFail; the cancel path above is the deterministic failed-frame source",
    ok: phases.includes("started") && phases.includes("finished") && phases.includes("failed"),
  });

  // D26 cleanup: close session A (child exit -> connection close).
  fs.writeFileSync("/tmp/opentray-83-smoke-exit", "1");
  await sleep(4000);
  log({ step: "windows-after-a-session-close", ...windowCount() });

  // Session B teardown: destroy the window (explicit destroy path).
  await win.destroy();
  await sleep(2000);
  log({ step: "windows-after-b-destroy", ...windowCount() });
  await connection.close();

  // SSE connections observed (proxy for popup/main window liveness).
  await sleep(1000);
  log({ step: "done" });
  stream.end();
  try { child.kill("SIGKILL"); } catch {}
  server.close();
  await sleep(500);
  process.exit(0);
};

if (process.argv.includes("--child")) {
  await runChild((entry) => console.log("[child]", JSON.stringify(entry)));
} else {
  await runParent();
}
