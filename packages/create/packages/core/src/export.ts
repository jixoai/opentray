// Adapter-neutral command/script export (openspec change
// unify-create-opentray-core).
//
// Export serializes the EXACT argv command vector plus every create option
// with shell-appropriate quoting. It never translates the meaning of an
// explicitly selected shell; POSIX sh scripts use LF and single-quote
// escaping, PowerShell scripts use CRLF and native quoting. Uploaded
// resources embed as heredocs/base64 so script export is self-contained,
// while direct command copy defaults to file export and requires an explicit
// force-copy choice. Environment risk uses NO heuristics: any non-empty env
// overlay sets an acknowledgement requirement, and values are never echoed.

import type { CreateConfigV1, IconResourceRef } from "./config";
import type { Result } from "./errors";
import { ok } from "./errors";

export type ExportShell = "sh" | "powershell";

export interface ExportPlanInput {
  readonly config: CreateConfigV1;
  /** Resource bytes to embed (uploads without a stable external path/URL). */
  readonly embeddedResources?: readonly EmbeddedResource[];
  /** Adapter recorded an explicit force-copy choice for direct command copy. */
  readonly forceCopy?: boolean;
}

export interface EmbeddedResource {
  /** CLI flag the bytes feed, e.g. "app-icon". */
  readonly flag: string;
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export interface ExportPlan {
  /**
   * Direct command copy availability. `null` means uploaded bytes are
   * present without an explicit force-copy choice: script export is the
   * default and direct copy requires the recorded override.
   */
  readonly directCommand: { readonly command: readonly string[]; readonly forced: boolean } | null;
  readonly directCommandBlockedReason: string | undefined;
  /** Non-empty env overlay → adapter must collect acknowledgement first. */
  readonly requiresEnvAcknowledgement: boolean;
}

/** Invocation prefix: npx makes the shared command runnable everywhere. */
export const EXPORT_COMMAND_PREFIX = ["npx", "create-opentray", "create"] as const;

/** POSIX single-quote escaping: '…' → '\'' inside a single-quoted string. */
export const quotePosix = (value: string): string =>
  `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * Words that need NO quoting in POSIX sh: no globbing (`*?[`), field
 * splitting (whitespace), or expansion (`$`/backtick) metacharacters.
 */
const POSIX_BARE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** On-demand POSIX quoting: bare-safe words stay unquoted. */
export const bareOrQuotePosix = (value: string): string =>
  POSIX_BARE_TOKEN.test(value) ? value : quotePosix(value);

/** Render an argv vector as a copy-paste-safe POSIX command line. */
export const formatPosixCommandLine = (tokens: readonly string[]): string =>
  tokens.map(bareOrQuotePosix).join(" ");

/**
 * PowerShell native quoting. A bare word needs no quotes; anything else uses
 * single quotes with doubled internal quotes (the only escape PowerShell
 * single-quoted strings support).
 */
export const quotePowerShell = (value: string): string => {
  if (value.length === 0) {
    return "''";
  }
  // `@` is deliberately NOT bare-word safe: a leading @name is PowerShell
  // splatting syntax and changes the argument's meaning entirely.
  if (/^[A-Za-z0-9_%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "''")}'`;
};

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const toCliFlags = (config: CreateConfigV1): readonly string[] => {
  const flags: string[] = [
    "--app-id",
    config.appId,
    "--app-name",
    config.appName,
    "--exec",
    config.command.executable,
    ...config.command.args.flatMap((arg) => ["--arg", arg]),
    "--cwd",
    config.command.cwd,
    "--pm",
    config.packageManager,
  ];
  if (config.icons.appIcon !== undefined) {
    flags.push("--app-icon", config.icons.appIcon.source.ref);
  }
  if (config.icons.trayIcon !== undefined) {
    flags.push("--tray-icon", config.icons.trayIcon.source.ref);
  }
  if (!config.icons.imageSmoothingEnabled) {
    flags.push("--no-image-smoothing");
  }
  if (config.icons.background !== "transparent") {
    flags.push("--icon-background", config.icons.background);
  }
  if (config.icons.scale !== 0.8) {
    flags.push("--icon-scale", String(config.icons.scale));
  }
  if (config.icons.trayTemplate === true) {
    flags.push("--tray-template");
  }
  if (config.developerMode) {
    flags.push("--developer-mode");
  }
  if (config.window.width !== 1_200 || config.window.height !== 800) {
    flags.push("--window", `${config.window.width}x${config.window.height}`);
  }
  for (const [key, value] of Object.entries(config.command.env ?? {})) {
    flags.push("--env", `${key}=${value}`);
  }
  return flags;
};

/** Build the export plan. Env acknowledgement is computed WITHOUT heuristics. */
export const buildExportPlan = (input: ExportPlanInput): Result<ExportPlan> => {
  const envEntries = Object.entries(input.config.command.env ?? {});
  const requiresEnvAcknowledgement = envEntries.length > 0;
  const hasEmbedded = (input.embeddedResources ?? []).length > 0;

  if (hasEmbedded && input.forceCopy !== true) {
    return ok({
      directCommand: null,
      directCommandBlockedReason:
        "uploaded icon bytes have no stable external path; direct command copy would embed very long data — script export is the default, and direct copy requires an explicit force-copy choice",
      requiresEnvAcknowledgement,
    });
  }

  // Direct command copy: exact argv vector, embedded bytes as data URLs.
  const command: string[] = [...EXPORT_COMMAND_PREFIX, ...toCliFlags(input.config)];
  for (const resource of input.embeddedResources ?? []) {
    command.push(`--${resource.flag}`, `data:image/png;base64,${base64(resource.bytes)}`);
  }
  return ok({
    directCommand: { command, forced: input.forceCopy === true },
    directCommandBlockedReason: undefined,
    requiresEnvAcknowledgement,
  });
};

const scriptHeader = (shell: ExportShell): string =>
  shell === "sh"
    ? [
        "#!/bin/sh",
        "# Generated by create-opentray export. Exact argv vector; no shell reinterpretation.",
        "set -eu",
        "",
      ].join("\n")
    : [
        "# Generated by create-opentray export. Exact argv vector; no shell reinterpretation.",
        "$ErrorActionPreference = 'Stop'",
        "",
      ].join("\n");

const writeTempFileSh = (varName: string, name: string, bytes: Uint8Array): string =>
  [
    `${varName}="\$(mktemp -t ${name}.XXXXXX)"`,
    `printf '%s' '${base64(bytes)}' | base64 -d > "\$${varName}"`,
  ].join("\n");

const writeTempFilePwsh = (varName: string, name: string, bytes: Uint8Array): string =>
  [
    `$${varName} = Join-Path ([System.IO.Path]::GetTempPath()) '${name}.png'`,
    `[System.IO.File]::WriteAllBytes($${varName}, [System.Convert]::FromBase64String('${base64(bytes)}'))`,
  ].join("\n");

const safeName = (name: string): string => name.replace(/[^\w.-]/gu, "_");

/** Serialize a complete self-contained script for the target shell. */
export const buildScriptExport = (
  input: ExportPlanInput,
  shell: ExportShell,
): Result<{
  readonly filename: string;
  readonly content: string;
  /** The core invocation line alone (no comments/scaffolding) for copy actions. */
  readonly commandLine: string;
  readonly requiresEnvAcknowledgement: boolean;
}> => {
  const envEntries = Object.entries(input.config.command.env ?? {});
  const requiresEnvAcknowledgement = envEntries.length > 0;
  const lines: string[] = [scriptHeader(shell)];

  // Embedded resources reconstruct validated temp files BEFORE invocation.
  // Each embedded flag gets its own temp variable (never a shared one).
  const flagValues = new Map<string, string>();
  for (const resource of input.embeddedResources ?? []) {
    const varName = `${resource.flag.replaceAll("-", "_")}_tmp`;
    if (shell === "sh") {
      lines.push(writeTempFileSh(varName, safeName(resource.filename), resource.bytes));
      flagValues.set(resource.flag, `"\$${varName}"`);
    } else {
      lines.push(writeTempFilePwsh(varName, safeName(resource.filename), resource.bytes));
      flagValues.set(resource.flag, `$${varName}`);
    }
  }

  // Token-level command assembly with ON-DEMAND quoting: bare-safe words
  // (npx, flags, plain paths, KEY=VALUE) stay unquoted; only tokens with
  // shell metacharacters get quoted. Dynamic temp-var tokens are emitted
  // AS-IS so the shell expands them — blanket quoting previously froze
  // "$app_icon_tmp" into a literal string and broke embedded icons.
  const rendered: string[] = [];
  const quoteToken = (value: string): string =>
    shell === "sh" ? bareOrQuotePosix(value) : quotePowerShell(value);
  rendered.push(...["npx", "create-opentray", "create"].map(quoteToken));
  const flags = toCliFlags(input.config);
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i]!;
    const booleanFlags = new Set([
      "--no-image-smoothing",
      "--tray-template",
      "--developer-mode",
    ]);
    if (booleanFlags.has(flag)) {
      rendered.push(flag);
      continue;
    }
    const value = flags[i + 1] ?? "";
    i += 1;
    if (flag === "--app-icon" && flagValues.has("app-icon")) {
      rendered.push(flag, flagValues.get("app-icon")!); // dynamic var token
      continue;
    }
    if (flag === "--tray-icon" && flagValues.has("tray-icon")) {
      rendered.push(flag, flagValues.get("tray-icon")!); // dynamic var token
      continue;
    }
    rendered.push(quoteToken(flag), quoteToken(value));
  }

  const commandLine = rendered.join(" ");
  lines.push(commandLine);
  lines.push("");

  // POSIX scripts use LF; PowerShell scripts use CRLF deterministically.
  // POSIX scripts use LF; PowerShell scripts use CRLF deterministically
  // (normalize first so no helper-embedded LF can leak through).
  const content =
    shell === "sh"
      ? lines.join("\n")
      : lines.join("\n").replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
  return ok({
    filename: shell === "sh" ? "create-opentray.sh" : "create-opentray.ps1",
    content,
    commandLine,
    requiresEnvAcknowledgement,
  });
};

export interface ExportReview {
  /** Every env entry, editable by the adapter before acknowledgement. */
  readonly envEntries: readonly { readonly key: string; readonly value: string }[];
  readonly requiresAcknowledgement: boolean;
}

/** Present env entries for review. No classification of any name/value. */
export const reviewEnvironment = (config: CreateConfigV1): ExportReview => {
  const envEntries = Object.entries(config.command.env ?? {}).map(([key, value]) => ({ key, value }));
  return {
    envEntries,
    requiresAcknowledgement: envEntries.length > 0,
  };
};

/** Re-export helper for adapters that carry refs, not raw bytes. */
export const embeddedFromRef = (
  flag: string,
  ref: IconResourceRef,
  bytes: Uint8Array,
): EmbeddedResource => ({
  flag,
  filename: ref.path.split("/").pop() ?? "icon.png",
  bytes,
});
