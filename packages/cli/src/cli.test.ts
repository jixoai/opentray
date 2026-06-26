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

  it("keeps visual smoke outside the public CLI command surface", () => {
    expect(parseCliCommand(["smoke", "daemon-tray"])).toEqual({
      type: "help",
    });
  });

  it("does not treat the deamon typo as canonical", () => {
    expect(parseCliCommand(["deamon", "start"])).toEqual({ type: "help" });
  });

  const itWithFileSymlink = process.platform === "win32" ? it.skip : it;

  itWithFileSymlink("recognizes the npm .bin symlink as the CLI entrypoint", () => {
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
          { sessionId: 1, initialized: true, internalSessionId: "session-1" },
          { sessionId: 2, initialized: false },
        ],
      })
    ).toBe(`opentray daemon running
pid: 12345
endpoint: /tmp/opentray.sock
packageVersion: 0.1.0
protocolVersion: 1
sessions: 2
- sessionId=1 initialized=true internalSessionId=session-1
- sessionId=2 initialized=false internalSessionId=(pending)`);
  });
});
