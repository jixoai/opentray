import { describe, expect, it } from "vitest";

import { normalizeDraftForm, parseWizardCli } from "./bin";

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

// add-webview-orchestration D13/D15：草稿种子白名单——退役的旧地址栏字段被
// 忽略（零迁移），「导航工具栏」开关随草稿往返恢复。
describe("normalizeDraftForm", () => {
  it("keeps the toolbar toggle and drops the retired legacy field", () => {
    const patch = normalizeDraftForm({
      appId: "com.example",
      appName: "Example",
      toolbar: true,
      // 旧草稿遗留：被忽略，不复活已删除的输入。
      showAddressBar: true,
      imageSmoothingEnabled: false,
    });
    expect(patch).toEqual({
      appId: "com.example",
      appName: "Example",
      toolbar: true,
      imageSmoothingEnabled: false,
    });
    expect("showAddressBar" in (patch ?? {})).toBe(false);
  });

  it("drops malformed values and empty patches", () => {
    expect(normalizeDraftForm({ pm: "yarn", iconScale: 9, toolbar: "yes" })).toBeUndefined();
    expect(normalizeDraftForm("nope")).toBeUndefined();
  });
});
