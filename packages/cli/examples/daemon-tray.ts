import { createClient } from "../src/index";
import { connectLocalBroker } from "../src/node";

const connection = await connectLocalBroker();
const client = createClient(connection, { requestIdPrefix: "daemon-example" });

connection.onEvent((frame) => {
  console.log(`broker -> client ${JSON.stringify(frame)}`);
  if (frame.type === "event" && frame.event.type === "menuClick" && frame.event.itemId === 99) {
    void shutdown();
  }
});

const surface = await client.createSurface({
  appId: "com.example.opentray.daemon",
  title: "OpenTray Daemon Example",
  default: true,
});
console.log(`surface: ${JSON.stringify(surface.surface)}`);

const tray = await surface.createTray({
  trayId: "daemon-status",
  title: "OpenTray",
  tooltip: {
    title: "OpenTray",
    description: "Daemon-created tray",
  },
  icon: {
    type: "rgba",
    width: 1,
    height: 1,
    data: [16, 128, 96, 255],
  },
  menu: {
    items: [
      { type: "item", id: 1, title: "Daemon Tray Event" },
      { type: "separator" },
      { type: "item", id: 99, title: "Quit Example" },
    ],
  },
});
console.log(`tray: ${tray.trayId}`);
console.log("open the system tray item and choose a menu item to see routed events");

const exitAfter = process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS;
let exitTimer: NodeJS.Timeout | undefined;
if (exitAfter !== undefined && exitAfter.length > 0) {
  const duration = Number.parseInt(exitAfter, 10);
  if (Number.isInteger(duration) && duration > 0) {
    exitTimer = setTimeout(() => {
      void shutdown();
    }, duration);
  }
}

let closed = false;
async function shutdown(): Promise<void> {
  if (closed) {
    return;
  }
  closed = true;
  if (exitTimer !== undefined) {
    clearTimeout(exitTimer);
  }
  await connection.close();
}
