// Controlled win32 dialog defect repro (2026-09-22 interactive-desktop walk):
// 1. alert (TaskDialog/MessageBox path) — expect: dialog_presentation_failed?
// 2. confirm — same family.
// 3. pickFile (IFileDialog) — expect: Show-entry, no visible dialog, broker dies?
// Runs its own caller home/label so it never touches the panel's broker.

import { createTray } from "../src/sdk";
import { attachDialog } from "../../ext-dialog/src/index";
import { prepareExampleBrokerBinary } from "./_support/example-runtime-mode";

await prepareExampleBrokerBinary(import.meta.url);

const tray = await createTray(
  {
    id: "com.example.opentray.dialog-repro",
    icon: { "text-only": "DR" },
    tooltip: { title: "Dialog Repro", description: "win32 defect repro" },
    menu: {
      items: [
        { type: "item", id: 1, title: "Run: alert", primaryEvent: true },
        { type: "item", id: 2, title: "Run: confirm" },
        { type: "item", id: 3, title: "Run: pickFile" },
        { type: "item", id: 4, title: "Run: pickDirectory" },
        { type: "item", id: 9, title: "Quit" },
      ],
    },
  },
  {
    appId: "com.example.opentray.dialog-repro",
    appName: "Dialog Repro",
  },
);
const dialog = attachDialog(tray);
tray.onTransportStateChange?.((state) => {
  console.log(`[${new Date().toISOString()}] transport: ${state}`);
});

const run = async (name: string, fn: () => Promise<unknown>) => {
  console.log(`\n===== ${name} start [${new Date().toISOString()}]`);
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`===== ${name} RESOLVED in ${Date.now() - started}ms: ${JSON.stringify(result)}`);
  } catch (error) {
    console.log(`===== ${name} THREW in ${Date.now() - started}ms: ${String(error)}`);
  }
};

tray.onMenuClick(({ itemId }) => {
  if (itemId === 9) {
    void tray.destroy();
    return;
  }
  if (itemId === 1) {
    void run("alert", () => dialog.alert("If you can read this, the message-dialog path works."));
  }
  if (itemId === 2) {
    void run("confirm", () => dialog.confirm("Confirm dialog body."));
  }
  if (itemId === 3) {
    void run("pickFile", () => dialog.pickFile({}));
  }
  if (itemId === 4) {
    void run("pickDirectory", () => dialog.pickDirectory({}));
  }
});

console.log(`[${new Date().toISOString()}] dialog repro ready — tray icon: DR`);
