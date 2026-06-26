#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cliModulePath = fileURLToPath(import.meta.url);

type CliCommand =
  | { type: "help"; exitCode: 0 }
  | { type: "unsupported"; command: string | undefined };

export const parseCliCommand = (argv: string[]): CliCommand => {
  const [command] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    return { type: "help", exitCode: 0 };
  }
  return { type: "unsupported", command };
};

export const runCli = async (argv: string[]): Promise<number> => {
  const command = parseCliCommand(argv);
  printHelp(command.type === "unsupported" ? command.command : undefined);
  return command.type === "help" ? command.exitCode : 1;
};

const printHelp = (unsupportedCommand?: string): void => {
  if (unsupportedCommand !== undefined) {
    console.error(`Unsupported opentray command: ${unsupportedCommand}`);
  }
  console.error(
    [
      "OpenTray v0.9 does not expose daemon lifecycle commands.",
      "Create trays from an app-owned process with:",
      "",
      '  import { createTray } from "opentray";',
      "",
      "Node runtime diagnostics live under the opentray/node binding helpers.",
      "Source-tree visual diagnostics live in packages/cli/examples.",
    ].join("\n")
  );
};

export const isCliEntrypoint = (
  argvEntryPath: string | undefined,
  modulePath: string
): boolean => {
  if (argvEntryPath === undefined) return false;
  try {
    return realpathSync(argvEntryPath) === realpathSync(modulePath);
  } catch {
    return argvEntryPath === modulePath;
  }
};

if (isCliEntrypoint(process.argv[1], cliModulePath)) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
