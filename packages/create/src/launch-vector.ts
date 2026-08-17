// Orthogonal intents (maintained 2026-07-22; original user request: the
// generated app must relaunch from Finder/Dock without the terminal's PATH;
// governed by the App Launch Law):
// 1. Resolve the user command into a PATH-independent absolute vector.
// 2. Unwrap `#!/usr/bin/env node` style scripts onto their interpreter.
// 3. Keep environment maps out of the persisted descriptor.

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";

export interface LaunchVector {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Optional explicit env overlay merged over the runtime environment. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ResolveLaunchVectorOptions {
  readonly tokens: readonly string[];
  readonly cwd: string;
  readonly platform?: NodeJS.Platform;
  readonly pathEnv?: string;
  readonly accessFile?: (path: string) => Promise<void>;
  readonly firstLine?: (path: string) => Promise<string | undefined>;
}

const isExecutable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const readFirstLine = async (path: string): Promise<string | undefined> => {
  try {
    const content = await readFile(path, "utf8");
    return content.split("\n", 1)[0];
  } catch {
    return undefined;
  }
};

/** Resolve a bare command name against PATH; returns undefined when absent. */
export const resolveOnPath = async (
  command: string,
  options: Pick<ResolveLaunchVectorOptions, "platform" | "pathEnv" | "accessFile">,
): Promise<string | undefined> => {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return undefined;
  }
  const platform = options.platform ?? process.platform;
  const pathEnv =
    options.pathEnv ??
    (platform === "win32"
      ? `${process.env.PATH ?? ""}${delimiter}${process.cwd()}`
      : process.env.PATH ?? "");
  const extensions =
    platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const dir of pathEnv.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = resolve(dir, `${command}${ext}`);
      const exists = options.accessFile
        ? await options.accessFile(candidate).then(
            () => true,
            () => false,
          )
        : await isExecutable(candidate);
      if (exists) {
        return candidate;
      }
    }
  }
  return undefined;
};

/** Read a `#!/usr/bin/env <interpreter>` shebang; undefined for other files. */
export const parseShebangInterpreter = (
  firstLine: string | undefined,
): { interpreter: string; args: readonly string[] } | undefined => {
  if (firstLine === undefined || !firstLine.startsWith("#!")) {
    return undefined;
  }
  const tokens = firstLine.slice(2).trim().split(/\s+/u).filter(Boolean);
  const [interpreter, ...interpreterArgs] = tokens;
  if (interpreter === undefined) {
    return undefined;
  }
  return { interpreter, args: interpreterArgs };
};

/**
 * Resolve the user's command tokens to a PATH-independent vector:
 * - absolute-ize bare executables through PATH lookup;
 * - resolve relative script paths against cwd;
 * - when the executable is an `env <interpreter>` shebang script, run the
 *   interpreter directly with the script as its first argument.
 * The persisted descriptor never includes an environment map.
 */
export const resolveLaunchVector = async (
  options: ResolveLaunchVectorOptions,
): Promise<LaunchVector> => {
  const [rawCommand, ...restArgs] = options.tokens;
  if (rawCommand === undefined || rawCommand.trim().length === 0) {
    throw new Error("launch vector requires a command");
  }
  const accessFile = options.accessFile ?? (async (path: string) => access(path));
  const firstLine = options.firstLine ?? readFirstLine;

  let command = rawCommand;
  if (!isAbsolute(command)) {
    const onPath = await resolveOnPath(command, options);
    if (onPath !== undefined) {
      command = onPath;
    } else if (command.includes("/") || command.includes("\\")) {
      command = resolve(options.cwd, command);
    }
  }

  // Windows .cmd shims are not directly spawnable without a shell; route them
  // through cmd.exe explicitly so the vector stays shell-string-free. The
  // original user-typed path is preserved verbatim for cmd to resolve.
  const platform = options.platform ?? process.platform;
  if (platform === "win32" && /\.cmd$/iu.test(rawCommand)) {
    return {
      command: resolveSystemPath("cmd.exe"),
      args: ["/d", "/s", "/c", rawCommand, ...restArgs],
      cwd: options.cwd,
    };
  }

  const shebang = parseShebangInterpreter(await firstLine(command).catch(() => undefined));
  if (shebang !== undefined && !command.endsWith(".exe")) {
    let interpreter = shebang.interpreter;
    if (interpreter === "/usr/bin/env" || interpreter === "env") {
      const [envTarget, ...envArgs] = shebang.args;
      if (envTarget !== undefined) {
        const resolved = (await resolveOnPath(envTarget, options)) ?? envTarget;
        return {
          command: resolved,
          args: [...envArgs, command, ...restArgs],
          cwd: options.cwd,
        };
      }
      interpreter = "/usr/bin/env";
    }
    return {
      command: interpreter,
      args: [...shebang.args, command, ...restArgs],
      cwd: options.cwd,
    };
  }

  return { command, args: restArgs, cwd: options.cwd };
};

const resolveSystemPath = (name: string): string => {
  if (isAbsolute(name)) {
    return name;
  }
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return `${systemRoot}\\System32\\${name}`;
};
