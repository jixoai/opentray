// V1 configuration authority (openspec change unify-create-opentray-core).
//
// `create-opentray.json` is the SOLE editable desired-state authority. Every
// generated file (entry, package manifest, icon catalogs, runtime
// descriptors) is derived output and never a competing authority.

import { isAbsolute, join, normalize, sep } from "node:path";

import { isValidAppId } from "./app-id";
import { err, ok, type Result } from "./errors";

export const CONFIG_SCHEMA_VERSION = 1 as const;
export const CONFIG_FILENAME = "create-opentray.json";

export type PackageManagerName = "npm" | "pnpm" | "bun";
export type ImageFormat = "png" | "jpeg" | "webp" | "gif" | "svg";
export type IconBackgroundName = "black" | "white" | "transparent";

/** Provenance of a committed registration resource. */
export interface ResourceSource {
  readonly kind: "file" | "http" | "data";
  /** Original path or URL as supplied by the caller (provenance only). */
  readonly ref: string;
}

/** Relative stable reference to a registration-owned resource file. */
export interface IconResourceRef {
  /** Path relative to the registration directory (e.g. "app-icon.png"). */
  readonly path: string;
  readonly format: ImageFormat;
  /** SHA-256 hex digest of the committed bytes. */
  readonly sha256: string;
  readonly source: ResourceSource;
}

export interface IconsConfig {
  /** Application icon source; omitted → glyph fallback at apply time. */
  readonly appIcon?: IconResourceRef;
  /** Tray icon source; omission explicitly follows the app icon source. */
  readonly trayIcon?: IconResourceRef;
  /** v1 sampling intent; default true. Governs every Core resize path. */
  readonly imageSmoothingEnabled: boolean;
  readonly background: IconBackgroundName;
  readonly scale: number;
  /** Tray source is a solid silhouette (darwin template tinting). */
  readonly trayTemplate?: boolean;
}

/** Exact process vector — never an implicitly interpreted shell string. */
export interface CommandConfig {
  readonly executable: string;
  readonly args: readonly string[];
  /** Absolute working directory. */
  readonly cwd: string;
  /** Overlay merged over the runtime environment. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface WindowConfig {
  readonly width: number;
  readonly height: number;
}

export interface CreateConfigV1 {
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  readonly appId: string;
  readonly appName: string;
  readonly command: CommandConfig;
  readonly packageManager: PackageManagerName;
  readonly icons: IconsConfig;
  readonly window: WindowConfig;
  /** Maps only to WebView `devtools` admission; default false. */
  readonly developerMode: boolean;
}

export const DEFAULT_WINDOW: WindowConfig = { width: 1_200, height: 800 };
export const DEFAULT_ICON_SCALE = 0.8;
export const ICON_SCALE_MIN = 0.5;
export const ICON_SCALE_MAX = 0.95;

const IMAGE_FORMATS: readonly ImageFormat[] = ["png", "jpeg", "webp", "gif", "svg"];
const PACKAGE_MANAGERS: readonly PackageManagerName[] = ["npm", "pnpm", "bun"];
const BACKGROUNDS: readonly IconBackgroundName[] = ["black", "white", "transparent"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** True when `path` stays inside `parent` (both may be relative or absolute). */
export const isContainedPath = (parent: string, path: string): boolean => {
  const resolved = isAbsolute(path) ? normalize(path) : normalize(join(parent, path));
  const base = normalize(parent);
  if (resolved === base) {
    return false; // the parent itself is not a contained child
  }
  return resolved.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
};

/** Validate a resource path relative to the registration directory. */
const validateRelativeResourcePath = (
  path: unknown,
): { ok: true; path: string } | { ok: false; message: string } => {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, message: "resource path must be a non-empty string" };
  }
  if (isAbsolute(path)) {
    return { ok: false, message: `resource path must be relative, got absolute: ${path}` };
  }
  if (path.split(/[\\/]/u).some((segment) => segment === "..")) {
    return { ok: false, message: `resource path must not escape the registration: ${path}` };
  }
  const normalized = normalize(path);
  if (normalized === ".." || normalized.startsWith("..")) {
    return { ok: false, message: `resource path escapes the registration: ${path}` };
  }
  return { ok: true, path: normalized.split(sep).join("/") };
};

const parseResourceSource = (value: unknown): ResourceSource | { message: string } => {
  if (!isRecord(value)) {
    return { message: "resource source must be an object" };
  }
  const kind = value.kind;
  const ref = value.ref;
  if (kind !== "file" && kind !== "http" && kind !== "data") {
    return { message: "resource source kind must be file, http, or data" };
  }
  if (typeof ref !== "string" || ref.length === 0) {
    return { message: "resource source ref must be a non-empty string" };
  }
  return { kind, ref };
};

const parseIconResourceRef = (
  value: unknown,
  field: string,
): IconResourceRef | { message: string } => {
  if (!isRecord(value)) {
    return { message: `${field} must be an object` };
  }
  const pathCheck = validateRelativeResourcePath(value.path);
  if (!pathCheck.ok) {
    return { message: `${field}: ${pathCheck.message}` };
  }
  if (typeof value.format !== "string" || !IMAGE_FORMATS.includes(value.format as ImageFormat)) {
    return { message: `${field}: format must be one of ${IMAGE_FORMATS.join(", ")}` };
  }
  if (typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256)) {
    return { message: `${field}: sha256 must be a 64-char hex digest` };
  }
  const source = parseResourceSource(value.source);
  if ("message" in source) {
    return { message: `${field}: ${source.message}` };
  }
  return {
    path: pathCheck.path,
    format: value.format as ImageFormat,
    sha256: value.sha256,
    source,
  };
};

const parseCommand = (value: unknown): CommandConfig | { message: string } => {
  if (!isRecord(value)) {
    return { message: "command must be an object" };
  }
  if (typeof value.executable !== "string" || value.executable.trim().length === 0) {
    return { message: "command.executable must be a non-empty string" };
  }
  if (!isStringArray(value.args)) {
    return { message: "command.args must be an array of strings" };
  }
  if (typeof value.cwd !== "string" || value.cwd.length === 0 || !isAbsolute(value.cwd)) {
    return { message: "command.cwd must be an absolute path" };
  }
  if (value.env !== undefined) {
    if (!isRecord(value.env)) {
      return { message: "command.env must be an object" };
    }
    for (const [key, entry] of Object.entries(value.env)) {
      if (key.trim().length === 0) {
        return { message: "command.env keys must be non-empty" };
      }
      if (typeof entry !== "string") {
        return { message: `command.env["${key}"] must be a string` };
      }
    }
  }
  return {
    executable: value.executable,
    args: value.args,
    cwd: value.cwd,
    ...(value.env === undefined ? {} : { env: value.env as Record<string, string> }),
  };
};

/**
 * Strict v1 parse. Unknown future schema versions are reported as
 * `incompatible_version` read-only evidence; every other structural problem
 * is an `invalid_config` typed failure. No mutation ever results from parse.
 */
export const parseCreateConfig = (raw: unknown): Result<CreateConfigV1> => {
  if (!isRecord(raw)) {
    return err("invalid_config", "configuration must be a JSON object");
  }
  if (typeof raw.schemaVersion !== "number" || !Number.isInteger(raw.schemaVersion)) {
    return err("invalid_config", "schemaVersion must be an integer");
  }
  if (raw.schemaVersion > CONFIG_SCHEMA_VERSION) {
    return err(
      "incompatible_version",
      `configuration schema version ${raw.schemaVersion} is newer than supported version ${CONFIG_SCHEMA_VERSION}; refusing to modify or apply it`,
      { found: raw.schemaVersion, supported: CONFIG_SCHEMA_VERSION },
    );
  }
  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return err("invalid_config", `unsupported schemaVersion ${String(raw.schemaVersion)}`);
  }
  if (typeof raw.appId !== "string" || !isValidAppId(raw.appId)) {
    return err("invalid_config", `appId must be a reverse-dotted identity, got: ${String(raw.appId)}`);
  }
  if (typeof raw.appName !== "string" || raw.appName.trim().length === 0) {
    return err("invalid_config", "appName must be a non-empty string");
  }
  const command = parseCommand(raw.command);
  if ("message" in command) {
    return err("invalid_config", command.message, { field: "command" });
  }
  if (typeof raw.packageManager !== "string" || !PACKAGE_MANAGERS.includes(raw.packageManager as PackageManagerName)) {
    return err("invalid_config", `packageManager must be one of ${PACKAGE_MANAGERS.join(", ")}`);
  }
  const iconsRaw = raw.icons === undefined ? {} : raw.icons;
  if (!isRecord(iconsRaw)) {
    return err("invalid_config", "icons must be an object when present");
  }
  const appIcon =
    iconsRaw.appIcon === undefined ? undefined : parseIconResourceRef(iconsRaw.appIcon, "icons.appIcon");
  if (appIcon !== undefined && "message" in appIcon) {
    return err("invalid_config", appIcon.message, { field: "icons.appIcon" });
  }
  const trayIcon =
    iconsRaw.trayIcon === undefined ? undefined : parseIconResourceRef(iconsRaw.trayIcon, "icons.trayIcon");
  if (trayIcon !== undefined && "message" in trayIcon) {
    return err("invalid_config", trayIcon.message, { field: "icons.trayIcon" });
  }
  const smoothing =
    iconsRaw.imageSmoothingEnabled === undefined ? true : iconsRaw.imageSmoothingEnabled;
  if (typeof smoothing !== "boolean") {
    return err("invalid_config", "icons.imageSmoothingEnabled must be a boolean");
  }
  const background = iconsRaw.background === undefined ? "transparent" : iconsRaw.background;
  if (typeof background !== "string" || !BACKGROUNDS.includes(background as IconBackgroundName)) {
    return err("invalid_config", `icons.background must be one of ${BACKGROUNDS.join(", ")}`);
  }
  const scale = iconsRaw.scale === undefined ? DEFAULT_ICON_SCALE : iconsRaw.scale;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale < ICON_SCALE_MIN || scale > ICON_SCALE_MAX) {
    return err("invalid_config", `icons.scale must be a number between ${ICON_SCALE_MIN} and ${ICON_SCALE_MAX}`);
  }
  if (iconsRaw.trayTemplate !== undefined && typeof iconsRaw.trayTemplate !== "boolean") {
    return err("invalid_config", "icons.trayTemplate must be a boolean");
  }
  const windowRaw = raw.window === undefined ? DEFAULT_WINDOW : raw.window;
  if (!isRecord(windowRaw)) {
    return err("invalid_config", "window must be an object when present");
  }
  const width = windowRaw.width === undefined ? DEFAULT_WINDOW.width : windowRaw.width;
  const height = windowRaw.height === undefined ? DEFAULT_WINDOW.height : windowRaw.height;
  if (typeof width !== "number" || !Number.isInteger(width) || width <= 0) {
    return err("invalid_config", "window.width must be a positive integer");
  }
  if (typeof height !== "number" || !Number.isInteger(height) || height <= 0) {
    return err("invalid_config", "window.height must be a positive integer");
  }
  const developerMode = raw.developerMode === undefined ? false : raw.developerMode;
  if (typeof developerMode !== "boolean") {
    return err("invalid_config", "developerMode must be a boolean");
  }
  return ok({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    appId: raw.appId,
    appName: raw.appName,
    command,
    packageManager: raw.packageManager as PackageManagerName,
    icons: {
      ...(appIcon === undefined || "message" in appIcon ? {} : { appIcon }),
      ...(trayIcon === undefined || "message" in trayIcon ? {} : { trayIcon }),
      imageSmoothingEnabled: smoothing,
      background: background as IconBackgroundName,
      scale,
      ...(iconsRaw.trayTemplate === undefined ? {} : { trayTemplate: iconsRaw.trayTemplate as boolean }),
    },
    window: { width, height },
    developerMode,
  });
};

/** Serialize a v1 configuration deterministically (trailing newline). */
export const serializeCreateConfig = (config: CreateConfigV1): string =>
  `${JSON.stringify(config, null, 2)}\n`;

/** True when two v1 documents describe the same immutable identity. */
export const sameIdentity = (a: CreateConfigV1, b: CreateConfigV1): boolean =>
  a.appId === b.appId;
