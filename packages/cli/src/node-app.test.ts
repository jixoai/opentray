import { describe, expect, it } from "vitest";

import { createTrayAppWorkerSource, runTrayApp } from "./node-app";

describe("opentray tray app helper", () => {
  it("builds a worker bootstrap that owns the quickstart callback", () => {
    const source = createTrayAppWorkerSource();

    expect(source).toContain(
      'const { parentPort, workerData } = require("node:worker_threads");'
    );
    expect(source).toContain('import(workerData.sdkUrl)');
    expect(source).toContain('rawCreateTray(options, workerData.runtimeOptions)');
    expect(source).toContain('parentPort.postMessage("online")');
  });

  it("rejects non-function tray app entrypoints", async () => {
    await expect(
      runTrayApp("not a function" as never)
    ).rejects.toThrow("main must be a function");
  });
});
