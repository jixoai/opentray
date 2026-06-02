#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import type { DaemonHealth } from "@opentray/spec";

import { createNodeDaemonDriver, inspectDaemon, restartDaemon, startDaemon, stopDaemon } from "./daemon/lifecycle";
import { readPackageVersion } from "./daemon/package-version";
import { resolveDaemonPaths } from "./daemon/paths";
import { connectLocalBroker } from "./local-broker";
import { runDaemonLynxSmoke } from "./smoke/daemon-lynx";
import { runDaemonTraySmoke } from "./smoke/daemon-tray";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const cliModulePath = fileURLToPath(import.meta.url);

type CliCommand =
  | { type: "daemon"; action: "start" | "stop" | "restart" | "health" }
  | { type: "smoke"; name: "daemon-tray" }
  | { type: "smoke"; name: "daemon-lynx"; bundlePath?: string }
  | { type: "help" };

export const parseCliCommand = (argv: string[]): CliCommand => {
  const [group, action, ...rest] = argv;
  if (group !== "daemon") {
    if (group === "smoke" && action === "daemon-tray") {
      return { type: "smoke", name: "daemon-tray" };
    }
    if (group === "smoke" && action === "daemon-lynx") {
      const bundlePath = parseSmokeBundlePath(rest);
      return bundlePath === undefined
        ? { type: "smoke", name: "daemon-lynx" }
        : { type: "smoke", name: "daemon-lynx", bundlePath };
    }
    return { type: "help" };
  }
  if (action === "start" || action === "stop" || action === "restart" || action === "health") {
    return { type: "daemon", action };
  }

  return { type: "help" };
};

export const runCli = async (argv: string[]): Promise<number> => {
  const command = parseCliCommand(argv);
  const packageVersion = process.env.OPENTRAY_DAEMON_PACKAGE_VERSION ?? (await readPackageVersion(packageJsonUrl));
  const paths = resolveDaemonPaths({
    homeDir: process.env.OPENTRAY_HOME ?? homedir(),
    packageVersion,
  });

  if (command.type === "help") {
    printHelp();
    return 1;
  }

  if (command.type === "smoke") {
    if (command.name === "daemon-tray") {
      await runDaemonTraySmoke();
    } else {
      await runDaemonLynxSmoke(
        command.bundlePath === undefined ? {} : { bundlePath: command.bundlePath },
      );
    }
    return 0;
  }

  const driver = createNodeDaemonDriver(cliModulePath);

  if (command.action === "start") {
    const result = await startDaemon({ paths, driver });
    console.log(`opentray daemon ${result.status}: pid=${result.pid} endpoint=${result.paths.endpoint}`);
    return 0;
  }

  if (command.action === "stop") {
    const result = await stopDaemon({ paths, driver });
    console.log(
      result.status === "stopped"
        ? `opentray daemon stopped: pid=${result.pid}`
        : "opentray daemon not running",
    );
    return 0;
  }

  if (command.action === "restart") {
    const result = await restartDaemon({ paths, driver });
    console.log(`opentray daemon ${result.status}: pid=${result.pid} endpoint=${result.paths.endpoint}`);
    return 0;
  }

  if (command.action === "health") {
    const inspected = await inspectDaemon({ paths, driver });
    if (inspected.status === "not-running") {
      console.log("opentray daemon not running");
      return 0;
    }

    const connection = await connectLocalBroker({
      autoStart: false,
      endpoint: paths.endpoint,
      homeDir: paths.homeDir,
      packageVersion,
    });
    try {
      const response = await connection.request({
        type: "health",
        requestId: "opentray-daemon-health",
      });
      if (response.type !== "daemon-health") {
        throw new Error(`expected daemon-health response, received ${response.type}`);
      }
      console.log(formatDaemonHealthOutput(response.health));
    } finally {
      await connection.close();
    }
    return 0;
  }

  printHelp();
  return 1;
};

const printHelp = (): void => {
  console.error("Usage: opentray daemon <start|stop|restart|health>");
  console.error("       opentray smoke daemon-tray");
  console.error("       opentray smoke daemon-lynx --bundle <path-to-main.lynx.bundle>");
};

export const formatDaemonHealthOutput = (health: DaemonHealth): string => {
  const lines = [
    "opentray daemon running",
    `pid: ${health.pid}`,
    `endpoint: ${health.endpoint}`,
    `packageVersion: ${health.packageVersion}`,
    `protocolVersion: ${health.protocolVersion}`,
    `sessions: ${health.sessionCount}`,
  ];

  for (const session of health.sessions) {
    const internalLease = session.internalLeaseId ?? "(pending)";
    lines.push(
      `- sessionId=${session.sessionId} initialized=${session.initialized} internalLeaseId=${internalLease}`,
    );
  }

  return lines.join("\n");
};

export const isCliEntrypoint = (argvEntryPath: string | undefined, modulePath: string): boolean => {
  if (argvEntryPath === undefined) return false;
  try {
    return realpathSync(argvEntryPath) === realpathSync(modulePath);
  } catch {
    return argvEntryPath === modulePath;
  }
};

function parseSmokeBundlePath(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--bundle") {
      return argv[index + 1];
    }
  }
  return undefined;
}

if (isCliEntrypoint(process.argv[1], cliModulePath)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
