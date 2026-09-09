// Live demo: real createTray + real broker + default glyph icon synthesis.
// The menu bar shows a live tray; the daemon materializes LiveDemo.app with
// the synthesized first-letter glyph icon (appIcon omitted on purpose).
// Env: OPENTRAY_HOME (temp), OPENTRAY_BROKER_BIN (worktree cargo build).
import { createTray } from "/Users/kzf/Dev/GitHub/jixoai-labs/opentray/.worktree/shared-icon-kernel/packages/cli/dist/index.mjs";

const tray = await createTray(
  {
    id: "demo.opentray.icon",
    icon: { "text-only": "图标演示" },
    menu: {
      items: [
        {
          title: "Quit",
          primaryEvent: true,
          onMenuClick: () => process.exit(0),
        },
        "-",
        ["About", ["Default glyph icon — shared-icon-kernel demo"]],
      ],
    },
  },
  {
    appId: "demo.opentray.icon",
    appName: "笔记工具",
    appBundle: { path: "/tmp/opentray-icon-demo/LiveDemo.app" },
  },
);

console.log("tray is live (menu bar: 图标演示); auto-exit in 180s");
setTimeout(() => process.exit(0), 180_000);
