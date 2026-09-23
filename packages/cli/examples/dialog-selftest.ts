// Self-driving win32 dialog matrix (2026-09-22 solo iteration harness): no
// human input. A message dialog settles either as a typed error (printed) or
// by staying pending past `presentedMs` — "PRESENTED" is the success shape
// (a real modal is on screen); the tray is then destroyed and recreated so
// the next case starts from a clean scope (session close cancels the modal
// through the production close vector). Picker cases additionally exercise
// the broker-death path: their typed transport-closed rejection is printed
// alongside the supervision state edges.

import { createTray } from "../src/sdk";
import { attachDialog, type DialogCapability } from "../../ext-dialog/src/index";
import { prepareExampleBrokerBinary } from "./_support/example-runtime-mode";

await prepareExampleBrokerBinary(import.meta.url);

const APP = {
  id: "com.example.opentray.dialog-selftest",
  name: "Dialog Selftest",
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

let tray!: Awaited<ReturnType<typeof createTray>>;
let dialog!: DialogCapability;

const boot = async (): Promise<void> => {
  // The broker is single-session per caller: a recycled generation races
  // the old broker's exit. Retry the reconnect instead of failing on
  // OPENTRAY_BROKER_SINGLE_SESSION.
  for (let attempt = 0; ; attempt += 1) {
    try {
      tray = await createTray(
        {
          id: APP.id,
          icon: { "text-only": "DS" },
          tooltip: { title: "Dialog Selftest", description: "solo matrix" },
        },
        { appId: APP.id, appName: APP.name }
      );
      break;
    } catch (error) {
      const isSingleSession =
        error instanceof Error &&
        (("code" in error &&
          String((error as { code?: unknown }).code).includes("OPENTRAY_BROKER_SINGLE_SESSION")) ||
          String(error).includes("OPENTRAY_BROKER_SINGLE_SESSION"));
      if (attempt >= 10 || !isSingleSession) {
        throw error;
      }
      await sleep(1000);
    }
  }
  tray.onTransportStateChange?.((state) => {
    console.log(`[${new Date().toISOString()}] transport: ${state}`);
  });
  dialog = attachDialog(tray);
};

const settle = async (
  name: string,
  run: () => Promise<unknown>,
  presentedMs = 2500
): Promise<{ presented: boolean; line: string }> => {
  const started = Date.now();
  let settled = false;
  const attempt = run().then(
    (value) => {
      settled = true;
      return `${name}: RESOLVED in ${Date.now() - started}ms ${JSON.stringify(value)}`;
    },
    (error: unknown) => {
      settled = true;
      return `${name}: THREW in ${Date.now() - started}ms ${String(error)}`;
    }
  );
  await sleep(presentedMs);
  if (!settled) {
    return {
      presented: true,
      line: `${name}: PRESENTED (pending >${presentedMs}ms — real modal shape)`,
    };
  }
  return { presented: false, line: await attempt };
};

// A PRESENTED (or transport-dead) case leaves the scope dirty: destroy the
// tray (session close cancels any live modal through the close vector) and
// boot a fresh one so `dialog_session_busy` never masks the next case.
const recycle = async (): Promise<void> => {
  await tray.destroy().catch((error: unknown) => {
    console.log(`recycle destroy: ${String(error)}`);
  });
  await boot();
};

await boot();
for (const [name, run] of [
  ["alert", () => dialog.alert("selftest alert body")] as const,
  ["confirm", () => dialog.confirm("selftest confirm body")] as const,
  [
    "messageDialog-full",
    () =>
      dialog.messageDialog({
        message: "selftest full options",
        detail: "detail line",
        buttons: ["Alpha", "Beta", "Gamma"],
        defaultId: 1,
        cancelId: 2,
        severity: "warning",
      }),
  ] as const,
  ["pickFile", () => dialog.pickFile({})] as const,
  ["pickDirectory", () => dialog.pickDirectory({})] as const,
] as const) {
  const result = await settle(name, run);
  console.log(result.line);
  if (result.presented || /transport closed|transport_closed/.test(result.line)) {
    await recycle();
  }
}

await tray.destroy().catch(() => undefined);
console.log(`[${new Date().toISOString()}] selftest complete`);
process.exit(0);
