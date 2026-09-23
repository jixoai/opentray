// Orthogonal intents (2026-09-22; Windows supervised-recovery visual acceptance):
// 1. Exercise the zero-config supervised transport through the public
//    `createTray()` path — not the raw example runtime connection — so a real
//    broker kill heals in-process with zero consumer recovery code.
// 2. Exercise the retained-WebView settled-visibility contract (W4 amendment)
//    across recovery: a window hidden through `close()` must stay hidden.
// 3. Keep the retained-surface tray law: one primaryEvent item labeled with
//    the next action, menu synced from `visibleChange`, autoHide:false so
//    observation cannot dismiss the specimen.

import { createTray } from "../src/sdk";
import { WebviewExt } from "../../ext-webview/src/index";

import {
  createExamplePrimaryMenu,
  prepareLocalWebviewExtensionPath,
  syncExamplePrimaryMenu,
} from "./_support/webview-example-support";

const QUIT_ITEM_ID = 2;
const quitItem = { type: "item" as const, id: QUIT_ITEM_ID, title: "Quit" };

const localWebviewExtension = await prepareLocalWebviewExtensionPath(
  import.meta.url
);
if (localWebviewExtension !== undefined) {
  console.log(`extension artifact: ${localWebviewExtension}`);
}

const tray = await createTray(
  {
    id: "com.example.opentray.webview-recovery",
    icon: { "text-only": "OT" },
    tooltip: {
      title: "Webview Recovery Specimen",
      description: "Kill the broker; the app must heal itself.",
    },
    menu: createExamplePrimaryMenu({
      visible: true,
      trailingItems: [quitItem],
    }),
  },
  {
    appId: "com.example.opentray.webview-recovery",
    appName: "Webview Recovery",
  },
);

// W6/W4 state projection: healthy -> recovering -> healthy edges (the initial
// healthy never fires) and the terminal `abandoned` after budget exhaustion.
tray.onTransportStateChange?.((state) => {
  console.log(`[${new Date().toISOString()}] transport: ${state}`);
});

const webview = tray
  .extend(WebviewExt, {
    // Source-dev law: the freshly built source-tree DLL is the exact artifact
    // — the workspace-linked platform package snapshot may be stale.
    ...(localWebviewExtension === undefined
      ? {}
      : {
          artifact: {
            kind: "file" as const,
            path: localWebviewExtension,
            identitySource: WebviewExt.artifact,
          },
        }),
  })
  .createWebviewWindow({
  title: "Recovery Specimen",
  width: 520,
  height: 340,
  html: `<!doctype html>
<meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.6 system-ui, sans-serif; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .mount { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .clock { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .hint { opacity: 0.75; }
</style>
<h1>OpenTray supervised-recovery specimen</h1>
<p>This page mounted at <span class="mount" id="mount"></span></p>
<p>Page clock (ticks while alive): <span class="clock" id="clock"></span></p>
<p class="hint">
  A broker kill recreates this window: a fresh mount time proves the reload.
  A window hidden before the kill must stay hidden after recovery.
</p>
<script>
  document.getElementById("mount").textContent = new Date().toLocaleTimeString();
  const clock = document.getElementById("clock");
  const tick = () => {
    const now = new Date().toLocaleTimeString();
    clock.textContent = now;
    document.title = "alive " + now;
  };
  tick();
  setInterval(tick, 1000);
</script>`,
  titleSync: {
    documentToWindow: true,
  },
  style: {
    autoHide: false,
  },
});

await webview.show();

// Retained-surface law: subscribe to native window events only after the
// first successful show; the menu projects the operational visibility.
let visible = true;
const stopVisibleChange = webview.listen("visibleChange", ({ payload }) => {
  visible = payload.visible;
  console.log(
    `[${new Date().toISOString()}] window visibleChange: ${payload.visible}`
  );
  void syncExamplePrimaryMenu(tray, {
    visible: payload.visible,
    trailingItems: [quitItem],
  }).catch((error: unknown) => {
    console.error("failed to sync primary menu:", error);
  });
});
await syncExamplePrimaryMenu(tray, {
  visible: true,
  trailingItems: [quitItem],
});

let quitting = false;
const quit = async (): Promise<void> => {
  if (quitting) {
    return;
  }
  quitting = true;
  stopVisibleChange();
  await webview.destroy();
  await tray.destroy();
};

tray.onMenuClick(({ itemId }) => {
  if (itemId === QUIT_ITEM_ID) {
    void quit();
    return;
  }
  void (async () => {
    const isVisible = await webview.isVisible();
    await (isVisible ? webview.close() : webview.toVisible());
  })().catch((error: unknown) => {
    console.error("primary action failed:", error);
  });
});

console.log(
  `[${new Date().toISOString()}] specimen ready — hide via the tray primary item, then taskkill the opentray broker`
);
