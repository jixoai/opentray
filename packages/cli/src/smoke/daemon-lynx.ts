import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "../client";
import { connectLocalBroker } from "../local-broker";

const menuLabels = new Map<number, string>([
  [1, "Show Fit Window"],
  [2, "Show Fixed Window"],
  [3, "Hide Window"],
  [99, "Quit Smoke"],
]);

const DEFAULT_LYNX_BUNDLE_ENV = "OPENTRAY_LYNX_BUNDLE";
const DEFAULT_REVIEW_BUNDLE_RELATIVE_PATH =
  "assets/lynx-review/main.lynx.bundle";

export interface DaemonLynxSmokeOptions {
  bundlePath?: string;
}

export const runDaemonLynxSmoke = async (
  options: DaemonLynxSmokeOptions = {}
): Promise<void> => {
  const bundlePath = resolveLynxBundlePath(options.bundlePath);
  if (process.env.OPENTRAY_LYNX_DEBUG) {
    console.log(`lynx debug modes: ${process.env.OPENTRAY_LYNX_DEBUG}`);
  }
  if (process.env.OPENTRAY_LYNX_DEBUG_LOG_PATH) {
    console.log(
      `lynx debug log path: ${process.env.OPENTRAY_LYNX_DEBUG_LOG_PATH}`
    );
  }
  const connection = await connectLocalBroker();
  const client = createClient(connection, { requestIdPrefix: "daemon-lynx" });
  console.log(
    `connected: endpoint=${connection.endpoint} session=${connection.sessionId}`
  );

  const space = await client.createSpace({
    id: "com.example.opentray.daemon-lynx",
    title: "OpenTray Lynx Smoke",
    default: true,
  });
  console.log(`space: ${JSON.stringify(space.space)}`);

  const tray = await space.createTray({
    trayId: "daemon-lynx-status",
    title: "OpenTray Lynx",
    tooltip: {
      title: "OpenTray Lynx",
      description: "Generic extension smoke for a real Lynx runtime window",
    },
    icon: createVisibleIcon(),
    menu: {
      items: [
        { type: "item", id: 1, title: "Show Fit Window" },
        { type: "item", id: 2, title: "Show Fixed Window" },
        { type: "item", id: 3, title: "Hide Window" },
        { type: "separator" },
        { type: "item", id: 99, title: "Quit Smoke" },
      ],
    },
  });
  console.log(`tray: ${tray.trayId}`);

  await connection.request({
    type: "load-ext",
    requestId: "daemon-lynx-load",
    spaceId: space.space.spaceId,
    name: "lynx",
    path: "@opentray/ext-lynx",
  });
  console.log("lynx extension requested through the generic load-ext path");

  let closed = false;
  let exitTimer: NodeJS.Timeout | undefined;
  let resolveClosed: (() => void) | undefined;

  const show = async (mode: "fit" | "fixed"): Promise<void> => {
    await tray.commandExtension("lynx", {
      type: "show",
      bundlePath,
      fitContentSize: mode === "fit",
      width: mode === "fixed" ? 720 : undefined,
      height: mode === "fixed" ? 420 : undefined,
      minWidth: 320,
      minHeight: 220,
      maxWidth: 960,
      maxHeight: 720,
      nativeWindowApi: true,
      bindWindowGlobals: true,
      nativeScreenApi: true,
      bindScreenGlobals: true,
      title: `OpenTray Lynx ${mode === "fit" ? "Fit" : "Fixed"} Smoke`,
      icon: createVisibleIcon(),
    });
    console.log(`lynx command: show mode=${mode} bundle=${bundlePath}`);
  };

  const hide = async (): Promise<void> => {
    await tray.commandExtension("lynx", { type: "hide" });
    console.log("lynx command: hide");
  };

  const shutdown = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    if (exitTimer !== undefined) {
      clearTimeout(exitTimer);
    }
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    try {
      await hide();
    } catch (error) {
      console.error(`lynx hide during shutdown failed: ${String(error)}`);
    }
    await connection.close();
    resolveClosed?.();
  };

  const handleMenuClick = async (itemId: number): Promise<void> => {
    switch (itemId) {
      case 1:
        await show("fit");
        return;
      case 2:
        await show("fixed");
        return;
      case 3:
        await hide();
        return;
      case 99:
        console.log("quit item routed; closing lynx smoke connection");
        await shutdown();
        return;
      default:
        return;
    }
  };

  connection.onEvent((frame) => {
    console.log(`broker -> client ${JSON.stringify(frame)}`);
    if (frame.type === "event" && frame.event.type === "menuClick") {
      console.log(
        `menu click: ${
          menuLabels.get(frame.event.itemId) ?? frame.event.itemId
        }`
      );
      void handleMenuClick(frame.event.itemId);
      return;
    }
    if (frame.type === "ext-event" && frame.ext === "lynx") {
      console.log(`lynx event: ${JSON.stringify(frame.data)}`);
    }
  });

  const onSignal = (): void => {
    void shutdown();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const exitAfter = process.env.OPENTRAY_EXAMPLE_EXIT_AFTER_MS;
  if (exitAfter !== undefined && exitAfter.length > 0) {
    const duration = Number.parseInt(exitAfter, 10);
    if (Number.isInteger(duration) && duration > 0) {
      exitTimer = setTimeout(() => {
        void shutdown();
      }, duration);
    }
  }

  try {
    await show("fit");
    console.log(
      "use the tray menu to switch between fit-content and fixed sizing, or press Ctrl+C to exit"
    );
  } catch (error) {
    await connection.close();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    throw error;
  }

  await new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
};

export const resolveLynxBundlePath = (value?: string): string => {
  const resolved = value ?? process.env[DEFAULT_LYNX_BUNDLE_ENV];
  if (resolved === undefined || resolved.length === 0) {
    const bundledReviewBundle = resolveBundledReviewBundlePath();
    if (!existsSync(bundledReviewBundle)) {
      throw new Error(
        `lynx smoke requires --bundle <path>, ${DEFAULT_LYNX_BUNDLE_ENV}=<path-to-main.lynx.bundle>, or a packaged review bundle at ${bundledReviewBundle}`
      );
    }
    return realpathSync(bundledReviewBundle);
  }
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const absolutePath = resolve(baseDir, resolved);
  if (!existsSync(absolutePath)) {
    throw new Error(`lynx smoke bundle does not exist: ${absolutePath}`);
  }
  return realpathSync(absolutePath);
};

export const resolveBundledReviewBundlePath = (
  moduleUrl = import.meta.url
): string => {
  let currentDir = dirname(fileURLToPath(moduleUrl));

  while (true) {
    const packageJson = join(currentDir, "package.json");
    if (existsSync(packageJson)) {
      return join(currentDir, DEFAULT_REVIEW_BUNDLE_RELATIVE_PATH);
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) {
      throw new Error(
        `failed to resolve opentray package root from ${moduleUrl}`
      );
    }
    currentDir = parent;
  }
};

function createVisibleIcon(): {
  type: "rgba";
  width: number;
  height: number;
  data: number[];
} {
  const width = 32;
  const height = 32;
  const data: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inStroke = x <= 5 || (x >= 13 && x <= 18) || y >= 26;
      const inDiagonal = y >= x + 10 && x <= 18;
      const alpha = inStroke || inDiagonal ? 255 : 0;
      data.push(34, 92, 56, alpha);
    }
  }

  return { type: "rgba", width, height, data };
}
