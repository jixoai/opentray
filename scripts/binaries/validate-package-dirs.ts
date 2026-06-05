#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "package-dirs-json": {
      type: "string",
    },
  },
});

if (values["package-dirs-json"] === undefined || values["package-dirs-json"].trim().length === 0) {
  throw new Error("--package-dirs-json is required");
}

const packageDirs = parsePackageDirs(values["package-dirs-json"]);
for (const packageDir of packageDirs) {
  await runCommand("npm", ["pack", "--dry-run", "--json", `./${packageDir}`], process.cwd());
}

function parsePackageDirs(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`--package-dirs-json must be valid JSON: ${message}`);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error("--package-dirs-json must be a JSON array of strings");
  }
  return parsed;
}

const runCommand = (command: string, args: readonly string[], cwd: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with code ${code ?? "unknown"}`));
    });
  });
