// Live appMode demo: a real desktop window + Dock participation with the
// synthesized default glyph icon. appIcon is never declared — the daemon
// materializes the bundle and synthesizes the 笔记工具 first-letter glyph.
//
// Run it yourself:
//   node /Users/kzf/Dev/GitHub/jixoai-labs/opentray/.worktree/shared-icon-kernel/openspec/changes/shared-icon-kernel/demos/demo-window.mjs
const ROOT = "/Users/kzf/Dev/GitHub/jixoai-labs/opentray/.worktree/shared-icon-kernel";
process.env.OPENTRAY_HOME ??= "/tmp/opentray-icon-demo/home-window";
process.env.OPENTRAY_BROKER_BIN ??= `${ROOT}/target/debug/opentray`;

const { createTray } = await import(`${ROOT}/packages/cli/dist/index.mjs`);
const { WebviewExt } = await import(`${ROOT}/packages/ext-webview/dist/index.mjs`);

const base = await createTray(
  {
    id: "demo.opentray.window",
    icon: { "text-only": "图标演示" },
    menu: {
      items: [
        { title: "Quit", primaryEvent: true, onMenuClick: () => process.exit(0) },
      ],
    },
  },
  {
    appId: "demo.opentray.window",
    appName: "笔记工具",
    appBundle: { path: "/tmp/opentray-icon-demo/WindowDemo.app" },
  },
);
const tray = base.extend(WebviewExt);

const win = tray.createWebviewWindow({
  title: "笔记工具",
  width: 520,
  height: 400,
  html: `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "PingFang SC", sans-serif; display: grid;
         place-items: center; height: 100vh; margin: 0;
         background: #f5f5f7; color: #1d1d1f; text-align: center; }
  .tile { width: 128px; height: 128px; border-radius: 28.6%;
          background: #0A84FF; color: #fff; display: grid; place-items: center;
          font-size: 74px; font-weight: 600; }
  h1 { font-size: 17px; margin: 18px 0 6px; }
  p { font-size: 13px; opacity: .65; margin: 0; max-width: 380px; }
</style></head>
<body><div>
  <div class="tile">笔</div>
  <h1>笔记工具 — 默认图标演示</h1>
  <p>本应用从未声明 appIcon。运行时在物化 bundle 时自动合成了首字母 glyph 图标 —— 看 Dock。</p>
</div></body></html>`,
  style: { appMode: true },
});

await win.show();
console.log("window + Dock tile live; auto-exit in 10 min");
setTimeout(() => process.exit(0), 600_000);
