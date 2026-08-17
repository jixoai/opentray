import { describe, expect, it } from "vitest";

import { parseWizardCli } from "./bin";

describe("parseWizardCli", () => {
  it("parses flags and positional target", () => {
    const options = parseWizardCli(["my-app", "--no-open", "--pm", "pnpm", "--port", "4321", "--skip-install", "--force"]);
    expect(options).toEqual({
      open: false,
      port: 4321,
      pm: "pnpm",
      skipInstall: true,
      force: true,
      targetDir: "my-app",
    });
  });

  it("defaults to browser-open, no port, cwd target", () => {
    expect(parseWizardCli([])).toEqual({
      open: true,
      port: undefined,
      pm: undefined,
      skipInstall: false,
      force: false,
      targetDir: undefined,
    });
  });

  it("ignores invalid --pm and --port values", () => {
    const options = parseWizardCli(["--pm", "yarn", "--port", "not-a-number"]);
    expect(options.pm).toBeUndefined();
    expect(options.port).toBeUndefined();
  });
});
