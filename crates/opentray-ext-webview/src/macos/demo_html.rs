pub(super) fn default_webview_html() -> String {
    r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OpenTray WebView</title>
    <style>
      body {
        margin: 0;
        color: #18220f;
        background: linear-gradient(135deg, #fff8e7 0%, #e9f0d8 100%);
        font: 15px ui-rounded, "SF Pro Rounded", "Avenir Next", sans-serif;
      }
      main {
        padding: 22px;
      }
      section {
        display: grid;
        gap: 12px;
      }
      .card {
        margin-top: 12px;
        border: 1px solid rgba(24, 34, 15, 0.16);
        border-radius: 14px;
        padding: 12px;
        background: rgba(255, 255, 255, 0.72);
      }
      .label {
        margin-bottom: 5px;
        color: #7b5b1d;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 8px 12px;
        color: #f8f3de;
        background: #2d654d;
        font: inherit;
      }
      code,
      pre {
        word-break: break-word;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenTray WebView</h1>
      <p>Dynamic extension runtime.</p>
      <section>
        <div class="card">
          <div class="label">navigator.window</div>
          <code id="navigator-status">Waiting for bootstrap.</code>
          <div class="actions">
            <button id="capabilities-button">Capabilities</button>
            <button id="frameless-button">Toggle Frameless</button>
            <button id="topmost-button">Topmost</button>
            <button id="material-button">Material</button>
            <button id="title-button">Title</button>
            <button id="screen-button">Screen</button>
            <button id="resize-button">Grow</button>
            <button id="move-button">Move</button>
            <button id="close-button">Close</button>
          </div>
        </div>
        <div class="card">
          <div class="label">postMessage</div>
          <code id="message-status">Waiting for a message.</code>
        </div>
        <div class="card">
          <div class="label">evaluate</div>
          <code id="eval-status">Waiting for script execution.</code>
        </div>
        <div class="card">
          <div class="label">events</div>
          <pre id="event-status">Waiting for native events.</pre>
        </div>
      </section>
    </main>
    <script>
      const formatError = (error) => {
        if (error && typeof error === "object") {
          const message = typeof error.message === "string" ? error.message : "";
          const code = typeof error.code === "string" ? error.code : "";
          if (code || message) {
            return [code ? `[${code}]` : "", message].filter(Boolean).join(" ");
          }
        }
        if (error instanceof Error) {
          return error.message || error.name;
        }
        if (typeof error === "string") {
          return error;
        }
        try {
          return JSON.stringify(error);
        } catch (_jsonError) {
          return String(error);
        }
      };
      window.addEventListener("message", (event) => {
        const target = document.getElementById("message-status");
        if (target) {
          target.textContent = JSON.stringify(event.data);
        }
      });
      window.__OPENTRAY_EVALUATE__ = (payload) => {
        const target = document.getElementById("eval-status");
        if (target) {
          target.textContent = JSON.stringify(payload);
        }
      };
      const navigatorStatus = document.getElementById("navigator-status");
      const eventStatus = document.getElementById("event-status");
      const pageWindow = navigator.window ?? navigator.opentrayWindow;
      const setNavigatorStatus = (value) => {
        if (navigatorStatus) {
          navigatorStatus.textContent = value;
        }
      };
      const loadNavigatorStatus = async () => {
        if (!pageWindow) {
          setNavigatorStatus("navigator.window is disabled for this page.");
          return;
        }
        try {
          setNavigatorStatus(JSON.stringify(await pageWindow.getCapabilities(), null, 2));
        } catch (error) {
          setNavigatorStatus(`Failed to load capabilities.\n${formatError(error)}`);
        }
      };
      const loadScreenDetails = async () => {
        const screenApi = navigator.screen ?? navigator.opentrayScreen;
        if (!screenApi) {
          setNavigatorStatus("navigator.screen is disabled for this page.");
          return;
        }
        try {
          setNavigatorStatus(JSON.stringify(await screenApi.getScreenDetails(), null, 2));
        } catch (error) {
          setNavigatorStatus(`Failed to load screen details.\n${formatError(error)}`);
        }
      };
      const loadStyle = async () => {
        if (!pageWindow) {
          setNavigatorStatus("navigator.window is disabled for this page.");
          return;
        }
        try {
          setNavigatorStatus(JSON.stringify(await pageWindow.getStyle(), null, 2));
        } catch (error) {
          setNavigatorStatus(`Failed to load style.\n${formatError(error)}`);
        }
      };
      if (!pageWindow) {
        setNavigatorStatus("navigator.window is disabled for this page.");
      } else {
        setNavigatorStatus("navigator.window is ready.");
        void loadNavigatorStatus();
        void pageWindow.listen("moved", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        void pageWindow.listen("resized", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        void pageWindow.listen("stylechange", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        void pageWindow.listen("titlechange", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        void pageWindow.listen("closed", (event) => {
          eventStatus.textContent = JSON.stringify(event, null, 2);
        });
        document.getElementById("capabilities-button")?.addEventListener("click", async () => {
          await loadNavigatorStatus();
        });
        document.getElementById("frameless-button")?.addEventListener("click", async () => {
          try {
            const style = await pageWindow.getStyle();
            await pageWindow.setStyle({ frameless: !style.frameless });
            await loadStyle();
          } catch (error) {
            setNavigatorStatus(`Failed to toggle frameless.\n${formatError(error)}`);
          }
        });
        document.getElementById("topmost-button")?.addEventListener("click", async () => {
          try {
            const style = await pageWindow.getStyle();
            await pageWindow.setStyle({ keepOnTop: !style.keepOnTop });
            await loadStyle();
          } catch (error) {
            setNavigatorStatus(`Failed to toggle topmost.\n${formatError(error)}`);
          }
        });
        document.getElementById("material-button")?.addEventListener("click", async () => {
          try {
            const style = await pageWindow.getStyle();
            const macos = style.platform?.macos ?? {};
            await pageWindow.setStyle({
              transparent: true,
              platform: {
                macos: {
                  material: macos.material ? null : "hudWindow",
                  materialState: "active",
                },
              },
            });
            await loadStyle();
          } catch (error) {
            setNavigatorStatus(`Failed to toggle material.\n${formatError(error)}`);
          }
        });
        document.getElementById("title-button")?.addEventListener("click", async () => {
          try {
            const title = "OpenTray WebView " + new Date().toLocaleTimeString();
            await pageWindow.setTitle(title);
            setNavigatorStatus(JSON.stringify({ title: await pageWindow.getTitle() }));
          } catch (error) {
            setNavigatorStatus(`Failed to update title.\n${formatError(error)}`);
          }
        });
        document.getElementById("screen-button")?.addEventListener("click", async () => {
          await loadScreenDetails();
        });
        document.getElementById("resize-button")?.addEventListener("click", () => {
          void pageWindow.resizeTo(520, 320).catch((error) => {
            setNavigatorStatus(`Failed to resize window.\n${formatError(error)}`);
          });
        });
        document.getElementById("move-button")?.addEventListener("click", () => {
          void pageWindow.moveTo(120, 120).catch((error) => {
            setNavigatorStatus(`Failed to move window.\n${formatError(error)}`);
          });
        });
        document.getElementById("close-button")?.addEventListener("click", () => {
          void pageWindow.close().catch((error) => {
            setNavigatorStatus(`Failed to close window.\n${formatError(error)}`);
          });
        });
      }
    </script>
  </body>
</html>"#
        .to_string()
}
