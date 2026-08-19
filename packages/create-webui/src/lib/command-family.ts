// 镜像 @create-opentray/core 的 src/command-family.ts（add-create-command-family
// D9：webui 不引 workspace 依赖，沿用 wizard-protocol.ts 手工镜像模式）。
// 权威在 core；此处修改必须与 core 同步，金样本测试 command-family.test.ts
// 防漂移。tokenizer 与 core 同源使用 shell-quote（Codex R3-B2：命令向量是
// 执行合同，客户端不容轻量近似；配平/op 拒绝逻辑与 core tokenizeCommandLine
// 逐行对齐，仅返回形状不同——!ok 一律返回空数组走 custom 回落）。

import { parse as shellQuoteParse } from "shell-quote";

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
  readonly runner: string;
  readonly runnerFlags: string;
  readonly pkg: string;
  readonly version: string;
  readonly args: string;
  readonly binary: string;
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

/** 与 core tokenizeCommandLine 同源的 shell-quote 分词（!ok → 空数组）。 */
export const tokenizeCommand = (input: string): string[] => {
  // 配平检查（与 core 逐行对齐）：未闭合引号视为 mid-edit，保守回落。
  if (/["']/.test(input)) {
    const single = (input.match(/'/gu) ?? []).length;
    const double = (input.match(/"/gu) ?? []).length;
    if (single % 2 === 1 || double % 2 === 1) {
      return [];
    }
  }
  const parsed = shellQuoteParse(input);
  const tokens: string[] = [];
  for (const node of parsed) {
    if (typeof node !== "string") {
      // 命令替换/重定向运算符：对 spawn 向量无意义且危险，拒绝整条。
      return [];
    }
    tokens.push(node);
  }
  return tokens.length === 0 ? [] : tokens;
};

const isOptionToken = (token: string): boolean =>
  token.startsWith("-") && token.length > 1;

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

// 参数保真（plan.md D12 / Codex B5）：args 保存「序列化后的参数串」，与 core
// 的 POSIX 对称序列化一致；保证域 = tokenizer 接受域。
const ARG_SAFE = /^[A-Za-z0-9@._/:+=-]+$/u;
const serializeArg = (token: string): string => {
  if (ARG_SAFE.test(token) && token.length > 0) {
    return token;
  }
  return `'${token.replaceAll("'", `'\\''`)}'`;
};

export const serializeArgs = (tokens: readonly string[]): string =>
  tokens.map(serializeArg).join(" ");

/** Rust 安装头命令（cargo install …）：向导绝不代执行（D7/D11）。 */
export const isRustInstallCommand = (tokens: readonly string[]): boolean =>
  (tokens[0] ?? "") === "cargo" && (tokens[1] ?? "") === "install";

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

// 与 core 同源：runner 选项区仅接受已知无值 flag 白名单；带值/未知 flag
// 保守回落 custom（D12 / Codex R2-B2）。
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

// 带值/未知 runner flag 保守回落 custom，raw 用序列化保真（与 core 同源）。
const ambiguousToCustom = (tokens: readonly string[]): FamilyFormState =>
  familyState({ family: 'custom', raw: serializeArgs(tokens) });

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

export const parseCommand = (text: string): FamilyFormState => {
  const tokens = tokenizeCommand(text);
  if (tokens.length === 0) {
    return familyState({ family: "custom", raw: text });
  }
  return parseCommandTokens(tokens);
};

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

const argSegments = (args: string): string[] => {
  const segments: string[] = [];
  for (const token of tokenizeCommand(args)) {
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
  readonly appId: string;
  readonly appName: string;
  readonly identitySegments: readonly string[];
  readonly tail: string;
}

/** 分系列默认 appId（与 core deriveFamily 同结果；custom 走旧规则镜像）。 */
export const deriveFamily = (state: FamilyFormState): FamilyDerivation => {
  if (state.family === "custom") {
    // 旧规则镜像（app-id.ts）：选项前 token 归一化反转点连接。
    const preOption: string[] = [];
    for (const token of tokenizeCommand(state.raw)) {
      if (isOptionToken(token)) {
        break;
      }
      preOption.push(token);
    }
    const segments = preOption
      .map((token) => {
        const parts = token.split(/[/\\]/).filter((part) => part.length > 0);
        if (parts.some((part) => part.startsWith("@"))) {
          const unscoped = parts.filter((part) => !part.startsWith("@"));
          return ((unscoped[unscoped.length - 1] ?? "")).split("@")[0] ?? "";
        }
        return (parts[parts.length - 1] ?? token).split("@")[0] ?? "";
      })
      .filter((segment) => segment.length > 0)
      .reverse();
    const appId = segments.length > 0 ? segments.join(".") : "app.opentray";
    return {
      appId,
      appName:
        appId === "app.opentray"
          ? "Opentray App"
          : appId
              .split(".")
              .filter((segment) => segment.length > 0)
              .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
              .join(" "),
      identitySegments: segments,
      tail: "",
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
  return { appId, appName, identitySegments: cleaned, tail };
};

export const toProjectDirectoryName = (appId: string): string => {
  const normalized = appId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "opentray-app";
};

export interface EnvPreset {
  readonly key: string;
  readonly value: string;
  readonly note: string;
}

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
