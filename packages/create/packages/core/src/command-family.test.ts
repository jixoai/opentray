// Orthogonal intents (maintained 2026-08-19; governed by openspec change
// add-create-command-family):
// 1. 覆盖用户确认过的分系列 appId 示例（新规则 + 现行规则对照）。
// 2. parseCommand ↔ buildCommand 往返稳定（WebUI 表单 Dialog 的数据基础）。
// 3. runner 归一：同一包换 runner 推导结果不变。
// 4. 环境变量预设只落在 npx/pnpx。
import { describe, expect, it } from "vitest";

import { deriveDefaultAppId } from "./app-id";
import {
  buildCommand,
  buildRustCommands,
  deriveFamily,
  envPresetsFor,
  isRustInstallCommand,
  parseCommand,
} from "./command-family";
import { tokenizeCommandLine } from "./tokenize";

const appIdOf = (command: string): string => deriveFamily(parseCommand(command)).appId;
const legacyOf = (command: string): string => {
  const result = tokenizeCommandLine(command);
  return deriveDefaultAppId(result.ok ? result.tokens : []);
};

const rustState = (crate: string, binary: string, args: string) => ({
  family: "rust" as const,
  runner: "",
  runnerFlags: "",
  pkg: crate,
  version: "",
  args,
  binary,
  raw: "",
});

describe("分系列默认 appId（新规则 vs 现行规则）", () => {
  it("npm 系列：丢弃 runner，身份 = 子命令 + 包名 + npmjs 尾段", () => {
    expect(appIdOf("npx @deepseek-ai/dsh@latest web")).toBe("web.dsh.npmjs");
    expect(legacyOf("npx @deepseek-ai/dsh@latest web")).toBe("web.dsh.npx");
  });

  it("runner 归一：同一包换 runner 结果不变", () => {
    for (const command of [
      "npx cowsay hello",
      "pnpx cowsay hello",
      "bunx cowsay hello",
      "yarn dlx cowsay hello",
      "nubx cowsay hello",
      "vpx cowsay hello",
    ]) {
      expect(appIdOf(command)).toBe("hello.cowsay.npmjs");
    }
  });

  it("deno run：剥离 npm:/jsr: 前缀与选项 token", () => {
    expect(appIdOf("deno run -A npm:cowsay@latest hello")).toBe(
      "hello.cowsay.npmjs",
    );
  });

  it("go 系列：module 取末段，不再出现 run 段", () => {
    expect(appIdOf("go run rsc.io/fortune@latest")).toBe("fortune.golang");
    expect(legacyOf("go run rsc.io/fortune@latest")).toBe("fortune.run.go");
    expect(appIdOf("go run github.com/user/repo serve --port 8080")).toBe(
      "serve.repo.golang",
    );
  });

  it("rust 系列：以运行二进制为身份（现行规则基于 install 行对照）", () => {
    expect(deriveFamily(rustState("ripgrep", "rg", "--json .")).appId).toBe(
      "rg.rust",
    );
    expect(legacyOf("cargo install ripgrep")).toBe("ripgrep.install.cargo");
    // 未指定二进制时默认与 crate 同名
    expect(deriveFamily(parseCommand("cargo install ripgrep")).appId).toBe(
      "ripgrep.rust",
    );
  });

  it("python 系列：uvx/pipx run 丢弃 runner，包名 . _ 归一为 -", () => {
    expect(appIdOf("uvx ruff format --check .")).toBe("format.ruff.python");
    expect(legacyOf("uvx ruff format --check .")).toBe("format.ruff.uvx");
    expect(appIdOf("pipx run black")).toBe("black.python");
    expect(legacyOf("pipx run black")).toBe("black.run.pipx");
    expect(appIdOf("uvx some.pkg tool")).toBe("tool.some-pkg.python");
  });

  it("dotnet 系列：dnx 工具 ID + dotnet 尾段", () => {
    expect(appIdOf("dnx dotnet-format --verify-no-changes")).toBe(
      "dotnet-format.dotnet",
    );
    expect(legacyOf("dnx dotnet-format --verify-no-changes")).toBe(
      "dotnet-format.dnx",
    );
  });

  it("自定义系列：保持现行规则，不显示新旧差异", () => {
    const family = deriveFamily(parseCommand("docker compose up -d"));
    expect(family.appId).toBe("up.compose.docker");
    expect(family.legacyAppId).toBe("up.compose.docker");
    expect(family.changed).toBe(false);
  });

  it("空输入回落 app.opentray", () => {
    expect(appIdOf("")).toBe("app.opentray");
    expect(appIdOf("npx")).toBe("app.opentray");
  });

  it("输入中断（未闭合引号）安全回落自定义", () => {
    const state = parseCommand('npx "unclosed');
    expect(state.family).toBe("custom");
  });

  it("名称投影不含生态尾段", () => {
    const family = deriveFamily(parseCommand("npx @deepseek-ai/dsh@latest web"));
    expect(family.appName).toBe("Web Dsh");
  });
});

describe("parseCommand ↔ buildCommand 往返", () => {
  it.each([
    "npx @deepseek-ai/dsh@latest web",
    "pnpx create-vite@latest my-app",
    "bunx cowsay hello",
    "yarn dlx ignite-cli new",
    "nubx cowsay hello",
    "deno run -A npm:cowsay@latest hello",
    "vpx tinybench@latest",
    "go run rsc.io/fortune@latest",
    "uvx ruff@latest format --check .",
    "pipx run black",
    "dnx dotnet-format --verify-no-changes",
  ])("%s 解析后重建保持不变", (command) => {
    expect(buildCommand(parseCommand(command))).toBe(command);
  });

  it("含引号/空白参数往返逐项无损（D12 / Codex B5）", () => {
    for (const command of [
      'npx tool "hello world"',
      "npx tool 'it''s'",
      'go run rsc.io/fortune@latest "multi word" arg',
      'uvx ruff format "a b" "c"',
    ]) {
      const result = tokenizeCommandLine(command);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      // 序列化串与 build 结果一致，且再分词逐项等于原 tokens。
      const rebuilt = buildCommand(parseCommand(command));
      const roundTrip = tokenizeCommandLine(rebuilt);
      expect(roundTrip.ok).toBe(true);
      if (roundTrip.ok) {
        expect(roundTrip.tokens).toEqual(result.tokens);
      }
    }
  });

  it("空串参数与空白参数序列化正确", () => {
    expect(parseCommand('npx tool "" x').args).toBe("'' x");
    expect(parseCommand('npx tool "multi word"').args).toBe("'multi word'");
    // 边界备注：含奇数单引号的 token 被 tokenizeCommandLine 既有配平法则
    // 拒于门外（直接输入亦不可用，非本变更引入），故序列化保证域 =
    // tokenizer 接受域；POSIX 序列化仍按规范实现。
  });

  it("带值/未知 runner flag 保守回落 custom，绝不改义（D12 / Codex R2-B2）", () => {
    const command = "deno run --config 'path with spaces' npm:cowsay";
    const state = parseCommand(command);
    expect(state.family).toBe("custom");
    // custom raw 保留引号：重建后再分词逐项等于原 tokens。
    const result = tokenizeCommandLine(command);
    expect(result.ok).toBe(true);
    const rebuilt = tokenizeCommandLine(buildCommand(state));
    expect(rebuilt.ok).toBe(true);
    if (result.ok && rebuilt.ok) {
      expect(rebuilt.tokens).toEqual(result.tokens);
    }
    expect(parseCommand("npx -c 'echo hi'").family).toBe("custom");
    // 白名单内的无值 flag 仍正常识别为系列命令。
    expect(parseCommand("deno run -A npm:cowsay@latest hello").family).toBe("npm");
    expect(parseCommand("deno run --allow-net --quiet npm:cowsay").family).toBe("npm");
    expect(parseCommand("npx -y create-vite").family).toBe("npm");
  });

  it("反斜杠转义参数往返逐项无损（D12 / Codex R3-B2）", () => {
    const state = parseCommand("npx tool a\\ b");
    expect(state.args).toBe("'a b'");
    expect(buildCommand(state)).toBe("npx tool 'a b'");
    const roundTrip = tokenizeCommandLine("npx tool a\\ b");
    const rebuilt = tokenizeCommandLine(buildCommand(state));
    expect(roundTrip.ok && rebuilt.ok ? rebuilt.tokens : []).toEqual(
      roundTrip.ok ? roundTrip.tokens : [],
    );
  });

  it("cargo install 谓词（D11：向导绝不代执行安装）", () => {
    expect(isRustInstallCommand(["cargo", "install", "ripgrep"])).toBe(true);
    expect(isRustInstallCommand(["cargo", "build"])).toBe(false);
    expect(isRustInstallCommand(["npx", "install"])).toBe(false);
  });

  it("deno run 缺 npm: 前缀时自动补全", () => {
    expect(buildCommand(parseCommand("deno run -A cowsay@latest hello"))).toBe(
      "deno run -A npm:cowsay@latest hello",
    );
  });

  it("cargo install 解析为 rust 两段式", () => {
    const state = parseCommand("cargo install ripgrep");
    expect(state.family).toBe("rust");
    expect(buildRustCommands(state)).toEqual({
      install: "cargo install ripgrep",
      run: "ripgrep",
    });
  });

  it("未识别头回落 custom 并保留原文", () => {
    const state = parseCommand("docker compose up -d");
    expect(state.family).toBe("custom");
    expect(buildCommand(state)).toBe("docker compose up -d");
  });
});

describe("环境变量预设", () => {
  it("npx/pnpx 注入 npm_config_yes=true", () => {
    expect(envPresetsFor(parseCommand("npx cowsay"))).toEqual([
      {
        key: "npm_config_yes",
        value: "true",
        note: "跳过 npm 安装确认（等效 -y），首次运行无需交互",
      },
    ]);
    expect(envPresetsFor(parseCommand("pnpx cowsay"))).toHaveLength(1);
  });

  it("其余 runner/系列不注入", () => {
    expect(envPresetsFor(parseCommand("bunx cowsay"))).toHaveLength(0);
    expect(envPresetsFor(parseCommand("deno run npm:cowsay"))).toHaveLength(0);
    expect(envPresetsFor(parseCommand("go run rsc.io/fortune@latest"))).toHaveLength(0);
    expect(envPresetsFor(parseCommand("uvx ruff"))).toHaveLength(0);
    expect(envPresetsFor(parseCommand("dnx dotnet-format"))).toHaveLength(0);
    expect(envPresetsFor(parseCommand("docker compose up -d"))).toHaveLength(0);
  });
});
