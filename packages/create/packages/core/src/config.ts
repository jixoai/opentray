// V1 configuration authority (openspec change unify-create-opentray-core).
//
// `create-opentray.json` is the SOLE editable desired-state authority. Every
// generated file (entry, package manifest, icon catalogs, runtime
// descriptors) is derived output and never a competing authority.

import { isAbsolute, join, normalize, sep } from "node:path";

import { z } from "zod";

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

// ─── zod schema (declarative v1 authority) ─────────────────────────────────
// The imperative field-by-field parser is replaced by a zod@v4 schema with
// refinements for the v1 laws: exact schema version (futures surface as
// incompatible_version, never invalid_config), contained resource paths,
// reverse-dotted appId, absolute cwd, and per-field error paths.

const sha256Field = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "sha256 must be a 64-char hex digest");

const resourceSourceSchema = z.object({
  kind: z.union([z.literal("file"), z.literal("http"), z.literal("data")]),
  ref: z.string().min(1),
});

const iconResourceRefSchema = z
  .object({
    path: z.string().superRefine((value, ctx) => {
      const check = validateRelativeResourcePath(value);
      if (!check.ok) {
        ctx.addIssue({ code: "custom", message: check.message });
      }
    }),
    format: z.enum(["png", "jpeg", "webp", "gif", "svg"]),
    sha256: sha256Field,
    source: resourceSourceSchema,
  })
  .strict();

const commandSchema = z
  .object({
    executable: z.string().trim().min(1, "command.executable must be a non-empty string"),
    args: z.array(z.string()),
    cwd: z.string().refine((value) => value.length > 0 && isAbsolute(value), {
      message: "command.cwd must be an absolute path",
    }),
    env: z.record(z.string().min(1, "command.env keys must be non-empty"), z.string()).optional(),
  })
  .strict();

const iconsSchema = z
  .object({
    appIcon: iconResourceRefSchema.optional(),
    trayIcon: iconResourceRefSchema.optional(),
    imageSmoothingEnabled: z.boolean().default(true),
    background: z.enum(["black", "white", "transparent"]).default("transparent"),
    scale: z
      .number()
      .refine(
        (value) =>
          Number.isFinite(value) && value >= ICON_SCALE_MIN && value <= ICON_SCALE_MAX,
        { message: `icons.scale must be a number between ${ICON_SCALE_MIN} and ${ICON_SCALE_MAX}` },
      )
      .default(DEFAULT_ICON_SCALE),
    trayTemplate: z.boolean().optional(),
  })
  .strict();

const windowSchema = z
  .object({
    width: z.number().int().positive().default(DEFAULT_WINDOW.width),
    height: z.number().int().positive().default(DEFAULT_WINDOW.height),
  })
  .strict()
  .default(DEFAULT_WINDOW);

const createConfigShape = z.object({
  schemaVersion: z.number().int(),
  appId: z.string().refine((value) => isValidAppId(value), {
    message: "appId must be a reverse-dotted identity",
  }),
  appName: z.string().trim().min(1, "appName must be a non-empty string"),
  command: commandSchema,
  packageManager: z.enum(["npm", "pnpm", "bun"]),
  icons: iconsSchema.optional(),
  window: windowSchema,
  developerMode: z.boolean().default(false),
});

/**
 * Strict v1 parse. Unknown future schema versions are reported as
 * `incompatible_version` read-only evidence; every other structural problem
 * is an `invalid_config` typed failure with the offending field path in
 * details. No mutation ever results from parse.
 */
export const parseCreateConfig = (raw: unknown): Result<CreateConfigV1> => {
  // schemaVersion negotiation happens BEFORE the schema so a future document
  // gets the typed incompatible_version error, not a field-level one.
  const versionProbe = z.object({ schemaVersion: z.number().int() }).loose().safeParse(raw);
  if (!versionProbe.success) {
    return err("invalid_config", "schemaVersion must be an integer");
  }
  const found = versionProbe.data.schemaVersion;
  if (found > CONFIG_SCHEMA_VERSION) {
    return err(
      "incompatible_version",
      `configuration schema version ${found} is newer than supported version ${CONFIG_SCHEMA_VERSION}; refusing to modify or apply it`,
      { found, supported: CONFIG_SCHEMA_VERSION },
    );
  }
  if (found !== CONFIG_SCHEMA_VERSION) {
    return err("invalid_config", `unsupported schemaVersion ${String(found)}`);
  }
  const parsed = createConfigShape.loose().safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first === undefined ? "" : first.path.join(".");
    return err(
      "invalid_config",
      first?.message ?? "configuration is structurally invalid",
      path.length > 0 ? { field: path } : undefined,
    );
  }
  const value = parsed.data as CreateConfigV1;
  return ok({
    schemaVersion: CONFIG_SCHEMA_VERSION,
    appId: value.appId,
    appName: value.appName,
    command: value.command,
    packageManager: value.packageManager,
    icons: value.icons ?? iconsSchema.parse({}),
    window: value.window,
    developerMode: value.developerMode,
  });
};

/** Serialize a v1 configuration deterministically (trailing newline). */
export const serializeCreateConfig = (config: CreateConfigV1): string =>
  `${JSON.stringify(config, null, 2)}\n`;

/** True when two v1 documents describe the same immutable identity. */
export const sameIdentity = (a: CreateConfigV1, b: CreateConfigV1): boolean =>
  a.appId === b.appId;
