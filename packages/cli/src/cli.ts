#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { runBrokerUntilSignal } from "./daemon/broker-runner";
import { createNodeDaemonDriver, restartDaemon, startDaemon, stopDaemon } from "./daemon/lifecycle";
import { readPackageVersion } from "./daemon/package-version";
import { resolveDaemonPaths } from "./daemon/paths";

const packageJsonUrl = new URL("../package.json", import.meta.url);

type CliCommand =
  | { type: "broker-run" }
  | { type: "daemon"; action: "start" | "stop" | "restart" }
  | { type: "help" };

export const parseCliCommand = (argv: string[]): CliCommand => {
  const [group, action] = argv;
  if (group === "__broker-run") {
    return { type: "broker-run" };
  }
  if (group !== "daemon") {
    return { type: "help" };
  }
  if (action === "start" || action === "stop" || action === "restart") {
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

  if (command.type === "broker-run") {
    await runBrokerUntilSignal(paths);
    return 0;
  }

  if (command.type === "help") {
    printHelp();
    return 1;
  }

  const driver = createNodeDaemonDriver(fileURLToPath(import.meta.url));

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

  printHelp();
  return 1;
};

const printHelp = (): void => {
  console.error("Usage: opentray daemon <start|stop|restart>");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
