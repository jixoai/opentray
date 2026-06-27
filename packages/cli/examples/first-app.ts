import { runTrayApp } from "../src/node";

await runTrayApp(async ({ createTray }) => {
  const tray = await createTray({
    id: "com.example.first-app",
    icon: { "text-only": "OT" },
    menu: { items: [{ type: "item", id: 1, title: "Quit", primaryEvent: true }] },
  });
  tray.onMenuClick(({ itemId }) => void (itemId === 1 && tray.destroy()));
}, { autoExitAfterMs: 1500 });
