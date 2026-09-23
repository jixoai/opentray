// Focused win32 notification repro (2026-09-23): notify is broker-bridged on
// win32 (NIM_MODIFY + NIF_INFO against the registered tray icon). This drives
// the exact production facade path and prints the typed outcome so the
// failing leg (bridge routing / channel resolution / native call / silent
// presentation) is observable.

import { createTray } from "../src/sdk";
import { attachNotification } from "../../ext-notification/src/index";
import { prepareExampleBrokerBinary } from "./_support/example-runtime-mode";

await prepareExampleBrokerBinary(import.meta.url);

const tray = await createTray(
  {
    id: "com.example.opentray.notify-repro",
    icon: { "text-only": "NR" },
    tooltip: { title: "Notify Repro", description: "win32 notification repro" },
    menu: {
      items: [
        { type: "item", id: 1, title: "Run: notify (title+body)", primaryEvent: true },
        { type: "item", id: 2, title: "Run: notify (silent)" },
        { type: "item", id: 3, title: "Run: authorization status" },
        { type: "item", id: 9, title: "Quit" },
      ],
    },
  },
  {
    appId: "com.example.opentray.notify-repro",
    appName: "Notify Repro",
  },
);
const notification = attachNotification(tray);
tray.onTransportStateChange?.((state) => {
  console.log(`[${new Date().toISOString()}] transport: ${state}`);
});

const run = async (name: string, fn: () => Promise<unknown>) => {
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`[${new Date().toISOString()}] ${name}: RESOLVED in ${Date.now() - started}ms ${JSON.stringify(result)}`);
  } catch (error) {
    console.log(`[${new Date().toISOString()}] ${name}: THREW in ${Date.now() - started}ms ${String(error)}`);
  }
};

tray.onMenuClick(({ itemId }) => {
  if (itemId === 9) {
    void tray.destroy();
    return;
  }
  if (itemId === 1) {
    void run("notify", () =>
      notification.notify({ title: "OpenTray notify repro", body: "If you can read this banner, the bridge works." }),
    );
  }
  if (itemId === 2) {
    void run("notify-silent", () =>
      notification.notify({ title: "Silent repro", body: "No sound should play.", silent: true }),
    );
  }
  if (itemId === 3) {
    void run("authorization", () => notification.getAuthorizationStatus());
  }
});

console.log(`[${new Date().toISOString()}] notify repro ready — tray icon: NR`);

// Auto-drive one full round at startup so the failing leg is observable in
// the log without human input; the menu re-runs each case on demand.
await run("authorization", () => notification.getAuthorizationStatus());
await run("notify", () =>
  notification.notify({ title: "OpenTray notify repro", body: "If you can read this banner, the bridge works." }),
);
await run("notify-silent", () =>
  notification.notify({ title: "Silent repro", body: "No sound should play.", silent: true }),
);
console.log(`[${new Date().toISOString()}] auto round complete — menu items re-run each case`);
