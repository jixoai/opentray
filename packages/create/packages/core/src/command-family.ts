// Orthogonal intents (maintained 2026-08-19; original user request: create-opentray
// 命令配置支持业内流行命令系列（npm/go/rust/python/.NET/自定义）的分系列默认 appId、
// 结构化参数输入与 npm 系列环境变量预设 — governed by openspec change
// add-create-command-family):
// 1. 解析命令 token 流 → 系列表单状态（plan.md D2/D9：服务端单一解析权威）。
// 2. 分系列默认 appId 推导：runner 归一身份段 + 固定生态尾段（D3）。
// 3. npm 系列（npx/pnpx）确认跳过环境变量预设推导（D4）。
// 4. 系列表单状态 ↔ 命令串行化（含 Rust 两段式、deno npm: 前缀）。
// 依赖约束：本模块必须保持纯函数、无平台依赖 —— create-webui 以手工镜像复用
// （仓内 wizard-protocol.ts 模式），修改此处必须同步镜像与金样本测试。

import { deriveDefaultAppId } from "./app-id";
import { tokenizeCommandLine } from "./tokenize";

export type Family = "npm" | "go" | "rust" | "python" | "dotnet" | "custom";

export const FAMILY_ORDER: readonly Family[] = [
  "npm",
  "go",
  "rust",
  "python",
  "dotnet",
  "custom",
];

export const FAMILY_LABEL: Record<Family, string> = {
  npm: "npm",
  go: "Go",
  rust: "Rust",
  python: "Python",
  dotnet: ".NET",
  custom: "自定义",
};

/** 固定生态尾段（用户 2026-08-19 拍板「全名」方案）。 */
export const FAMILY_TAIL: Record<Exclude<Family, "custom">, string> = {
  npm: "npmjs",
  go: "golang",
  rust: "rust",
  python: "python",
  dotnet: "dotnet",
};

/** npm 系列的 runner 头（多词 runner 用空格连接）。 */
export const NPM_RUNNERS: readonly string[] = [
  "npx",
  "pnpx",
  "bunx",
  "yarn dlx",
  "nubx",
  "deno run",
  "vpx",
];

export const PYTHON_RUNNERS: readonly string[] = ["uvx", "pipx run"];

export interface FamilyFormState {
  readonly family: Family;
  /** npm/python 系列的 runner（如 `npx`、`yarn dlx`、`uvx`、`pipx run`）。 */
  readonly runner: string;
  /** runner 与包名之间的选项 token（如 `deno run -A` 的 `-A`）。 */
  readonly runnerFlags: string;
  /** 包名 / module 路径 / crate / 工具 ID（保持用户输入原样）。 */
  readonly pkg: string;
  /** 空串 = latest/省略。 */
  readonly version: string;
  /** 包名之后的参数（原样字符串）。 */
  readonly args: string;
  /** 仅 Rust：运行二进制名；空串 = 与 crate 同名。 */
  readonly binary: string;
  /** 仅自定义：完整自由命令。 */
  readonly raw: string;
}

export const EMPTY_FAMILY_STATE: FamilyFormState = {
  family: "npm",
  runner: "npx",
  runnerFlags: "",
  pkg: "",
  version: "",
  args: "",
  binary: "",
  raw: "",
};

const isOptionToken = (token: string): boolean =>
  token.startsWith("-") && token.length > 1;

/** `npm:cowsay@latest` → base `npm:cowsay` + version `latest`；`@scope/name` 不误拆。 */
const splitPackageVersion = (pkg: string): { base: string; version: string } => {
  const at = pkg.lastIndexOf("@");
  if (at > 0) {
    return { base: pkg.slice(0, at), version: pkg.slice(at + 1) };
  }
  return { base: pkg, version: "" };
};

const joinParts = (parts: readonly string[]): string =>
  parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");

const withVersion = (pkg: string, version: string): string => {
  if (version.trim().length === 0) {
    return pkg;
  }
  const { version: existing } = splitPackageVersion(pkg);
  if (existing.length > 0) {
    return pkg;
  }
  return `${pkg}@${version.trim()}`;
};

const denoNpmPackage = (pkg: string): string =>
  /^(npm|jsr):/.test(pkg) ? pkg : `npm:${pkg}`;

// 参数保真（plan.md D12 / Codex B5）：FamilyFormState.args 保存「序列化后的
// 参数串」。serializeArg 与 tokenizeCommandLine 的 POSIX 语义对称——含空白/
// 引号/元字符的 token 以单引号包裹（内部 ' 转义为 '\''），保证
// tokenize(build(parse(cmd))) 与原 tokens 逐项相等；空 token 序列化为 ''。
const ARG_SAFE = /^[A-Za-z0-9@._/:+=-]+$/u;
const serializeArg = (token: string): string => {
  if (ARG_SAFE.test(token) && token.length > 0) {
    return token;
  }
  return `'${token.replaceAll("'", `'\\''`)}'`;
};

export const serializeArgs = (tokens: readonly string[]): string =>
  tokens.map(serializeArg).join(" ");

/** Rust 安装头命令（cargo install …）：系列可解析，但向导绝不代执行（D7/D11）。 */
export const isRustInstallCommand = (tokens: readonly string[]): boolean =>
  (tokens[0] ?? "") === "cargo" && (tokens[1] ?? "") === "install";

/** 跳过前导选项 token，返回 { runner 选项, 其余（首 token 必为非选项）}。 */
const splitLeadingFlags = (
  tokens: readonly string[],
): { flags: string[]; rest: string[] } => {
  const flags: string[] = [];
  let index = 0;
  while (index < tokens.length && isOptionToken(tokens[index] ?? "")) {
    flags.push(tokens[index] ?? "");
    index += 1;
  }
  return { flags, rest: tokens.slice(index) };
};

// 带值 flag 保真（plan.md D12 / Codex R2-B2）：runner 与包名之间的选项区只
// 接受一个保守的「已知无值 flag」白名单（deno 的 -A/--allow-*/--no-* 等、
// npx 的 -y/--yes）。白名单之外出现任何 option token（如 deno --config
// <path>、npx -c <cmd>，其值会被误当包名），整条命令保守回落 custom，
// 绝不静默改义；带 `=` 的长选项一律视为带值。
const VALUELESS_RUNNER_FLAGS: readonly Set<string>[] = [
  new Set([
    "-A",
    "--allow-all",
    "--allow-read",
    "--allow-write",
    "--allow-net",
    "--allow-env",
    "--allow-run",
    "--allow-sys",
    "--allow-ffi",
    "--allow-hrtime",
    "--no-check",
    "--no-remote",
    "--quiet",
    "-q",
    "--cached-only",
  ]),
  new Set(["-y", "--yes"]),
];

const isKnownValuelessFlag = (token: string): boolean => {
  if (token.includes("=")) {
    return false;
  }
  return VALUELESS_RUNNER_FLAGS.some((set) => set.has(token));
};

/** runner 选项区是否可无歧义解析（全为已知无值 flag）。 */
export const runnerFlagsAreUnambiguous = (
  flags: readonly string[],
): boolean => flags.every((flag) => isKnownValuelessFlag(flag));

const matchHead = (tokens: readonly string[], head: string): number => {
  const parts = head.split(" ");
  if (tokens.length < parts.length) {
    return -1;
  }
  for (let index = 0; index < parts.length; index += 1) {
    if ((tokens[index] ?? "") !== (parts[index] ?? "")) {
      return -1;
    }
  }
  return parts.length;
};

const familyState = (patch: Partial<FamilyFormState>): FamilyFormState => ({
  ...EMPTY_FAMILY_STATE,
  ...patch,
});

// 带值/未知 runner flag 无法无歧义映射到结构化字段（其值会被误当包名）：
// 保守回落 custom，绝不静默改义（plan.md D12 / Codex R2-B2）。
const ambiguousToCustom = (tokens: readonly string[]): FamilyFormState =>
  familyState({ family: "custom", raw: serializeArgs(tokens) });

/** 已有 token 流 → 系列表单状态（wizard prime/submit 的服务端入口）。 */
export const parseCommandTokens = (
  tokens: readonly string[],
): FamilyFormState => {
  const first = tokens[0] ?? "";
  const second = tokens[1] ?? "";

  for (const runner of NPM_RUNNERS) {
    const consumed = matchHead(tokens, runner);
    if (consumed > 0) {
      const { flags, rest } = splitLeadingFlags(tokens.slice(consumed));
      if (!runnerFlagsAreUnambiguous(flags)) {
        return ambiguousToCustom(tokens);
      }
      const pkgToken = rest[0] ?? "";
      const { base, version } =
        pkgToken.length > 0
          ? splitPackageVersion(pkgToken)
          : { base: "", version: "" };
      return familyState({
        family: "npm",
        runner,
        runnerFlags: flags.join(" "),
        pkg: base,
        version,
        args: serializeArgs(rest.slice(1)),
        raw: tokens.join(" "),
      });
    }
  }

  if (first === "go" && second === "run") {
    const { flags, rest } = splitLeadingFlags(tokens.slice(2));
    if (!runnerFlagsAreUnambiguous(flags)) {
      return ambiguousToCustom(tokens);
    }
    const moduleToken = rest[0] ?? "";
    const { base, version } =
      moduleToken.length > 0
        ? splitPackageVersion(moduleToken)
        : { base: "", version: "" };
    return familyState({
      family: "go",
      runner: "",
      runnerFlags: flags.join(" "),
      pkg: base,
      version,
      args: serializeArgs(rest.slice(1)),
      raw: tokens.join(" "),
    });
  }

  if (first === "cargo" && second === "install") {
    const { flags, rest } = splitLeadingFlags(tokens.slice(2));
    if (!runnerFlagsAreUnambiguous(flags)) {
      return ambiguousToCustom(tokens);
    }
    const crateToken = rest[0] ?? "";
    const base =
      crateToken.length > 0 ? splitPackageVersion(crateToken).base : "";
    return familyState({
      family: "rust",
      runner: "",
      runnerFlags: flags.join(" "),
      pkg: base,
      args: serializeArgs(rest.slice(1)),
      raw: tokens.join(" "),
    });
  }

  if (first === "uvx" || (first === "pipx" && second === "run")) {
    const consumed = first === "uvx" ? 1 : 2;
    const { flags, rest } = splitLeadingFlags(tokens.slice(consumed));
    if (!runnerFlagsAreUnambiguous(flags)) {
      return ambiguousToCustom(tokens);
    }
    const pkgToken = rest[0] ?? "";
    const { base, version } =
      pkgToken.length > 0
        ? splitPackageVersion(pkgToken)
        : { base: "", version: "" };
    return familyState({
      family: "python",
      runner: first === "uvx" ? "uvx" : "pipx run",
      runnerFlags: flags.join(" "),
      pkg: base,
      version,
      args: serializeArgs(rest.slice(1)),
      raw: tokens.join(" "),
    });
  }

  if (first === "dnx") {
    const { flags, rest } = splitLeadingFlags(tokens.slice(1));
    if (!runnerFlagsAreUnambiguous(flags)) {
      return ambiguousToCustom(tokens);
    }
    const toolToken = rest[0] ?? "";
    const { base, version } =
      toolToken.length > 0
        ? splitPackageVersion(toolToken)
        : { base: "", version: "" };
    return familyState({
      family: "dotnet",
      runner: "",
      runnerFlags: flags.join(" "),
      pkg: base,
      version,
      args: serializeArgs(rest.slice(1)),
      raw: tokens.join(" "),
    });
  }

  return familyState({ family: "custom", raw: serializeArgs(tokens) });
};

/** 自由命令文本 → 系列表单状态；未识别任何系列头回落 custom（D9）。 */
export const parseCommand = (text: string): FamilyFormState => {
  const result = tokenizeCommandLine(text);
  if (!result.ok || result.tokens.length === 0) {
    // 输入中断（未闭合引号等）：安全回落自定义，交由上层既有错误路径处理。
    return familyState({ family: "custom", raw: text });
  }
  return parseCommandTokens(result.tokens);
};

/** Rust 两段式：先 `cargo install`，再运行二进制（D7：安装仅为展示，不代执行）。 */
export const buildRustCommands = (
  state: FamilyFormState,
): { install: string; run: string } => {
  const crate = state.pkg.trim();
  const binary = state.binary.trim().length > 0 ? state.binary.trim() : crate;
  return {
    install: joinParts(["cargo", "install", state.runnerFlags, crate]),
    run: joinParts([binary, state.args]),
  };
};

/** 系列表单状态 → 单行展示命令（Rust 取运行行；完整两段用 buildRustCommands）。 */
export const buildCommand = (state: FamilyFormState): string => {
  switch (state.family) {
    case "custom":
      return state.raw.trim();
    case "rust":
      return buildRustCommands(state).run;
    case "npm": {
      const pkg =
        state.runner === "deno run"
          ? denoNpmPackage(withVersion(state.pkg.trim(), state.version))
          : withVersion(state.pkg.trim(), state.version);
      return joinParts([state.runner, state.runnerFlags, pkg, state.args]);
    }
    case "go":
      return joinParts([
        "go",
        "run",
        state.runnerFlags,
        withVersion(state.pkg.trim(), state.version),
        state.args,
      ]);
    case "python":
      return joinParts([
        state.runner,
        state.runnerFlags,
        withVersion(state.pkg.trim(), state.version),
        state.args,
      ]);
    case "dotnet":
      return joinParts([
        "dnx",
        state.runnerFlags,
        withVersion(state.pkg.trim(), state.version),
        state.args,
      ]);
  }
};

/** 包名 → 身份段：去 npm:/jsr: 前缀、去 @scope、去版本、取末段；Python 的 . _ 归一为 -。 */
const packageToSegment = (pkg: string, family: Family): string => {
  const stripped = pkg.trim().replace(/^(npm|jsr):/, "");
  const segments = stripped
    .split(/[/\\]/)
    .filter((segment) => segment.length > 0 && !segment.startsWith("@"));
  const last = segments[segments.length - 1] ?? stripped;
  let name = splitPackageVersion(last).base.toLowerCase();
  if (family === "python") {
    name = name.replace(/[._]/g, "-");
  }
  return name.replace(/[^a-z0-9-]/g, "");
};

/** 参数中第一个选项 token 之前的子命令段（如 `web`、`format`）。 */
const argSegments = (args: string): string[] => {
  const segments: string[] = [];
  const result = tokenizeCommandLine(args);
  if (!result.ok) {
    return segments;
  }
  for (const token of result.tokens) {
    if (isOptionToken(token)) {
      break;
    }
    const segment = token.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (segment.length === 0) {
      break;
    }
    segments.push(segment);
  }
  return segments;
};

export interface FamilyDerivation {
  /** 生效的默认 appId（无身份段时为 app.opentray 回落）。 */
  readonly appId: string;
  /** 现行（custom）规则在同一命令上的结果，用于对照与回归判定。 */
  readonly legacyAppId: string;
  readonly appName: string;
  readonly identitySegments: readonly string[];
  /** custom 系列 = 旧规则本身（tail 为空）。 */
  readonly tail: string;
  readonly changed: boolean;
}

/**
 * 分系列默认 appId 推导（D3）：身份段 = 选项前子命令段 + 归一化包名（Rust 以
 * 运行二进制为身份），点连接后接固定生态尾段；runner 机制段不参与，同一包换
 * runner 结果不变。custom 系列原样返回现行规则结果。
 */
export const deriveFamily = (state: FamilyFormState): FamilyDerivation => {
  const tokenizeResult = tokenizeCommandLine(buildCommand(state));
  const legacyAppId = deriveDefaultAppId(
    tokenizeResult.ok ? tokenizeResult.tokens : [],
  );
  if (state.family === "custom") {
    return {
      appId: legacyAppId,
      legacyAppId,
      appName:
        legacyAppId === "app.opentray"
          ? "Opentray App"
          : legacyAppId
              .split(".")
              .filter((segment) => segment.length > 0)
              .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
              .join(" "),
      identitySegments: legacyAppId.split("."),
      tail: "",
      changed: false,
    };
  }

  const tail = FAMILY_TAIL[state.family];
  let identity: string[];
  switch (state.family) {
    case "npm":
      identity = [
        ...argSegments(state.args),
        packageToSegment(state.pkg, "npm"),
      ];
      break;
    case "go":
      identity = [
        ...argSegments(state.args),
        packageToSegment(state.pkg, "go"),
      ];
      break;
    case "rust": {
      const crate = packageToSegment(state.pkg, "rust");
      const binary =
        state.binary.trim().length > 0
          ? state.binary.trim().toLowerCase().replace(/[^a-z0-9-]/g, "")
          : crate;
      identity = [...argSegments(state.args), binary];
      break;
    }
    case "python":
      identity = [
        ...argSegments(state.args),
        packageToSegment(state.pkg, "python"),
      ];
      break;
    case "dotnet":
      identity = [
        ...argSegments(state.args),
        packageToSegment(state.pkg, "dotnet"),
      ];
      break;
  }
  const cleaned = identity.filter((segment) => segment.length > 0);
  // identity 已按 appId 顺序构建：子命令在前、包名在后，直接点连接。
  const appId =
    cleaned.length > 0 ? `${cleaned.join(".")}.${tail}` : "app.opentray";
  const appName =
    cleaned.length > 0
      ? cleaned
          .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
          .join(" ")
      : "Opentray App";
  return {
    appId,
    legacyAppId,
    appName,
    identitySegments: cleaned,
    tail,
    changed: appId !== legacyAppId,
  };
};

// ---------------------------------------------------------------------------
// 环境变量预设（D4）
// ---------------------------------------------------------------------------

export interface EnvPreset {
  readonly key: string;
  readonly value: string;
  readonly note: string;
}

/** npmjs 生态的 npx/pnpx 会交互式确认安装，注入 npm_config_yes=true 消除首跑交互。 */
export const envPresetsFor = (state: FamilyFormState): readonly EnvPreset[] => {
  if (state.family === "npm" && (state.runner === "npx" || state.runner === "pnpx")) {
    return [
      {
        key: "npm_config_yes",
        value: "true",
        note: "跳过 npm 安装确认（等效 -y），首次运行无需交互",
      },
    ];
  }
  return [];
};
