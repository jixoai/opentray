import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const here = dirname(fileURLToPath(import.meta.url));
const panelDir = resolve(here, "download");
const panelNodeModules = join(panelDir, "node_modules");
const smokeEnabled = process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE === "1";
const smokeCollisionFilename = "report.json";
const smokeCollisionPath = join(homedir(), "Downloads", smokeCollisionFilename);

if (smokeEnabled) {
  await rm(smokeCollisionPath, { force: true });
}

ensurePanelInstalled(panelNodeModules);

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

const vite = await startViteDevServer(panelDir);
console.log(`vite dev server: ${vite.url}`);

const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    await vite.close();
    await runtime.shutdown();
  },
});

const icon = createVisibleTrayIcon();
const webview = mountExampleWebview(
  runtime,
  "webview-download-webview",
).createWebviewWindow({
  url: vite.url,
  width: 1080,
  height: 760,
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
  // The default `nativeApiPolicy.defaultSrc: ["'local'"]` already admits every
  // capability because the page origin is a loopback host classified as Local.
} satisfies WebviewWindowOptions);

await webview.show();
console.log(`panel url: ${vite.url}`);
console.log(
  "Use the page controls to trigger single, collision, and concurrent downloads.",
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
for (const stop of unlisten) stop();

function ensurePanelInstalled(nodeModules: string): void {
  if (existsSync(nodeModules)) return;
  console.error(
    `download panel dependencies are not installed.\n` +
      `Run: cd packages/cli/examples/download && bun install`,
  );
  process.exit(1);
}

function attachDownloadLogging(
  window: Pick<WebviewWindowHandle, "listen">,
): Array<() => void> {
  return [
    window.listen<WebviewDownloadStarted>("downloadstarted", ({ payload }) => {
      console.log(
        `downloadstarted: filename=${payload.filename} suggestedFilename=${payload.suggestedFilename} url=${payload.url}`,
      );
    }),
    window.listen<WebviewDownloadProgress>("downloadprogress", ({ payload }) => {
      const total = payload.totalBytes ?? 0;
      console.log(
        `downloadprogress: ${payload.filename} ${payload.receivedBytes}/${total || "unknown"} (suggested=${payload.suggestedFilename})`,
      );
    }),
    window.listen<WebviewDownloadCompleted>("downloadcompleted", ({ payload }) => {
      console.log(
        `downloadcompleted: ${payload.filename} success=${payload.success} (suggested=${payload.suggestedFilename})`,
      );
    }),
    window.listen<WebviewDownloadStarted>("downloadfailed", ({ payload }) => {
      console.log(
        `downloadfailed: ${payload.filename} (suggested=${payload.suggestedFilename})`,
      );
    }),
    window.listen<WebviewDownloadStarted>("downloadcanceled", ({ payload }) => {
      console.log(
        `downloadcanceled: ${payload.filename} (suggested=${payload.suggestedFilename})`,
      );
    }),
  ];
}

async function runDownloadSmoke(
  window: Pick<WebviewWindowHandle, "evaluate" | "listen">,
): Promise<void> {
  // Give the SPA a moment to mount and subscribe to the bridge. The Svelte app
  // exposes its smoke hook in onMount; evaluate() is fire-and-forget so we can't
  // probe the hook directly — waitForCompletion re-triggers until events arrive.
  await sleep(1000);

  // Phase 1: single download asserts the basic lifecycle contract.
  const first = await waitForCompletion(window, 15_000);
  if (first.kind !== "completed") {
    throw new Error(`first download ended as ${first.kind}`);
  }
  await waitForFile(smokeCollisionPath, 15_000);
  console.log(
    `smoke phase 1: ${first.payload.filename} saved, suggestedFilename=${first.payload.suggestedFilename}`,
  );

  // Phase 2: a second download with the same suggested name must be deduped to
  // `report (1).json` while suggestedFilename stays `report.json`. This is the
  // exact scenario the add-webview-download-suggested-filename change targets.
  const second = await waitForCompletion(window, 15_000);
  if (second.kind !== "completed") {
    throw new Error(`second download ended as ${second.kind}`);
  }
  const secondFilename = second.payload.filename;
  const secondSuggested = second.payload.suggestedFilename;
  console.log(
    `smoke phase 2: filename=${secondFilename} suggestedFilename=${secondSuggested}`,
  );
  if (secondSuggested !== smokeCollisionFilename) {
    throw new Error(
      `suggestedFilename not preserved on dedupe (got ${secondSuggested})`,
    );
  }
  if (secondFilename === smokeCollisionFilename) {
    throw new Error(
      `expected filename to be deduped but got ${secondFilename}`,
    );
  }
  console.log(
    "smoke verified: lifecycle, progress, suggestedFilename preserved across collision dedupe",
  );

  // Phase 3: a loopback slow download must emit visible progress events with
  // increasing receivedBytes. This proves the active-downloads rows actually
  // advance from "started" through "progress" to "completed", which is the bug
  // surface the example was built to exercise.
  await runSlowProgressSmoke(window);

  // Phase 4: concurrent slow downloads must all start in parallel. Browsers
  // throttle same-frame anchor-click downloads to the last one, so the page
  // uses hidden iframes as independent browsing contexts. This phase verifies
  // that N downloads actually run simultaneously.
  await runConcurrentSmoke(window, 3);
}

async function runSlowProgressSmoke(
  window: Pick<WebviewWindowHandle, "evaluate" | "listen">,
): Promise<void> {
  let lastReceived = -1;
  let progressCount = 0;
  let maxReceived = 0;
  let totalBytes: number | null = null;
  const slowStarted = await new Promise<string>((resolveStarted, rejectStarted) => {
    const startTimeout = setTimeout(() => {
      rejectStarted(new Error("slow download did not start in time"));
    }, 10_000);
    const stops: Array<() => void> = [];
    const finish = (err?: Error): void => {
      clearTimeout(startTimeout);
      stops.forEach((stop) => stop());
    };
    stops.push(
      window.listen<WebviewDownloadStarted>("downloadstarted", ({ payload }) => {
        if (payload.url.includes("/slow-download")) {
          clearTimeout(startTimeout);
          resolveStarted(payload.url);
        }
      }),
    );
    stops.push(
      window.listen<WebviewDownloadStarted>("downloadfailed", ({ payload }) => {
        if (payload.url.includes("/slow-download")) {
          finish(
            new Error(`slow download failed: ${payload.filename}`),
          );
          rejectStarted(new Error(`slow download failed`));
        }
      }),
    );
    void window
      .evaluate(
        `window.__OPENTRAY_DOWNLOAD_EXAMPLE__.triggerSlow && window.__OPENTRAY_DOWNLOAD_EXAMPLE__.triggerSlow();`,
      )
      .catch((error: unknown) => {
        finish(error as Error);
        rejectStarted(error as Error);
      });
  });

  await new Promise<void>((resolveCompletion, rejectCompletion) => {
    const completionTimeout = setTimeout(() => {
      rejectCompletion(
        new Error(
          `slow download timed out (progressCount=${progressCount}, maxReceived=${maxReceived})`,
        ),
      );
    }, 30_000);
    const stops: Array<() => void> = [
      window.listen<WebviewDownloadProgress>(
        "downloadprogress",
        ({ payload }) => {
          if (!payload.url.includes("/slow-download")) return;
          progressCount += 1;
          if (payload.receivedBytes > maxReceived) {
            maxReceived = payload.receivedBytes;
          }
          if (payload.totalBytes !== null) {
            totalBytes = payload.totalBytes;
          }
          if (payload.receivedBytes > lastReceived) {
            lastReceived = payload.receivedBytes;
          }
        },
      ),
      window.listen<WebviewDownloadCompleted>(
        "downloadcompleted",
        ({ payload }) => {
          if (!payload.url.includes("/slow-download")) return;
          clearTimeout(completionTimeout);
          stops.forEach((stop) => stop());
          if (!payload.success) {
            rejectCompletion(new Error("slow download completed without success"));
            return;
          }
          resolveCompletion();
        },
      ),
      window.listen<WebviewDownloadStarted>("downloadfailed", ({ payload }) => {
        if (!payload.url.includes("/slow-download")) return;
        clearTimeout(completionTimeout);
        stops.forEach((stop) => stop());
        rejectCompletion(new Error(`slow download failed mid-stream`));
      }),
    ];
  });

  if (progressCount === 0) {
    throw new Error("slow download produced no progress events");
  }
  if (totalBytes === null) {
    throw new Error("slow download never reported totalBytes");
  }
  if (maxReceived < totalBytes) {
    throw new Error(
      `slow download did not reach full size: maxReceived=${maxReceived} totalBytes=${totalBytes}`,
    );
  }
  console.log(
    `smoke phase 3: slow download saw ${progressCount} progress events, ${maxReceived}/${totalBytes} bytes`,
  );
  console.log("smoke verified: progress events advance active download rows");
}

async function runConcurrentSmoke(
  window: Pick<WebviewWindowHandle, "evaluate" | "listen">,
  count: number,
): Promise<void> {
  // Trigger N concurrent slow downloads via the page hook. The page routes
  // concurrent downloads through hidden iframes so the browser does not
  // collapse them into a single navigation. We then assert that at least `count`
  // distinct downloads emitted a started event with overlapping progress.
  const startedFilenames = new Set<string>();
  const progressFilenames = new Set<string>();
  const stops: Array<() => void> = [
    window.listen<WebviewDownloadStarted>("downloadstarted", ({ payload }) => {
      if (payload.filename.startsWith("opentray-concurrent-")) {
        startedFilenames.add(payload.filename);
      }
    }),
    window.listen<WebviewDownloadProgress>("downloadprogress", ({ payload }) => {
      if (payload.filename.startsWith("opentray-concurrent-")) {
        progressFilenames.add(payload.filename);
      }
    }),
  ];
  try {
    await window.evaluate(`
      window.__OPENTRAY_DOWNLOAD_EXAMPLE__.triggerConcurrent(${count});
    `);
    // Give them time to start and make progress.
    await sleep(4000);
  } finally {
    stops.forEach((stop) => stop());
  }

  if (startedFilenames.size < count) {
    throw new Error(
      `concurrent smoke expected >=${count} started downloads, got ${startedFilenames.size}`,
    );
  }
  if (progressFilenames.size < count) {
    throw new Error(
      `concurrent smoke expected >=${count} downloads with progress, got ${progressFilenames.size}`,
    );
  }
  console.log(
    `smoke phase 4: ${startedFilenames.size} concurrent downloads started, ${progressFilenames.size} produced progress`,
  );
  console.log("smoke verified: concurrent downloads run in parallel");
}

interface CompletionResult {
  kind: "completed" | "failed" | "canceled";
  payload: WebviewDownloadCompleted;
}

// Triggers one collision download and resolves on the first terminal event
// whose suggestedFilename matches the smoke collision filename.
//
// `webview.evaluate()` is fire-and-forget: it does not surface the script's
// return value or thrown errors. The Svelte app exposes its smoke hook in
// onMount, so the first evaluate may run before the hook exists. We therefore
// re-trigger on a short cadence until a download event arrives (or the overall
// deadline elapses), which makes the smoke robust to mount timing.
function waitForCompletion(
  window: Pick<WebviewWindowHandle, "evaluate" | "listen">,
  timeoutMs: number,
): Promise<CompletionResult> {
  return new Promise<CompletionResult>((resolve, reject) => {
    let settled = false;
    const overallTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopAll();
      reject(new Error("timed out waiting for download terminal event"));
    }, timeoutMs);
    const stopListening: Array<() => void> = [
      window.listen<WebviewDownloadCompleted>(
        "downloadcompleted",
        ({ payload }) => {
          if (payload.suggestedFilename === smokeCollisionFilename) {
            if (settled) return;
            settled = true;
            stopAll();
            resolve({ kind: payload.success ? "completed" : "failed", payload });
          }
        },
      ),
      window.listen<WebviewDownloadStarted>("downloadfailed", ({ payload }) => {
        if (payload.suggestedFilename === smokeCollisionFilename) {
          if (settled) return;
          settled = true;
          stopAll();
          resolve({ kind: "failed", payload: { ...payload, success: false } });
        }
      }),
      window.listen<WebviewDownloadStarted>(
        "downloadcanceled",
        ({ payload }) => {
          if (payload.suggestedFilename === smokeCollisionFilename) {
            if (settled) return;
            settled = true;
            stopAll();
            resolve({ kind: "canceled", payload: { ...payload, success: false } });
          }
        },
      ),
    ];
    const stopAll = (): void => {
      clearTimeout(overallTimeout);
      clearTimeout(retriggerTimer);
      stopListening.forEach((stop) => stop());
    };
    // Re-trigger every 400ms until a matching event arrives. Each evaluate is
    // a no-op once the hook exists and the download has started, because the
    // hook just creates another blob download whose events also match — but the
    // first matching terminal event settles the promise and cancels the timer.
    const retrigger = (): void => {
      if (settled) return;
      void window
        .evaluate(`window.__OPENTRAY_DOWNLOAD_EXAMPLE__.triggerCollision();`)
        .catch(() => {
          // evaluate never rejects for script errors; swallow transport errors
          // too and let the retrigger cadence retry.
        });
      retriggerTimer = setTimeout(retrigger, 400);
    };
    let retriggerTimer: ReturnType<typeof setTimeout> = setTimeout(retrigger, 0);
  });
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

interface ViteDev {
  readonly url: string;
  close(): Promise<void>;
}

async function startViteDevServer(root: string): Promise<ViteDev> {
  const portRegex = /http:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d+)/;
  // Run vite via `bun run dev` so the example launcher owns the dev-server
  // lifecycle. We parse the printed `Local:` URL to discover the actual port.
  const proc = spawn("bun", ["run", "dev"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let url: string | undefined;
  const buffer: string[] = [];
  const collect = (stream: NodeJS.ReadableStream, label: string): void => {
    stream.setEncoding("utf8");
    let partial = "";
    stream.on("data", (chunk: string) => {
      partial += chunk;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        buffer.push(`[vite ${label}] ${line}`);
        if (url === undefined) {
          const match = line.match(portRegex);
          if (match && match[2]) {
            url = `http://localhost:${match[2]}`;
          }
        }
      }
    });
  };
  if (proc.stdout) collect(proc.stdout, "out");
  if (proc.stderr) collect(proc.stderr, "err");

  // Wait for Vite to print its Local URL.
  const deadline = Date.now() + 20_000;
  while (url === undefined && Date.now() < deadline) {
    await sleep(50);
  }
  if (url === undefined) {
    await killProc(proc);
    throw new Error(
      `vite dev server did not print a URL within 20s.\n${buffer.slice(-20).join("\n")}`,
    );
  }

  // Wait until the server actually responds.
  const readyDeadline = Date.now() + 10_000;
  while (Date.now() < readyDeadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) break;
    } catch {
      // Not ready yet.
    }
    await sleep(100);
  }

  return {
    url,
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
    const finalize = (): void => {
      resolve();
    };
    proc.once("exit", finalize);
    try {
      proc.kill("SIGTERM");
    } catch {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
    // Force-kill safety net so shutdown never hangs the example.
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already gone.
      }
      finalize();
    }, 3000);
  });
}
