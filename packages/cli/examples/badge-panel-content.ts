import type { BadgeCapabilityFamily, BadgePanelEnvelope, BadgePlatform } from "../../ext-badge/src/index";

export type { BadgeCapabilityFamily, BadgePanelEnvelope, BadgePlatform };

export function createBadgePanelHtml(platform: BadgePlatform): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <title>OpenTray Badge Debug Panel</title>
    <style>
      :root {
        color: rgba(248, 250, 252, 0.96);
        background: transparent;
        font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        color: rgba(248, 250, 252, 0.96);
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        z-index: 0;
        background: linear-gradient(180deg, rgba(15, 23, 42, 0.16), rgba(15, 23, 42, 0.04));
      }
      body > * {
        position: relative;
        z-index: 1;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 44px;
        padding: 12px 12px 8px;
        user-select: none;
      }
      main {
        display: grid;
        grid-template-columns: minmax(224px, 0.95fr) minmax(260px, 1.05fr);
        gap: 12px;
        min-height: 0;
        overflow: hidden;
        padding: 0 12px 12px;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        padding: 0 12px 12px;
      }
      .summary .tile {
        display: grid;
        gap: 4px;
        min-width: 0;
        padding: 10px 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.24);
        box-shadow: 0 8px 24px rgba(2, 6, 23, 0.08);
      }
      .summary .tile .k {
        color: rgba(226, 232, 240, 0.72);
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .summary .tile .v {
        min-width: 0;
        font-size: 18px;
        font-weight: 700;
        line-height: 1.1;
        word-break: break-word;
      }
      .title {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-weight: 700;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: linear-gradient(135deg, #7dd3fc, #a78bfa);
      }
      .toolbar, .choices {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      button, input, select {
        border: 0;
        border-radius: 8px;
        padding: 7px 10px;
        color: inherit;
        background: rgba(255, 255, 255, 0.1);
        font: inherit;
      }
      button:hover {
        background: rgba(255, 255, 255, 0.16);
      }
      input {
        min-width: 0;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(248, 250, 252, 0.9);
        font-size: 11px;
      }
      .panel {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 8px;
        min-height: 0;
        padding: 10px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.24);
        box-shadow: 0 8px 24px rgba(2, 6, 23, 0.08);
      }
      .label {
        color: rgba(226, 232, 240, 0.72);
        font-size: 11px;
        text-transform: uppercase;
        font-weight: 600;
      }
      .stack {
        display: grid;
        gap: 10px;
        min-height: 0;
        overflow: auto;
      }
      .row {
        display: grid;
        gap: 6px;
      }
      .hint {
        color: rgba(148, 163, 184, 0.88);
        font-size: 11px;
      }
      .row label {
        color: rgba(226, 232, 240, 0.82);
        font-size: 12px;
        font-weight: 600;
      }
      .field {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
      }
      .field button {
        white-space: nowrap;
      }
      pre {
        margin: 0;
        min-height: 0;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font: 11px/1.45 ui-monospace, "SFMono-Regular", Consolas, monospace;
        color: rgba(248, 250, 252, 0.94);
      }
      @media (max-width: 640px) {
        .summary {
          grid-template-columns: 1fr 1fr;
        }
        main {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header id="drag-region">
      <div class="title"><span class="dot"></span><span>Badge Debug Panel</span></div>
      <div class="toolbar">
        <span class="badge" id="platform">${platform}</span>
        <span class="badge" id="mode">pending</span>
        <button data-action="refresh">Refresh</button>
        <button data-action="reset">Reset</button>
        <button data-action="hide">Hide</button>
      </div>
    </header>
    <section class="summary">
      <div class="tile">
        <div class="k">Badge</div>
        <div class="v" id="summaryBadge">12</div>
      </div>
      <div class="tile">
        <div class="k">Progress</div>
        <div class="v" id="summaryProgress">64 / 100</div>
      </div>
      <div class="tile">
        <div class="k">Overlay</div>
        <div class="v" id="summaryOverlay">dot</div>
      </div>
      <div class="tile">
        <div class="k">Attention</div>
        <div class="v" id="summaryAttention">off</div>
      </div>
    </section>
    <main>
      <section class="panel">
        <div class="label">Badge Controls</div>
        <div class="stack">
          <div class="row">
            <label for="badgeText">Badge text / count</label>
            <div class="field">
              <input id="badgeText" value="12" maxlength="8" />
              <button data-action="set-badge">Set</button>
            </div>
          </div>
          <div class="row">
            <label for="progress">Progress</label>
            <div class="field" data-progress-control-group>
              <input id="progress" type="number" min="0" max="100" value="64" />
              <button data-action="set-progress">Set</button>
            </div>
            <div class="hint" id="progressHint">Progress capability pending.</div>
          </div>
          <div class="row">
            <label for="progressState">Progress state</label>
            <div class="field" data-progress-control-group>
              <select id="progressState">
                <option value="none">none</option>
                <option value="indeterminate">indeterminate</option>
                <option value="normal" selected>normal</option>
                <option value="paused">paused</option>
                <option value="error">error</option>
              </select>
              <button data-action="set-progress-state">Set</button>
            </div>
            <div class="hint" id="progressStateHint">Progress state capability pending.</div>
          </div>
          <div class="choices">
            <button data-action="set-overlay" data-value="none">Overlay none</button>
            <button data-action="set-overlay" data-value="dot">Overlay dot</button>
            <button data-action="set-overlay" data-value="alert">Overlay alert</button>
            <button data-action="toggle-attention">Toggle attention</button>
            <button data-action="clear-badge">Clear badge</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="label">Contract State</div>
        <pre id="state">Waiting for host state...</pre>
      </section>
    </main>
    <script>
      const hostIpc = navigator.opentray?.ipc;
      const dragRegion = document.getElementById("drag-region");
      const mode = document.getElementById("mode");
      const stateNode = document.getElementById("state");
      const badgeText = document.getElementById("badgeText");
      const progress = document.getElementById("progress");
      const progressState = document.getElementById("progressState");
      const progressHint = document.getElementById("progressHint");
      const progressStateHint = document.getElementById("progressStateHint");
      const progressControlGroups = Array.from(document.querySelectorAll("[data-progress-control-group]"));
      const summaryBadge = document.getElementById("summaryBadge");
      const summaryProgress = document.getElementById("summaryProgress");
      const summaryOverlay = document.getElementById("summaryOverlay");
      const summaryAttention = document.getElementById("summaryAttention");

      const sendHostIntent = async (payload) => {
        if (!hostIpc?.postMessage) {
          stateNode.textContent = "navigator.opentray.ipc is unavailable";
          return;
        }
        await hostIpc.postMessage(payload);
      };

      dragRegion?.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button, input, select")) return;
        const bridge = navigator.window || navigator.opentrayWindow;
        if (!bridge?.startAppRegionDrag) return;
        void bridge.startAppRegionDrag({ pointerId: event.pointerId });
      });

      document.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.dataset.action;
          if (!action) return;
          if (action === "set-badge") {
            void sendHostIntent({ type: "badge:set", value: badgeText.value });
            return;
          }
          if (action === "set-progress") {
            void sendHostIntent({ type: "progress:set", value: Number(progress.value) });
            return;
          }
          if (action === "set-progress-state") {
            void sendHostIntent({ type: "progress:state", value: progressState.value });
            return;
          }
          if (action === "set-overlay") {
            void sendHostIntent({ type: "overlay:set", value: button.dataset.value ?? "none" });
            return;
          }
          if (action === "toggle-attention") {
            void sendHostIntent({ type: "attention:toggle" });
            return;
          }
          if (action === "clear-badge") {
            void sendHostIntent({ type: "badge:clear" });
            return;
          }
          void sendHostIntent({ type: action });
        });
      });

      window.addEventListener("message", (event) => {
        if (event.data?.type !== "badgePanelState") return;
        const snapshot = event.data.snapshot;
        mode.textContent = snapshot.mode + "/" + snapshot.platform;
        stateNode.textContent = JSON.stringify(snapshot, null, 2);
        badgeText.value = String(snapshot.state.badgeText ?? "");
        progress.value = String(snapshot.state.progressValue ?? 0);
        progressState.value = String(snapshot.state.progressState ?? "none");
        const progressSupported = snapshot.capabilities.progress !== "unsupported";
        for (const group of progressControlGroups) {
          group.querySelectorAll("input, select, button").forEach((control) => {
            control.disabled = !progressSupported;
          });
        }
        progressHint.textContent = progressSupported
          ? "Progress capability: " + snapshot.capabilities.progress
          : "Progress is unsupported on this host.";
        progressStateHint.textContent = progressSupported
          ? "Progress state capability: " + snapshot.capabilities.progress
          : "Progress state is unsupported on this host.";
        summaryBadge.textContent = snapshot.state.badgeText ? snapshot.state.badgeText : "none";
        summaryProgress.textContent = String(snapshot.state.progressValue ?? 0) + " / " + String(snapshot.state.progressMax ?? 100);
        summaryOverlay.textContent = snapshot.state.overlayIcon ?? "none";
        summaryAttention.textContent = snapshot.state.attention ? "on" : "off";
      });
    </script>
  </body>
</html>`;
}
