import { Worker } from "node:worker_threads";

import type { EventfulTrayHandle } from "./client";
import type { TrayOptions } from "@opentray/spec";
import { runVisibleRuntimeHost } from "./node-host";

export interface RunTrayAppOptions {
  /** Runtime package version used for host state partitioning and diagnostics. */
  readonly packageVersion?: string;
  /** Client version reported to the runtime host handshake. */
  readonly clientVersion?: string;
  /** Protocol version reported to the runtime host handshake. */
  readonly protocolVersion?: number;
  /** App identity for diagnostics and runtime isolation. */
  readonly appId?: string;
  /** Human-readable app identity for diagnostics. */
  readonly appName?: string;
  /** Optional finite runtime window for examples and smoke tests. */
  readonly autoExitAfterMs?: number;
  /** Delay before the worker callback runs, giving the visible host time to boot. */
  readonly startupDelayMs?: number;
}

export interface TrayAppContext {
  /** Create a tray in the app worker while the helper owns the visible host loop. */
  createTray(options: TrayOptions): Promise<EventfulTrayHandle>;
}

/**
 * First-app entrypoint executed inside the app worker.
 *
 * Keep the callback self-contained. Imports needed by the callback should be
 * dynamic imports inside the callback because the helper runs it in a worker.
 */
export type TrayAppMain = (context: TrayAppContext) => void | Promise<void>;

interface RunTrayAppWorkerData {
  readonly mainSource: string;
  readonly sdkUrl: string;
  readonly runtimeOptions: {
    readonly packageVersion?: string;
    readonly clientVersion?: string;
    readonly protocolVersion?: number;
    readonly appId?: string;
    readonly appName?: string;
  };
  readonly startupDelayMs: number;
}

/** Run a self-contained tray app without exposing host-thread choreography. */
export const runTrayApp = async (
  main: TrayAppMain,
  options: RunTrayAppOptions = {}
): Promise<void> => {
  if (typeof main !== "function") {
    throw new TypeError("main must be a function");
  }

  const worker = new Worker(createTrayAppWorkerSource(), {
    eval: true,
    workerData: {
      mainSource: main.toString(),
      sdkUrl: resolveWorkerSdkUrl(),
      runtimeOptions: {
        ...(options.packageVersion === undefined
          ? {}
          : { packageVersion: options.packageVersion }),
        ...(options.clientVersion === undefined
          ? {}
          : { clientVersion: options.clientVersion }),
        ...(options.protocolVersion === undefined
          ? {}
          : { protocolVersion: options.protocolVersion }),
        ...(options.appId === undefined ? {} : { appId: options.appId }),
        ...(options.appName === undefined ? {} : { appName: options.appName }),
      },
      startupDelayMs: normalizeDelay(options.startupDelayMs),
    } satisfies RunTrayAppWorkerData,
  });

  await waitForWorkerOnline(worker);
  worker.postMessage("start");

  try {
    await runVisibleRuntimeHost({
      ...(options.packageVersion === undefined
        ? {}
        : { packageVersion: options.packageVersion }),
      ...(options.appId === undefined ? {} : { appId: options.appId }),
      ...(options.appName === undefined ? {} : { appName: options.appName }),
      ...(options.autoExitAfterMs === undefined
        ? {}
        : { autoExitAfterMs: options.autoExitAfterMs }),
    });
  } finally {
    await worker.terminate();
  }
}

export const createTrayAppWorkerSource = (): string => `
  const { parentPort, workerData } = require("node:worker_threads");

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isStartMessage = (value) => value === "start";

  if (parentPort === null) {
    throw new Error("OpenTray tray app worker requires a parent port");
  }

  import(workerData.sdkUrl)
    .then(({ createTray: rawCreateTray }) => {
      const createTray = (options) =>
        rawCreateTray(options, workerData.runtimeOptions);
      const main = eval("(" + workerData.mainSource + ")");

      parentPort.postMessage("online");
      parentPort.once("message", async (message) => {
        if (!isStartMessage(message)) {
          return;
        }
        if (workerData.startupDelayMs > 0) {
          await delay(workerData.startupDelayMs);
        }
        await main({ createTray });
        parentPort.postMessage("done");
      });
    })
    .catch((error) => {
      throw error;
    });
`;

const normalizeDelay = (value: number | undefined): number => {
  if (value === undefined) {
    return 250;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`startupDelayMs must be a non-negative number: ${value}`);
  }
  return value;
};

const resolveWorkerSdkUrl = (): string =>
  import.meta.url.endsWith(".mjs")
    ? new URL("./sdk.mjs", import.meta.url).href
    : new URL("./sdk.ts", import.meta.url).href;

const waitForWorkerOnline = async (worker: Worker): Promise<void> =>
  new Promise((resolve, reject) => {
    const onMessage = (value: unknown): void => {
      if (value === "online") {
        cleanup();
        resolve();
        return;
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number): void => {
      if (code !== 0) {
        cleanup();
        reject(new Error(`tray app worker exited with code ${code}`));
      }
    };
    const cleanup = (): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
  });
