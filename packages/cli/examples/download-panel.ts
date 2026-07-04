import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  WebviewDownloadCompleted,
  WebviewDownloadProgress,
  WebviewDownloadStarted,
  WebviewWindowHandle,
  WebviewWindowOptions,
} from "../../ext-webview/src/index";
import { createExampleLifecycle, sleep } from "./_support/example-lifecycle";
import {
  createVisibleTrayIcon,
  createWebviewExampleRuntime,
  mountExampleWebview,
} from "./_support/webview-example-support";

const downloadFilename = `opentray-download-${process.pid}-${Date.now()}.json`;
const downloadPayload = JSON.stringify(
  {
    generatedBy: "opentray example:download",
    kind: "webview-download-smoke",
    lines: "0123456789abcdef".repeat(32 * 1024),
  },
  null,
  2
);
const downloadPath = join(homedir(), "Downloads", downloadFilename);
const smokeEnabled = process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE === "1";

if (smokeEnabled) {
  await rm(downloadPath, { force: true });
}

const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "webview-download",
  homePrefix: "opentray-webview-download",
  tray: {
    id: "com.example.opentray.webview-download",
    tooltip: {
      title: "OpenTray",
      description: "WebView download lifecycle demo",
    },
    menu: {
      items: [{ type: "item", id: 99, title: "Quit Demo" }],
    },
  },
});
const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    await runtime.shutdown();
    if (smokeEnabled) {
      await rm(downloadPath, { force: true });
    }
  },
});
const icon = createVisibleTrayIcon();
const webview = mountExampleWebview(
  runtime,
  "webview-download-webview"
).createWebviewWindow({
  html: createDownloadExampleHtml(downloadFilename, downloadPayload),
  width: 760,
  height: 560,
  title: "OpenTray Download Example",
  icon,
  nativeWindowApi: true,
  bindWindowGlobals: true,
  style: {
    frameless: false,
    keepOnTop: false,
    background: { kind: "opaque" },
    platform: {
      macos: {
        cornerRadius: null,
      },
      windows: {
        cornerPreference: null,
      },
    },
  },
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
  },
} satisfies WebviewWindowOptions);

await webview.show();
console.log(`download target: ${downloadPath}`);
console.log(
  "Use the page button to trigger a real blob download and watch the lifecycle events."
);

const unlisten = attachDownloadLogging(webview);
runtime.tray.onMenuClick(({ itemId }) => {
  if (itemId === 99) {
    void lifecycle.shutdown();
  }
});

if (smokeEnabled) {
  try {
    await runDownloadSmoke(webview);
    console.log("download smoke passed");
  } catch (error) {
    console.error("download smoke failed:", error);
    process.exitCode = 1;
  } finally {
    await lifecycle.shutdown();
  }
}

await lifecycle.wait;
for (const stop of unlisten) {
  stop();
}

function attachDownloadLogging(
  window: Pick<WebviewWindowHandle, "listen">
): Array<() => void> {
  return [
    window.listen<WebviewDownloadStarted>("downloadstarted", ({ payload }) => {
      console.log(`downloadstarted: ${payload.filename}`);
    }),
    window.listen<WebviewDownloadProgress>("downloadprogress", ({ payload }) => {
      const total = payload.totalBytes ?? 0;
      console.log(
        `downloadprogress: ${payload.filename} ${payload.receivedBytes}/${total || "unknown"}`
      );
    }),
    window.listen<WebviewDownloadCompleted>("downloadcompleted", ({ payload }) => {
      console.log(`downloadcompleted: ${payload.filename} success=${payload.success}`);
    }),
    window.listen<WebviewDownloadStarted>("downloadfailed", ({ payload }) => {
      console.log(`downloadfailed: ${payload.filename}`);
    }),
    window.listen<WebviewDownloadStarted>("downloadcanceled", ({ payload }) => {
      console.log(`downloadcanceled: ${payload.filename}`);
    }),
  ];
}

async function runDownloadSmoke(
  window: Pick<WebviewWindowHandle, "evaluate" | "listen">
): Promise<void> {
  let sawProgress = false;
  const result = await new Promise<"completed" | "failed" | "canceled">(
    async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("timed out waiting for download lifecycle"));
      }, 8000);
      const stopListening = [
        window.listen<WebviewDownloadProgress>("downloadprogress", () => {
          sawProgress = true;
        }),
        window.listen<WebviewDownloadCompleted>("downloadcompleted", ({ payload }) => {
          if (payload.filename === downloadFilename && payload.success) {
            clearTimeout(timeout);
            stopListening.forEach((stop) => stop());
            resolve("completed");
          }
        }),
        window.listen<WebviewDownloadStarted>("downloadfailed", ({ payload }) => {
          if (payload.filename === downloadFilename) {
            clearTimeout(timeout);
            stopListening.forEach((stop) => stop());
            resolve("failed");
          }
        }),
        window.listen<WebviewDownloadStarted>("downloadcanceled", ({ payload }) => {
          if (payload.filename === downloadFilename) {
            clearTimeout(timeout);
            stopListening.forEach((stop) => stop());
            resolve("canceled");
          }
        }),
      ];
      await sleep(400);
      await window.evaluate(`
        window.__OPENTRAY_DOWNLOAD_EXAMPLE__.triggerDownload();
      `);
    }
  );

  if (result !== "completed") {
    throw new Error(`download lifecycle ended as ${result}`);
  }
  if (!sawProgress) {
    throw new Error("downloadprogress did not fire");
  }
  await waitForFile(downloadPath, 8000);
  const fileContent = await readFile(downloadPath, "utf8");
  if (fileContent !== downloadPayload) {
    throw new Error("downloaded file content did not match the expected payload");
  }
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`timed out waiting for ${path}`);
    }
    await sleep(100);
  }
}

function createDownloadExampleHtml(
  filename: string,
  payload: string
): string {
  const filenameJson = JSON.stringify(filename);
  const payloadJson = JSON.stringify(payload);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenTray Download Example</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, system-ui, sans-serif; }
      body { margin: 0; background: #f5f5f7; color: #111827; }
      main { max-width: 760px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
      button { border: 0; border-radius: 8px; background: #111827; color: white; padding: 10px 14px; font: inherit; cursor: pointer; }
      .meta { display: grid; gap: 6px; font-size: 14px; }
      .surface { background: white; border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; }
      ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
      @media (prefers-color-scheme: dark) {
        body { background: #0f172a; color: #e5e7eb; }
        .surface { background: #111827; border-color: #334155; }
        button { background: #2563eb; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="surface toolbar">
        <button id="download-button" type="button">Download report</button>
        <strong id="status">idle</strong>
      </section>
      <section class="surface meta">
        <div><strong>Filename:</strong> <code id="filename"></code></div>
        <div><strong>Lifecycle:</strong> standard blob URL -> native download handler -> window event bus</div>
      </section>
      <section class="surface">
        <strong>Recent events</strong>
        <ul id="events"></ul>
      </section>
      <section class="surface">
        <strong>Payload preview</strong>
        <pre id="preview"></pre>
      </section>
    </main>
    <script>
      const filename = ${filenameJson};
      const payload = ${payloadJson};
      const bridge = navigator.opentrayWindow ?? navigator.window;
      const state = { status: "idle", events: [] };
      const statusEl = document.getElementById("status");
      const eventsEl = document.getElementById("events");
      document.getElementById("filename").textContent = filename;
      document.getElementById("preview").textContent = payload.slice(0, 320) + (payload.length > 320 ? "\\n..." : "");

      const render = () => {
        statusEl.textContent = state.status;
        eventsEl.replaceChildren(...state.events.map((entry) => {
          const item = document.createElement("li");
          item.textContent = entry;
          return item;
        }));
      };

      const record = (event, payload) => {
        state.status = event;
        state.events.unshift(event + " " + JSON.stringify(payload));
        state.events = state.events.slice(0, 8);
        render();
      };

      const triggerDownload = () => {
        const blob = new Blob([payload], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      };

      window.__OPENTRAY_DOWNLOAD_EXAMPLE__ = { triggerDownload };
      document.getElementById("download-button").addEventListener("click", triggerDownload);
      render();

      if (bridge && typeof bridge.listen === "function") {
        for (const event of [
          "downloadstarted",
          "downloadprogress",
          "downloadcompleted",
          "downloadfailed",
          "downloadcanceled"
        ]) {
          void bridge.listen(event, (message) => {
            record(event, message?.payload ?? message ?? {});
          });
        }
      } else {
        record("bridge-missing", {});
      }
    </script>
  </body>
</html>`;
}
