export function createMediaQueryHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <title>OpenTray Media Query Kit</title>
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
        grid-template-rows: auto minmax(0, 1fr);
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
        background: linear-gradient(135deg, #ffd166, #6aa8ff);
      }
      .actions, .buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
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
      section {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
        min-height: 0;
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
    </style>
  </head>
  <body>
    <header id="drag-region">
      <div class="title"><span class="dot"></span><span>Media Query Kit</span></div>
      <div class="actions">
        <span class="badge" id="mode">pending</span>
        <button data-action="refresh">Refresh</button>
        <button data-action="hide">Hide</button>
      </div>
    </header>
    <main>
      <div class="buttons">
        <button data-width="360" data-height="260">Compact</button>
        <button data-width="480" data-height="300">Comfort</button>
        <button data-width="640" data-height="340">Wide</button>
        <button data-width="460" data-height="430">Tall</button>
      </div>
      <section>
        <div class="panel">
          <div class="label">Matched State</div>
          <pre id="state">Waiting...</pre>
        </div>
        <div class="panel">
          <div class="label">Native Bounds</div>
          <pre id="bounds">Waiting...</pre>
        </div>
      </section>
    </main>
    <script>
      const pageWindow = navigator.window || navigator.opentrayWindow;
      const hostIpc = navigator.opentray?.ipc;
      const dragRegion = document.getElementById("drag-region");
      const mode = document.getElementById("mode");
      const state = document.getElementById("state");
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

      document.querySelectorAll("[data-width][data-height]").forEach((button) => {
        button.addEventListener("click", () => {
          void sendHostIntent({
            type: "resize",
            width: Number(button.dataset.width),
            height: Number(button.dataset.height),
          });
        });
      });

      document.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
          void sendHostIntent({ type: button.dataset.action });
        });
      });

      window.addEventListener("message", (event) => {
        if (event.data?.type !== "mediaQueryKitState") return;
        mode.textContent = event.data.widthMode + "/" + event.data.heightMode;
        state.textContent = JSON.stringify(
          {
            widthMode: event.data.widthMode,
            heightMode: event.data.heightMode,
            watchActive: event.data.watchActive,
          },
          null,
          2,
        );
        bounds.textContent = JSON.stringify(event.data.bounds, null, 2);
      });
    </script>
  </body>
</html>`;
}
