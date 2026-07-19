import { rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createExampleMatrix,
  type PlannedExampleMatrixRow,
} from "./example-matrix";

describe("Feature: opentray example matrix planning", () => {
  it("Scenario: Given the package example matrix When rows are resolved Then finite rows replace shell wildcard expansion", () => {
    const rows = createExampleMatrix({
      platform: "linux",
      arch: "x64",
      workspaceRoot: "/repo",
    });

    expect(rows.map((row) => row.id)).toEqual([
      "basic",
      "first-app",
      "webview-control",
      "debug-runtime-tray",
      "download",
      "tray-panel",
      "placement",
      "media-query",
      "badge",
    ]);
    for (const row of rows) {
      const commands = [row.command, ...(row.preflight ?? [])];
      expect(commands.map((command) => command.args).flat()).not.toContain(
        "example:*",
      );
    }
  });

  it("Scenario: Given the first app row on macOS When planned Then it stages the packaged runtime before execution", () => {
    const workspaceRoot = "/repo";
    const row = rowById(
      createExampleMatrix({
        platform: "darwin",
        arch: "arm64",
        workspaceRoot,
      }),
      "first-app",
    );

    expect(row.skipped).toBe(false);
    expect(row.coverage).toBe("default-runtime");
    expect(row.preflight).toEqual([
      {
        command: "pnpm",
        args: ["run", "npm:cp-bin:runtime", "--", "--target", "debug"],
      },
    ]);
    expect(row.command.args).toEqual([
      "--filter",
      "opentray",
      "example:first-app",
    ]);
  });

  it("Scenario: Given release runtime mode When rows are planned Then example commands receive the release flag", () => {
    const workspaceRoot = "/repo";
    const rows = createExampleMatrix({
      platform: "darwin",
      arch: "arm64",
      workspaceRoot,
      runtimeMode: "release",
    });

    expect(rowById(rows, "first-app").preflight).toEqual([
      {
        command: "pnpm",
        args: ["run", "npm:cp-bin:runtime", "--", "--target", "release"],
      },
    ]);
    expect(rowById(rows, "webview-control").command.args).toEqual([
      "--filter",
      "opentray",
      "example:webview-control",
      "-r",
    ]);
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

  it("Scenario: Given native extension rows are planned When output is reviewed Then source-tree runtime coverage is explicit", () => {
    const rows = createExampleMatrix({
      platform: "darwin",
      arch: "arm64",
      workspaceRoot: "/repo",
    });
    const extensionRows = [
      "webview-control",
      "debug-runtime-tray",
      "download",
      "tray-panel",
      "placement",
      "media-query",
      "badge",
    ].map((id) => rowById(rows, id));

    expect(
      extensionRows.every(
        (row) => row.coverage === "extension-runtime",
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
