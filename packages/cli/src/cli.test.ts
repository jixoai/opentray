import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isCliEntrypoint, parseCliCommand, runCli } from "./cli";

describe("opentray CLI", () => {
  it("keeps daemon lifecycle outside the public command surface", () => {
    expect(parseCliCommand(["daemon", "start"])).toEqual({
      type: "unsupported",
      command: "daemon",
    });
  });

  it("keeps visual smoke outside the public CLI command surface", () => {
    expect(parseCliCommand(["smoke", "debug-runtime-tray"])).toEqual({
      type: "unsupported",
      command: "smoke",
    });
  });

  it("does not treat the deamon typo as canonical", () => {
    expect(parseCliCommand(["deamon", "start"])).toEqual({
      type: "unsupported",
      command: "deamon",
    });
  });

  it("prints v0.9 usage guidance without advertising daemon commands", async () => {
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    try {
      await expect(runCli(["--help"])).resolves.toBe(0);
    } finally {
      console.error = originalError;
    }

    const output = errors.join("\n");
    expect(output).toContain("does not expose daemon lifecycle commands");
    expect(output).toContain('import { createTray } from "opentray";');
    expect(output).not.toContain("daemon <start|stop|restart|health>");
  });

  const itWithFileSymlink = process.platform === "win32" ? it.skip : it;

  itWithFileSymlink(
    "recognizes the npm .bin symlink as the CLI entrypoint",
    () => {
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
    }
  );
});
