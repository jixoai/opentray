import { spawn } from "node:child_process";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createExampleLifecycle } from "./_support/example-lifecycle";
import { ensureAppInstalled, startDevServer } from "./_support/dev-server";
import {
  createWebviewExampleRuntime,
  createVisibleTrayIcon,
  listenWebviewIpcMessages,
  mountExampleWebview,
  prepareLocalBadgeExtensionPath,
  shutdownWebviewExample,
  type WebviewPageMessageWatch,
} from "./_support/webview-example-support";
import {
  attachBadge,
  badgePanelEnvelopeFromCapabilities,
  type BadgeCapabilities,
  type BadgePanelEnvelope,
} from "../../ext-badge/src/index";

ensureAppInstalled();

const runtime = await createWebviewExampleRuntime({
  importMetaUrl: import.meta.url,
  requestIdPrefix: "badge-panel-demo",
  homePrefix: "opentray-badge-panel",
  tray: {
    id: "com.example.opentray.badge-panel",
    tooltip: {
      title: "OpenTray Badge Debug Panel",
      description: "Badge status debugger driven through ext-webview IPC",
    },
    menu: {
      items: [{ type: "item", id: 99, title: "Quit Badge Debug Panel" }],
    },
  },
});

const localBadgeExtension = await prepareLocalBadgeExtensionPath(import.meta.url);
const { tray } = runtime;
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const homeDir = runtime.homeDir;
const dockClickSignalPath = join(homeDir, "badge-dock-click.signal");
const dockHelperZipPath = join(homeDir, "OpenTrayBadgeHelper.app.zip");
const dockHelperExtractDir = join(homeDir, "badge-dock-helper-extract");
const dockHelperBundlePath = join(dockHelperExtractDir, "OpenTrayBadgeHelper.app");
const dockHelperQuitSignalPath = join(homeDir, "badge-dock-quit.signal");
const dockHelperQuitNotifyPath = join(homeDir, "badge-dock-quit-notify.signal");
const dockHelperStateDir = join(homeDir, "badge-dock-state");
const dockHelperBadgePath = join(dockHelperStateDir, "badge.txt");
const dockHelperTitlePath = join(dockHelperStateDir, "title.txt");
const dockHelperIconNamePath = join(dockHelperStateDir, "icon-name.txt");
const badge = attachBadge(tray, {
  mountId: "badge-panel-badge",
  ...(localBadgeExtension === undefined ? {} : { path: localBadgeExtension }),
});
const webviewTray = mountExampleWebview(runtime, "badge-panel-webview");
const badgePlatform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const devServer = await startDevServer(`/badge?platform=${badgePlatform}`);
console.log(`badge panel: ${devServer.url}`);
const panel = webviewTray.createWebviewWindow({
  url: devServer.url,
  width: 1120,
  height: 840,
  title: "OpenTray Badge Debug Panel",
  icon: createVisibleTrayIcon(),
  style: {
    frameless: false,
    keepOnTop: false,
    background: {
      kind: "semantic",
      token: "blur",
      state: "active",
    },
    platform: {
      macos: {
        cornerRadius: null,
      },
      windows: {
        cornerPreference: null,
      },
    },
  },
  nativeWindowApi: true,
  bindWindowGlobals: true,
  nativeTrayApi: true,
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
  },
});

const snapshot = await badge.getPanelEnvelope();
const panelState: BadgePanelEnvelope = {
  ...snapshot,
  log: [
    "badge panel started",
    "ext-webview IPC routes page intents to host state",
    `platform: ${process.platform}`,
    ...(snapshot.reason === undefined ? [] : [`reason: ${snapshot.reason}`]),
  ],
};

console.log(`badge helper home: ${homeDir}`);
console.log(`badge panel platform: ${process.platform}`);

const pageMessageWatch: WebviewPageMessageWatch = listenWebviewIpcMessages(
  panel,
  handlePanelIpcMessage,
  { intervalMs: 16 },
);
const dockClickWatch = watchDockClickSignal(dockClickSignalPath, async () => {
  panelState.log.unshift("dock click -> open debug panel");
  panelState.log = panelState.log.slice(0, 8);
  await panel.show({
    fallbackRect: { x: 0, y: 0, width: 1, height: 1 },
  });
  await broadcastState("dock click");
});
const dockQuitWatch = watchDockQuitSignal(dockHelperQuitNotifyPath, async () => {
  panelState.log.unshift("dock helper exited -> shutting down tray");
  panelState.log = panelState.log.slice(0, 8);
  await lifecycle.shutdown();
});
const lifecycle = createExampleLifecycle({
  exitAfterMs: process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS,
  onShutdown: async () => {
    await signalBadgeDockHelperQuit();
    dockClickWatch.close();
    dockQuitWatch.close();
    pageMessageWatch.stop();
    await shutdownWebviewExample(runtime, devServer);
  },
});
if (process.platform === "darwin") {
  await prepareBadgeDockStateFiles();
  await syncBadgeDockHelper(panelState);
  await ensureBadgeDockHelperAvailable(dockHelperZipPath);
  await extractBadgeDockHelper(dockHelperZipPath, dockHelperExtractDir);
  await ensureBadgeDockHelperBundle(dockHelperExtractDir, dockHelperBundlePath);
  void launchBadgeDockHelper(dockHelperBundlePath, false);
}

tray.onMenuClick(({ itemId }) => {
  if (itemId === 99) {
    void lifecycle.shutdown();
  }
});

await badge.showPanel();

await panel.show({
  fallbackRect: { x: 0, y: 0, width: 1, height: 1 },
});
await panel.setMinimumSize(820, 620);
await broadcastState("panel opened");

if (process.env.OPENTRAY_EXAMPLE_WEBVIEW_SMOKE === "1") {
  await panel.postMessage({ type: "badgePanelState", snapshot: panelState });
  await lifecycle.shutdown();
}

await lifecycle.wait;

async function handlePanelIpcMessage(message: { payload: unknown }): Promise<void> {
  // The WebView page only emits operator intents; all badge truth still flows
  // through the extension handle so the panel cannot become badge ontology.
  const payload = message.payload;
  if (!isRecord(payload) || typeof payload.type !== "string") {
    return;
  }

  switch (payload.type) {
    case "refresh":
      await broadcastState("refresh");
      return;
    case "reset":
      await runBadgeAction("reset", () => badge.reset());
      return;
    case "hide":
      await panel.hide();
      panelState.log.unshift("panel hidden");
      return;
    case "badge:set":
      await runBadgeAction("setBadge", () => badge.setBadge(typeof payload.value === "string" ? payload.value : ""));
      return;
    case "badge:clear":
      await runBadgeAction("clearBadge", () => badge.clearBadge());
      return;
    case "progress:set":
      await runBadgeAction("setProgress", () => badge.setProgress(Number(payload.value), 100));
      return;
    case "progress:state":
      await runBadgeAction("setProgressState", () => badge.setProgressState(resolveProgressState(payload.value)));
      return;
    case "overlay:set":
      await runBadgeAction("setOverlayIcon", () => badge.setOverlayIcon(resolveOverlayIcon(payload.value)));
      return;
    case "attention:toggle":
      await runBadgeAction("setAttention", () => badge.setAttention(!panelState.state.attention));
      return;
    default:
      panelState.log.unshift(`unknown intent: ${payload.type}`);
      await broadcastState("unknown intent");
  }
}

async function runBadgeAction(op: string, action: () => Promise<BadgeCapabilities>): Promise<void> {
  try {
    const next = badgePanelEnvelopeFromCapabilities(await action());
    applyPanelEnvelope(next, `${op} ok`);
    await syncBadgeDockHelper(next);
  } catch (error) {
    panelState.log.unshift(`${op} failed: ${formatError(error)}`);
  }
  await broadcastState(op);
}

function applyPanelEnvelope(envelope: BadgePanelEnvelope, reason: string): void {
  panelState.platform = envelope.platform;
  panelState.mode = envelope.mode;
  panelState.capabilities = envelope.capabilities;
  panelState.state = envelope.state;
  if (envelope.reason === undefined) {
    delete panelState.reason;
  } else {
    panelState.reason = envelope.reason;
  }
  panelState.log.unshift(reason);
  panelState.log = panelState.log.slice(0, 8);
}

async function broadcastState(reason: string): Promise<void> {
  panelState.log.unshift(reason);
  panelState.log = panelState.log.slice(0, 8);
  await panel.postMessage({
    type: "badgePanelState",
    snapshot: panelState,
  });
}

function resolveProgressState(value: unknown): BadgePanelEnvelope["state"]["progressState"] {
  if (
    value === "indeterminate" ||
    value === "normal" ||
    value === "paused" ||
    value === "error" ||
    value === "none"
  ) {
    return value;
  }
  return "none";
}

function resolveOverlayIcon(value: unknown): BadgePanelEnvelope["state"]["overlayIcon"] {
  if (value === "dot" || value === "alert" || value === "none") {
    return value;
  }
  return "none";
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function watchDockClickSignal(path: string, onClick: () => Promise<void>) {
  let active = true;
  const interval = setInterval(() => {
    if (!active) {
      return;
    }
    void access(path)
      .then(async () => {
        try {
          await unlink(path);
        } catch {
          // best-effort consumption of the click signal.
        }
        await onClick();
      })
      .catch(() => {
        // no click signal yet
      });
  }, 250);
  return {
    close() {
      active = false;
      clearInterval(interval);
    },
  };
}

async function ensureBadgeDockHelperAvailable(outputZip: string): Promise<void> {
  const helperSource = join(workspaceRoot, "packages/ext-badge-darwin-arm64/app/main.swift");
  await access(helperSource);
  await new Promise<void>((resolve, reject) => {
    const child = spawn("bash", ["scripts/release/build-badge-dock-helper.sh", outputZip], {
      cwd: workspaceRoot,
      stdio: process.env.OPENTRAY_EXT_BUILD_LOGS === "1" ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`build-badge-dock-helper.sh failed with code ${code ?? "unknown"}`));
    });
  });
}

async function extractBadgeDockHelper(outputZip: string, outputDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ditto", ["-x", "-k", outputZip, outputDir], {
      stdio: process.env.OPENTRAY_EXT_BUILD_LOGS === "1" ? "inherit" : "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ditto -x -k ${outputZip} ${outputDir} failed with code ${code ?? "unknown"}`));
    });
  });
}

async function ensureBadgeDockHelperBundle(outputDir: string, outputBundle: string): Promise<void> {
  await access(join(outputDir, "OpenTrayBadgeHelper.app", "Contents", "MacOS", "OpenTrayBadgeHelper"));
  await access(join(outputDir, "OpenTrayBadgeHelper.app", "Contents", "Info.plist"));
  await access(join(outputDir, "OpenTrayBadgeHelper.app"));
  await access(outputBundle);
}

async function prepareBadgeDockStateFiles(): Promise<void> {
  await mkdir(dockHelperStateDir, { recursive: true });
}

async function syncBadgeDockHelper(envelope: BadgePanelEnvelope): Promise<void> {
  await prepareBadgeDockStateFiles();
  await writeFile(dockHelperBadgePath, `${envelope.state.badgeText}\n`, "utf8");
  await writeFile(dockHelperTitlePath, `OpenTray Badge\n`, "utf8");
  await writeFile(dockHelperIconNamePath, resolveDockIconName(envelope), "utf8");
}

async function signalBadgeDockHelperQuit(): Promise<void> {
  await writeFile(dockHelperQuitSignalPath, `${Date.now()}\n`, "utf8").catch(() => undefined);
}

async function launchBadgeDockHelper(outputBundle: string, forceMultiOpen: boolean): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "open",
      [
        ...(forceMultiOpen ? ["-n"] : []),
        "-a",
        outputBundle,
        "--args",
        ...(forceMultiOpen ? ["--force-multi-open"] : []),
        "--title",
        "OpenTray Badge",
        "--badge",
        panelState.state.badgeText,
        "--icon-name",
        resolveDockIconName(panelState),
        "--state-dir",
        dockHelperStateDir,
        "--badge-path",
        dockHelperBadgePath,
        "--title-path",
        dockHelperTitlePath,
        "--icon-path",
        dockHelperIconNamePath,
        "--quit-signal",
        dockHelperQuitSignalPath,
        "--quit-notify",
        dockHelperQuitNotifyPath,
        "--click-signal",
        dockClickSignalPath,
      ],
      {
        stdio: process.env.OPENTRAY_EXT_BUILD_LOGS === "1" ? "inherit" : "ignore",
        detached: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`open ${outputBundle} failed with code ${code ?? "unknown"}`));
    });
  });
}

function resolveDockIconName(envelope: BadgePanelEnvelope): string {
  if (envelope.state.attention) {
    return "exclamationmark.triangle.fill";
  }
  if (envelope.state.overlayIcon === "alert") {
    return "bell.badge.fill";
  }
  if (envelope.state.overlayIcon === "dot") {
    return "bell.badge";
  }
  return "bell";
}

function watchDockQuitSignal(path: string, onQuit: () => Promise<void>) {
  let active = true;
  const interval = setInterval(() => {
    if (!active) {
      return;
    }
    void access(path)
      .then(async () => {
        try {
          await unlink(path);
        } catch {
          // best-effort consumption of the quit notification.
        }
        await onQuit();
      })
      .catch(() => {
        // no quit notification yet
      });
  }, 250);
  return {
    close() {
      active = false;
      clearInterval(interval);
    },
  };
}
