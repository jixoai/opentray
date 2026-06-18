import type { WebviewPlacement, WebviewWindowStylePatch } from "../../ext-webview/src/index";

export function createPlacementStyle(platform: NodeJS.Platform): WebviewWindowStylePatch {
  return {
    frameless: true,
    keepOnTop: true,
    background: { kind: "semantic", token: "blur", state: "active" },
    platform: platform === "win32" ? { windows: { cornerPreference: "round" } } : {},
  };
}

export function createPlacementHtml(placements: readonly WebviewPlacement[]): string {
  const watchButtons = placements.map((placement) => placementButton("watch", placement)).join("");
  const onceButtons = placements.map((placement) => placementButton("once", placement)).join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <title>OpenTray Placement Kit</title>
    <style>
      :root {
        color: rgba(248, 250, 249, 0.96);
        background: transparent;
        font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }
      body {
        display: flex;
        flex-direction: column;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 42px;
        padding: 12px 12px 8px;
        user-select: none;
      }
      main {
        display: grid;
        grid-template-columns: minmax(172px, 0.95fr) minmax(180px, 1.05fr);
        gap: 10px;
        min-height: 0;
        overflow: hidden;
        padding: 0 12px 12px;
      }
      .title {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-weight: 700;
      }
      .dot {
        flex: 0 0 auto;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(135deg, #8df7c7, #6aa8ff);
      }
      .actions, .button-grid {
        display: flex;
        gap: 7px;
        flex-wrap: wrap;
      }
      .button-grid {
        align-content: start;
        overflow: auto;
        scrollbar-width: thin;
      }
      button {
        border: 0;
        border-radius: 8px;
        padding: 7px 9px;
        color: inherit;
        background: rgba(255, 255, 255, 0.1);
        font: inherit;
      }
      button:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      .panel {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 8px;
        min-height: 0;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 10px;
        background: rgba(17, 24, 39, 0.28);
      }
      .label {
        color: rgba(218, 228, 224, 0.72);
        font-size: 11px;
        text-transform: uppercase;
      }
      pre {
        margin: 0;
        min-height: 0;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font: 11px/1.45 ui-monospace, "SFMono-Regular", Consolas, monospace;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(248, 250, 249, 0.84);
        font-size: 11px;
      }
      @media (max-width: 430px) {
        main {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header id="drag-region">
      <div class="title"><span class="dot"></span><span>Placement Kit</span></div>
      <div class="actions">
        <span class="badge" id="mode">watch:tray</span>
        <button data-action="refresh">Refresh</button>
        <button data-action="stop">Stop</button>
        <button data-action="hide">Hide</button>
      </div>
    </header>
    <main>
      <section class="panel">
        <div class="label">Watch</div>
        <div class="button-grid">${watchButtons}</div>
      </section>
      <section class="panel">
        <div class="label">Apply Once</div>
        <div class="button-grid">${onceButtons}</div>
      </section>
      <section class="panel">
        <div class="label">Placement Result</div>
        <pre id="placement">Waiting...</pre>
      </section>
      <section class="panel">
        <div class="label">Window Bounds</div>
        <pre id="bounds">Waiting...</pre>
      </section>
    </main>
    <script>
      const pageWindow = navigator.window || navigator.opentrayWindow;
      const hostIpc = navigator.opentray?.ipc;
      const dragRegion = document.getElementById("drag-region");
      const mode = document.getElementById("mode");
      const placement = document.getElementById("placement");
      const bounds = document.getElementById("bounds");

      const sendHostIntent = async (payload) => {
        if (!hostIpc?.postMessage) {
          bounds.textContent = "navigator.opentray.ipc is unavailable";
          return;
        }
        await hostIpc.postMessage(payload);
      };

      dragRegion?.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button") || !pageWindow?.startAppRegionDrag) return;
        void sendHostIntent({ type: "windowInteraction", active: true });
        void pageWindow.startAppRegionDrag({ pointerId: event.pointerId }).catch(() => {
          void sendHostIntent({ type: "windowInteraction", active: false });
        });
      });

      document.querySelectorAll("[data-placement]").forEach((button) => {
        button.addEventListener("click", () => {
          void sendHostIntent({
            type: button.dataset.action,
            placement: button.dataset.placement,
          });
        });
      });

      document.querySelectorAll("[data-action='refresh'], [data-action='stop'], [data-action='hide']").forEach((button) => {
        button.addEventListener("click", () => {
          void sendHostIntent({ type: button.dataset.action });
        });
      });

      window.addEventListener("message", (event) => {
        if (event.data?.type !== "placementKitState") return;
        mode.textContent = event.data.mode;
        placement.textContent = JSON.stringify(event.data.placement, null, 2);
        bounds.textContent = JSON.stringify(event.data.bounds, null, 2);
      });
    </script>
  </body>
</html>`;
}

function placementButton(action: "watch" | "once", placement: WebviewPlacement): string {
  return `<button data-action="${action}" data-placement="${placement}">${placement}</button>`;
}
