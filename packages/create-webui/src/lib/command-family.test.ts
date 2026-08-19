// 镜像防漂移金样本（add-create-command-family D9）：这些期望与
// packages/create/packages/core/src/command-family.test.ts 同源；两处修改必须同步。
import { describe, expect, it } from "vitest";

import {
  buildCommand,
  deriveFamily,
  envPresetsFor,
  explicitEnvValue,
  parseCommand,
  toProjectDirectoryName,
} from "./command-family";

const appIdOf = (command: string): string => deriveFamily(parseCommand(command)).appId;

describe("command-family 镜像金样本（与 core 同源）", () => {
  it("分系列 appId 与 core 一致", () => {
    expect(appIdOf("npx @deepseek-ai/dsh@latest web")).toBe("web.dsh.npmjs");
    expect(appIdOf("bunx cowsay hello")).toBe("hello.cowsay.npmjs");
    expect(appIdOf("deno run -A npm:cowsay@latest hello")).toBe(
      "hello.cowsay.npmjs",
    );
    expect(appIdOf("go run rsc.io/fortune@latest")).toBe("fortune.golang");
    expect(appIdOf("uvx ruff format --check .")).toBe("format.ruff.python");
    expect(appIdOf("pipx run black")).toBe("black.python");
    expect(appIdOf("dnx dotnet-format --verify-no-changes")).toBe(
      "dotnet-format.dotnet",
    );
    expect(appIdOf("docker compose up -d")).toBe("up.compose.docker");
    expect(appIdOf("")).toBe("app.opentray");
  });

  it("rust 以运行二进制为身份", () => {
    const state = {
      ...parseCommand("cargo install ripgrep"),
      binary: "rg",
      args: "--json .",
    };
    expect(deriveFamily(state).appId).toBe("rg.rust");
    expect(deriveFamily(parseCommand("cargo install ripgrep")).appId).toBe(
      "ripgrep.rust",
    );
  });

  it("parse ↔ build 往返与 deno npm: 补全", () => {
    expect(buildCommand(parseCommand("npx @deepseek-ai/dsh@latest web"))).toBe(
      "npx @deepseek-ai/dsh@latest web",
    );
    expect(buildCommand(parseCommand("deno run -A cowsay@latest hello"))).toBe(
      "deno run -A npm:cowsay@latest hello",
    );
  });

  it("引号/转义参数往返逐项无损（D12 / Codex R3-B2，shell-quote 同源）", () => {
    const command = 'npx tool "hello world" x';
    const parsed = parseCommand(command);
    expect(parsed.args).toBe("'hello world' x");
    // 序列化串再分词与原命令 tokens 一致。
    const rebuilt = buildCommand(parsed);
    expect(parseCommand(rebuilt).args).toBe("'hello world' x");
    expect(parseCommand('npx tool "" x').args).toBe("'' x");
    // 反斜杠转义空格：shell-quote 解析为单 token，往返不拆不丢。
    const escaped = parseCommand("npx tool a\\ b");
    expect(escaped.args).toBe("'a b'");
    expect(buildCommand(escaped)).toBe("npx tool 'a b'");
  });

  it("带值/未知 runner flag 保守回落 custom（与 core 同源）", () => {
    expect(parseCommand("deno run --config 'path with spaces' npm:cowsay").family).toBe(
      "custom",
    );
    expect(parseCommand("npx -c 'echo hi'").family).toBe("custom");
    expect(parseCommand("deno run -A npm:cowsay@latest hello").family).toBe("npm");
    expect(parseCommand("npx -y create-vite").family).toBe("npm");
  });

  it("重复 env 键取最后一项（last-wins，与服务端一致）", () => {
    expect(
      explicitEnvValue(
        [
          { key: "npm_config_yes", value: "false" },
          { key: "npm_config_yes", value: "true" },
        ],
        "npm_config_yes",
      ),
    ).toBe("true");
    expect(explicitEnvValue([{ key: "FOO", value: "1" }], "npm_config_yes")).toBeUndefined();
  });

  it("tokenizer 差分：未闭合引号/重定向/命令替换均回落 custom（与 core 同源）", () => {
    expect(parseCommand('npx tool "unclosed').family).toBe("custom");
    expect(parseCommand("npx tool a<b").family).toBe("custom");
    expect(parseCommand("npx tool $(whoami)").family).toBe("custom");
  });

  it("名称/目录投影与 env 预设边界", () => {
    const family = deriveFamily(parseCommand("npx @deepseek-ai/dsh@latest web"));
    expect(family.appName).toBe("Web Dsh");
    expect(toProjectDirectoryName(family.appId)).toBe("web-dsh-npmjs");
    expect(envPresetsFor(parseCommand("npx cowsay"))).toHaveLength(1);
    expect(envPresetsFor(parseCommand("bunx cowsay"))).toHaveLength(0);
  });
});
