// Orthogonal intents (2026-07-20; original user request: an empty launch
// setting reuses the current process invocation and explicit scripts are allowed):
// 1. Normalize caller-facing launch options into a durable executable vector.
// 2. Resolve cwd and path-like commands without invoking a shell.
// 3. Keep environment variables out of the persisted descriptor.

import { isAbsolute, resolve } from "node:path";

import type { OpenTrayAppLaunchDescriptor, OpenTrayAppLaunchOptions } from "@opentray/packaging";

export const normalizeAppLaunch = (
  configured: OpenTrayAppLaunchOptions | null | undefined,
  context: {
    readonly execPath?: string;
    readonly argv?: readonly string[];
    readonly cwd?: string;
  } = {},
): OpenTrayAppLaunchDescriptor => {
  const currentCwd = context.cwd ?? process.cwd();
  if (configured === undefined || configured === null) {
    return {
      schemaVersion: 1,
      command: validateRequiredText(context.execPath ?? process.execPath, "process.execPath"),
      args: [...(context.argv ?? process.argv).slice(1)].map((arg, index) =>
        validateArg(arg, `process.argv[${index + 1}]`),
      ),
      cwd: validateRequiredText(currentCwd, "process.cwd()"),
    };
  }
  const command = validateRequiredText(configured.command, "appLaunch.command");
  const configuredCwd =
    configured.cwd === undefined
      ? currentCwd
      : validateRequiredText(configured.cwd, "appLaunch.cwd");
  const cwd = resolve(currentCwd, configuredCwd);
  const args = [...(configured.args ?? [])].map((arg, index) =>
    validateArg(arg, `appLaunch.args[${index}]`),
  );
  return {
    schemaVersion: 1,
    command: resolvePathLikeCommand(command, currentCwd),
    args,
    cwd,
  };
};

const resolvePathLikeCommand = (command: string, cwd: string): string => {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return resolve(cwd, command);
  }
  return command;
};

const validateRequiredText = (value: string, field: string): string => {
  if (value.trim().length === 0 || value.includes("\u0000")) {
    throw new Error(`${field} must be a non-empty string without NUL`);
  }
  return value;
};

const validateArg = (value: string, field: string): string => {
  if (value.includes("\u0000")) {
    throw new Error(`${field} must be a string without NUL`);
  }
  return value;
};
