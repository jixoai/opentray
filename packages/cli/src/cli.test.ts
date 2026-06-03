import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  formatDaemonHealthOutput,
  isCliEntrypoint,
  parseCliCommand,
} from "./cli";

describe("opentray CLI", () => {
  it("parses daemon lifecycle commands", () => {
    expect(parseCliCommand(["daemon", "start"])).toEqual({
      type: "daemon",
      action: "start",
    });
    expect(parseCliCommand(["daemon", "stop"])).toEqual({
      type: "daemon",
      action: "stop",
    });
    expect(parseCliCommand(["daemon", "restart"])).toEqual({
      type: "daemon",
      action: "restart",
    });
    expect(parseCliCommand(["daemon", "health"])).toEqual({
      type: "daemon",
      action: "health",
    });
  });

  it("parses the npm-installable daemon tray smoke command", () => {
    expect(parseCliCommand(["smoke", "daemon-tray"])).toEqual({
      type: "smoke",
      name: "daemon-tray",
    });
  });

  it("parses the npm-installable daemon lynx smoke command", () => {
    expect(parseCliCommand(["smoke", "daemon-lynx"])).toEqual({
      type: "smoke",
      name: "daemon-lynx",
    });
    expect(
      parseCliCommand([
        "smoke",
        "daemon-lynx",
        "--bundle",
        "./dist/main.lynx.bundle",
      ])
    ).toEqual({
      type: "smoke",
      name: "daemon-lynx",
      bundlePath: "./dist/main.lynx.bundle",
    });
  });

  it("does not treat the deamon typo as canonical", () => {
    expect(parseCliCommand(["deamon", "start"])).toEqual({ type: "help" });
  });

  it("recognizes the npm .bin symlink as the CLI entrypoint", () => {
    const dir = mkdtempSync(join(tmpdir(), "opentray-cli-entry-"));
    try {
      const target = join(dir, "cli.mjs");
      const symlink = join(dir, "opentray");
      writeFileSync(target, "");
      symlinkSync(target, symlink);

      expect(isCliEntrypoint(symlink, target)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("formats daemon health output for human inspection", () => {
    expect(
      formatDaemonHealthOutput({
        pid: 12345,
        endpoint: "/tmp/opentray.sock",
        packageVersion: "0.1.0",
        protocolVersion: 1,
        sessionCount: 2,
        sessions: [
          { sessionId: 1, initialized: true, internalLeaseId: "lease-1" },
          { sessionId: 2, initialized: false },
        ],
      })
    ).toBe(`opentray daemon running
pid: 12345
endpoint: /tmp/opentray.sock
packageVersion: 0.1.0
protocolVersion: 1
sessions: 2
- sessionId=1 initialized=true internalLeaseId=lease-1
- sessionId=2 initialized=false internalLeaseId=(pending)`);
  });
});
