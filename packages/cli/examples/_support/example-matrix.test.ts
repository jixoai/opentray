import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createExampleMatrix,
  lynxExtensionSourcePath,
  runtimeBindingSourcePath,
  type PlannedExampleMatrixRow,
} from "./example-matrix";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("Feature: opentray example matrix planning", () => {
  it("Scenario: Given the package example matrix When rows are resolved Then finite rows replace shell wildcard expansion", () => {
    const rows = createExampleMatrix({
      platform: "linux",
      arch: "x64",
      workspaceRoot: "/repo",
    });

    expect(rows.map((row) => row.id)).toEqual([
      "basic",
      "visible-binding",
      "webview-control",
      "debug-runtime-tray",
      "tray-panel",
      "placement",
      "media-query",
      "badge",
      "lynx",
    ]);
    for (const row of rows) {
      const commands = [row.command, ...(row.preflight ?? [])];
      expect(commands.map((command) => command.args).flat()).not.toContain(
        "example:*",
      );
    }
  });

  it("Scenario: Given the visible binding row on macOS When planned Then it stages the default runtime artifact before execution", () => {
    const workspaceRoot = "/repo";
    const row = rowById(
      createExampleMatrix({
        platform: "darwin",
        arch: "arm64",
        workspaceRoot,
      }),
      "visible-binding",
    );

    expect(row.skipped).toBe(false);
    expect(row.coverage).toBe("default-runtime");
    expect(row.preflight).toEqual([
      { command: "cargo", args: ["build", "-p", "opentray-runtime-node"] },
      { command: "pnpm", args: ["--filter", "opentray", "build"] },
      {
        command: "bun",
        args: [
          "run",
          "scripts/binaries/stage-local.ts",
          "--kind",
          "runtime",
          "--source",
          runtimeBindingSourcePath("darwin", "arm64", workspaceRoot),
        ],
      },
    ]);
    expect(row.command.env).toEqual({
      OPENTRAY_EXAMPLE_EXIT_AFTER_MS: "1200",
    });
  });

  it("Scenario: Given an unsupported extension host When planned Then the row reports a typed skip reason", () => {
    const row = rowById(
      createExampleMatrix({
        platform: "linux",
        arch: "x64",
        workspaceRoot: "/repo",
      }),
      "webview-control",
    );

    expect(row.skipped).toBe(true);
    expect(row.skipReason).toBe("unsupported platform: linux");
  });

  it("Scenario: Given a CI-owned Lynx carrier artifact is missing When planned Then the row skips instead of pretending success", async () => {
    const workspaceRoot = await makeTempDir();
    await writeWorkspaceFile(
      workspaceRoot,
      "packages/cli/assets/lynx-review/main.lynx.bundle",
    );

    const row = rowById(
      createExampleMatrix({
        platform: "darwin",
        arch: "arm64",
        workspaceRoot,
      }),
      "lynx",
    );

    expect(row.skipped).toBe(true);
    expect(row.skipReason).toBe(
      "missing artifact: packages/ext-lynx-darwin-arm64/runtime/OpenTrayLynxRuntime.app.zip",
    );
  });

  it("Scenario: Given the Lynx row is planned on macOS When preflight runs Then it builds and stages the extension dylib from source", () => {
    const workspaceRoot = "/repo";
    const row = rowById(
      createExampleMatrix({
        platform: "darwin",
        arch: "arm64",
        workspaceRoot,
      }),
      "lynx",
    );

    expect(row.preflight).toEqual([
      { command: "cargo", args: ["build", "-p", "opentray-ext-lynx"] },
      {
        command: "bun",
        args: [
          "run",
          "scripts/binaries/stage-local.ts",
          "--kind",
          "lynx",
          "--source",
          lynxExtensionSourcePath("darwin", workspaceRoot),
        ],
      },
    ]);
    expect(row.command.env).toEqual({
      OPENTRAY_EXAMPLE_EXIT_AFTER_MS: "1200",
    });
  });

  it("Scenario: Given native extension rows are planned When output is reviewed Then source-tree debug runtime coverage is explicit", () => {
    const rows = createExampleMatrix({
      platform: "darwin",
      arch: "arm64",
      workspaceRoot: "/repo",
    });
    const extensionRows = [
      "webview-control",
      "debug-runtime-tray",
      "tray-panel",
      "placement",
      "media-query",
      "badge",
      "lynx",
    ].map((id) => rowById(rows, id));

    expect(
      extensionRows.every(
        (row) => row.coverage === "extension-debug-runtime",
      ),
    ).toBe(true);
  });
});

const rowById = (
  rows: readonly PlannedExampleMatrixRow[],
  id: string,
): PlannedExampleMatrixRow => {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined) {
    throw new Error(`missing example matrix row: ${id}`);
  }
  return row;
};

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "opentray-example-matrix-"));
  tempDirs.push(dir);
  return dir;
};

const writeWorkspaceFile = async (
  workspaceRoot: string,
  relativePath: string,
): Promise<void> => {
  const file = join(workspaceRoot, relativePath);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, "", "utf8");
};
