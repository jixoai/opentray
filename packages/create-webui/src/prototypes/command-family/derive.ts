// Orthogonal intents (maintained 2026-08-19; original user request: create-opentray
// 命令配置支持业内流行的命令系列（npm/go/rust/python/.NET/自定义），轻设计表单 +
// 分系列默认 appId 生成 + npm 系列自动注入 npm_config_yes=true，用于原型演示):
// 1. 解析自由命令字符串 → 系列表单状态（智能识别用）。
// 2. 分系列默认 appId 推导：身份段反转点连接 + 固定生态尾段（npmjs/golang/rust/python/dotnet），
//    丢弃 runner 机制段，使同一包换 runner 结果不变。
// 3. 保留旧规则推导用于新旧对照（镜像 packages/create/packages/core/src/app-id.ts，跨包不 import）。
// 4. 系列表单状态 → 展示命令串行化（含 Rust 两段式、deno 的 npm: 前缀）。

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

/** 固定生态尾段（用户已选定「全名」方案）。 */
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

/** 引号感知的轻量分词（镜像 wizard 的 tokenize 语义，仅演示用）。 */
export const tokenizeCommand = (input: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of input) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started || current.length > 0) {
        tokens.push(current);
        current = "";
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (started || current.length > 0) {
    tokens.push(current);
  }
  return tokens;
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

/** 自由命令 → 系列表单状态。未识别任何系列头时回落 custom。 */
export const parseCommand = (text: string): FamilyFormState => {
  const tokens = tokenizeCommand(text);
  const first = tokens[0] ?? "";
  const second = tokens[1] ?? "";

  for (const runner of NPM_RUNNERS) {
    const consumed = matchHead(tokens, runner);
    if (consumed > 0) {
      const { flags, rest } = splitLeadingFlags(tokens.slice(consumed));
      const pkgToken = rest[0] ?? "";
      const { base, version } =
        pkgToken.length > 0 ? splitPackageVersion(pkgToken) : { base: "", version: "" };
      return familyState({
        family: "npm",
        runner,
        runnerFlags: flags.join(" "),
        pkg: base,
        version,
        args: rest.slice(1).join(" "),
        raw: text,
      });
    }
  }

  if (first === "go" && second === "run") {
    const { flags, rest } = splitLeadingFlags(tokens.slice(2));
    const moduleToken = rest[0] ?? "";
    const { base, version } =
      moduleToken.length > 0 ? splitPackageVersion(moduleToken) : { base: "", version: "" };
    return familyState({
      family: "go",
      runner: "",
      runnerFlags: flags.join(" "),
      pkg: base,
      version,
      args: rest.slice(1).join(" "),
      raw: text,
    });
  }

  if (first === "cargo" && second === "install") {
    const { flags, rest } = splitLeadingFlags(tokens.slice(2));
    const crateToken = rest[0] ?? "";
    const base =
      crateToken.length > 0 ? splitPackageVersion(crateToken).base : "";
    return familyState({
      family: "rust",
      runner: "",
      runnerFlags: flags.join(" "),
      pkg: base,
      args: rest.slice(1).join(" "),
      raw: text,
    });
  }

  if (first === "uvx" || (first === "pipx" && second === "run")) {
    const consumed = first === "uvx" ? 1 : 2;
    const { flags, rest } = splitLeadingFlags(tokens.slice(consumed));
    const pkgToken = rest[0] ?? "";
    const { base, version } =
      pkgToken.length > 0 ? splitPackageVersion(pkgToken) : { base: "", version: "" };
    return familyState({
      family: "python",
      runner: first === "uvx" ? "uvx" : "pipx run",
      runnerFlags: flags.join(" "),
      pkg: base,
      version,
      args: rest.slice(1).join(" "),
      raw: text,
    });
  }

  if (first === "dnx") {
    const { flags, rest } = splitLeadingFlags(tokens.slice(1));
    const toolToken = rest[0] ?? "";
    const { base, version } =
      toolToken.length > 0 ? splitPackageVersion(toolToken) : { base: "", version: "" };
    return familyState({
      family: "dotnet",
      runner: "",
      runnerFlags: flags.join(" "),
      pkg: base,
      version,
      args: rest.slice(1).join(" "),
      raw: text,
    });
  }

  return familyState({ family: "custom", raw: text });
};

/** Rust 两段式：先 `cargo install`，再运行二进制。 */
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

// ---------------------------------------------------------------------------
// 旧规则（镜像 app-id.ts，用于新旧对照）
// ---------------------------------------------------------------------------

const legacyTokenToSegment = (token: string): string => {
  const segments = token.split(/[/\\]/).filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment.startsWith("@"))) {
    const unscoped = segments.filter((segment) => !segment.startsWith("@"));
    return ((unscoped[unscoped.length - 1] ?? "")).split("@")[0] ?? "";
  }
  const last = segments[segments.length - 1] ?? token;
  return last.split("@")[0] ?? "";
};

export const deriveLegacyAppId = (tokens: readonly string[]): string => {
  const preOption: string[] = [];
  for (const token of tokens) {
    if (isOptionToken(token)) {
      break;
    }
    preOption.push(token);
  }
  const segments = preOption
    .map(legacyTokenToSegment)
    .filter((segment) => segment.length > 0)
    .reverse();
  if (segments.length === 0) {
    return "app.opentray";
  }
  return segments.join(".");
};

// ---------------------------------------------------------------------------
// 新规则：身份段反转 + 生态尾段
// ---------------------------------------------------------------------------

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

export interface DerivationPreview {
  /** 生效的默认 appId（无身份段时为 app.opentray fallback）。 */
  readonly appId: string;
  /** 旧规则在同一命令上的结果（对照用）。 */
  readonly legacyAppId: string;
  readonly appName: string;
  readonly dirName: string;
  /** 身份段（不含生态尾段；appId 顺序 = 子命令在前、包名在后）。 */
  readonly identitySegments: readonly string[];
  /** custom 系列 = 旧规则本身。 */
  readonly tail: string;
  readonly changed: boolean;
}

const toProjectDirectoryName = (appId: string): string => {
  const normalized = appId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "opentray-app";
};

export const derivePreview = (state: FamilyFormState): DerivationPreview => {
  const legacyAppId = deriveLegacyAppId(
    tokenizeCommand(buildCommand(state)),
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
      dirName: toProjectDirectoryName(legacyAppId),
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
      ? cleaned.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" ")
      : "Opentray App";
  return {
    appId,
    legacyAppId,
    appName,
    dirName: toProjectDirectoryName(appId),
    identitySegments: cleaned,
    tail,
    changed: appId !== legacyAppId,
  };
};

// ---------------------------------------------------------------------------
// 环境变量预设
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
