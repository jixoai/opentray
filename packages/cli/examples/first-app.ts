import { createTray } from "../src/index";

const tray = await createTray({
  id: "com.example.first-app",
  icon: { "text-only": "OT" },
  menu: { items: [{ type: "item", id: 1, title: "Quit", primaryEvent: true }] },
}, {
  appId: "com.example.first-app",
  appName: "First App",
});

tray.onMenuClick(({ itemId }) => void (itemId === 1 && tray.destroy()));
