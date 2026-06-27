import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  createExampleMatrix,
  type ExampleCommand,
  type PlannedExampleMatrixRow,
} from "./_support/example-matrix";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));
const selectedRows = parseSelectedRows(process.argv.slice(2));
const rows = createExampleMatrix({ workspaceRoot }).filter(
  (row) => selectedRows.size === 0 || selectedRows.has(row.id),
);

if (rows.length === 0) {
  throw new Error("no example matrix rows selected");
}

const results: MatrixResult[] = [];

for (const row of rows) {
  console.log(`\n[example:${row.id}] ${row.description}`);
  console.log(`coverage: ${row.coverage}`);
  if (row.skipped) {
    const reason = row.skipReason ?? "unspecified skip";
    console.log(`skip: ${reason}`);
    results.push({ row, status: "skipped", reason });
    continue;
  }

  try {
    for (const command of row.preflight ?? []) {
      await runCommand(command, workspaceRoot);
    }
    await runCommand(row.command, workspaceRoot);
    results.push({ row, status: "passed" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    results.push({ row, status: "failed", reason });
  }
}

printSummary(results);

if (results.some((result) => result.status === "failed")) {
  process.exitCode = 1;
}

interface MatrixResult {
  readonly row: PlannedExampleMatrixRow;
  readonly status: "passed" | "failed" | "skipped";
  readonly reason?: string;
}

function parseSelectedRows(args: readonly string[]): ReadonlySet<string> {
  const rows = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--row") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--row requires a row id");
      }
      rows.add(value);
      index += 1;
      continue;
    }
    if (arg?.startsWith("--row=")) {
      rows.add(arg.slice("--row=".length));
      continue;
    }
    throw new Error(`unknown example matrix argument: ${arg}`);
  }
  return rows;
}

async function runCommand(
  command: ExampleCommand,
  cwd: string,
): Promise<void> {
  console.log(`$ ${formatCommand(command)}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd,
      env: {
        ...process.env,
        ...command.env,
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${formatCommand(command)} failed with code ${code ?? "unknown"}`,
        ),
      );
    });
  });
}

function formatCommand(command: ExampleCommand): string {
  const env = Object.entries(command.env ?? {}).map(
    ([key, value]) => `${key}=${JSON.stringify(value)}`,
  );
  return [...env, command.command, ...command.args].join(" ");
}

function printSummary(results: readonly MatrixResult[]): void {
  console.log("\nExample matrix summary");
  for (const result of results) {
    const suffix =
      result.reason === undefined ? "" : ` (${result.reason})`;
    console.log(`${result.status.padEnd(7)} ${result.row.id}${suffix}`);
  }
}
