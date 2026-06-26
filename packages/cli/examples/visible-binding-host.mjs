import { Worker } from "node:worker_threads";

import { runVisibleRuntimeHost } from "../dist/node.mjs";

const worker = new Worker(
  new URL("./visible-binding-worker.mjs", import.meta.url),
  {
    type: "module",
  }
);

await new Promise((resolve, reject) => {
  worker.once("message", (message) => {
    if (message === "online") {
      resolve();
      return;
    }
    reject(
      new Error(`unexpected worker bootstrap message: ${String(message)}`)
    );
  });
  worker.once("error", reject);
});

worker.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
worker.on("exit", (code) => {
  if (code !== 0) {
    process.exitCode = code;
  }
});

worker.postMessage("start");

const workerExitAfterMs = Number(
  process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS ?? "0"
);

await runVisibleRuntimeHost({
  packageVersion: "0.9.0-example",
  appId: "com.opentray.visible-binding-example",
  appName: "OpenTray Visible Binding Example",
  autoExitAfterMs: workerExitAfterMs === 0 ? 0 : workerExitAfterMs + 1000,
});
