// Orthogonal intents (maintained 2026-08-19; original user request: 原型里预置各系列
// 真实命令，点击即自动填充表单，供用户查看系列表单与默认 appId 推导效果):
// 1. 覆盖全部 6 个系列的可点击预设命令。
// 2. 每个预设携带完整 FamilyFormState 与展示命令（Rust 为「安装 → 运行」两段）。

import {
  buildCommand,
  buildRustCommands,
  type Family,
  type FamilyFormState,
} from "./derive";

export interface CommandPreset {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  readonly family: Family;
  readonly state: FamilyFormState;
  readonly command: string;
}

const make = (
  id: string,
  title: string,
  hint: string,
  state: FamilyFormState,
): CommandPreset => ({
  id,
  title,
  hint,
  family: state.family,
  state,
  command:
    state.family === "rust"
      ? `${buildRustCommands(state).install} → ${buildRustCommands(state).run}`
      : buildCommand(state),
});

export const PRESETS: readonly CommandPreset[] = [
  make(
    "dsh",
    "DeepSeek CLI",
    "对话式 AI CLI（仓库经典示例）",
    {
      family: "npm",
      runner: "npx",
      runnerFlags: "",
      pkg: "@deepseek-ai/dsh",
      version: "latest",
      args: "web",
      binary: "",
      raw: "",
    },
  ),
  make(
    "cowsay-bunx",
    "cowsay",
    "bunx 直跑 npm 包",
    {
      family: "npm",
      runner: "bunx",
      runnerFlags: "",
      pkg: "cowsay",
      version: "",
      args: "hello",
      binary: "",
      raw: "",
    },
  ),
  make(
    "cowsay-deno",
    "cowsay · Deno",
    "deno run npm: 指定符",
    {
      family: "npm",
      runner: "deno run",
      runnerFlags: "-A",
      pkg: "npm:cowsay",
      version: "latest",
      args: "hello",
      binary: "",
      raw: "",
    },
  ),
  make(
    "create-vite",
    "create-vite",
    "npx 脚手架",
    {
      family: "npm",
      runner: "npx",
      runnerFlags: "",
      pkg: "create-vite",
      version: "latest",
      args: "",
      binary: "",
      raw: "",
    },
  ),
  make(
    "fortune",
    "fortune",
    "Go 官方示例模块",
    {
      family: "go",
      runner: "",
      runnerFlags: "",
      pkg: "rsc.io/fortune",
      version: "latest",
      args: "",
      binary: "",
      raw: "",
    },
  ),
  make(
    "fzf",
    "fzf",
    "模糊搜索器",
    {
      family: "go",
      runner: "",
      runnerFlags: "",
      pkg: "github.com/junegunn/fzf",
      version: "latest",
      args: "",
      binary: "",
      raw: "",
    },
  ),
  make(
    "ripgrep",
    "ripgrep",
    "cargo install → rg",
    {
      family: "rust",
      runner: "",
      runnerFlags: "",
      pkg: "ripgrep",
      version: "",
      args: "--json .",
      binary: "rg",
      raw: "",
    },
  ),
  make(
    "nextest",
    "cargo-nextest",
    "Rust 测试运行器",
    {
      family: "rust",
      runner: "",
      runnerFlags: "",
      pkg: "cargo-nextest",
      version: "",
      args: "run",
      binary: "cargo-nextest",
      raw: "",
    },
  ),
  make(
    "ruff",
    "ruff",
    "uvx 运行 Python 工具",
    {
      family: "python",
      runner: "uvx",
      runnerFlags: "",
      pkg: "ruff",
      version: "latest",
      args: "format --check .",
      binary: "",
      raw: "",
    },
  ),
  make(
    "black",
    "black",
    "pipx run 代码格式化",
    {
      family: "python",
      runner: "pipx run",
      runnerFlags: "",
      pkg: "black",
      version: "",
      args: "",
      binary: "",
      raw: "",
    },
  ),
  make(
    "dotnet-format",
    "dotnet-format",
    ".NET 10 dnx 临时运行工具",
    {
      family: "dotnet",
      runner: "",
      runnerFlags: "",
      pkg: "dotnet-format",
      version: "",
      args: "--verify-no-changes",
      binary: "",
      raw: "",
    },
  ),
  make(
    "docker-compose",
    "docker compose",
    "自由命令",
    {
      family: "custom",
      runner: "",
      runnerFlags: "",
      pkg: "",
      version: "",
      args: "",
      binary: "",
      raw: "docker compose up -d",
    },
  ),
  make(
    "ollama",
    "ollama",
    "本地模型服务",
    {
      family: "custom",
      runner: "",
      runnerFlags: "",
      pkg: "",
      version: "",
      args: "",
      binary: "",
      raw: "ollama serve",
    },
  ),
];

export const presetById = (id: string): CommandPreset | undefined =>
  PRESETS.find((preset) => preset.id === id);
