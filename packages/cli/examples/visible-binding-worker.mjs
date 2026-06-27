import { parentPort } from "node:worker_threads";

import { createClient } from "../dist/index.mjs";
import { createRuntimeBindingTransport } from "../dist/node.mjs";

parentPort.postMessage("online");

parentPort.once("message", async (message) => {
  if (message !== "start") {
    return;
  }

  const startDelayMs = Number(
    process.env.OPENTRAY_VISIBLE_BINDING_START_DELAY_MS ?? "1200"
  );
  await new Promise((resolve) => setTimeout(resolve, startDelayMs));

  const connection = await createRuntimeBindingTransport({
    packageVersion: "0.9.0-example",
    appId: "com.opentray.visible-binding-example",
    appName: "OpenTray Visible Binding Example",
  });
  const tray = await createClient(connection).createTray({
    id: "status",
    icon: createVisibleTrayIcon(),
    tooltip: {
      title: "OpenTray",
      description: "Visible binding example",
    },
    menu: {
      items: [{ type: "item", id: 1, title: "Quit", primaryEvent: true }],
    },
  });
  console.log(`visible binding tray created: ${tray.trayId}`);

  tray.onMenuClick(async ({ itemId }) => {
    if (itemId === 1) {
      await connection.close();
      console.log("visible binding connection closed");
    }
  });

  if (process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS !== undefined) {
    setTimeout(() => {
      void connection.close().then(() => {
        console.log("visible binding connection closed");
      });
    }, Number(process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS));
  }
});

function createVisibleTrayIcon() {
  const width = 32;
  const height = 32;
  const data = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const inRing = distance >= 9 && distance <= 14;
      const inCore = distance <= 5;
      const inNeedle =
        Math.abs(dx + dy) <= 1.2 && x >= 9 && x <= 23 && y >= 9 && y <= 23;

      if (inRing || inCore || inNeedle) {
        data.push(
          inCore ? 255 : 24,
          inNeedle ? 240 : 132,
          inRing ? 72 : 96,
          255
        );
      } else {
        data.push(0, 0, 0, 0);
      }
    }
  }

  return { type: "rgba", width, height, data };
}
