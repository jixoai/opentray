// Orthogonal intents (2026-07-20; original user request: derive the stable
// app bundle from the consumer npm package rather than OpenTray's own module):
// 1. Resolve the caller package manifest without using OpenTray's import URL.
// 2. Keep package-name addressing stable for scoped and unscoped npm names.
// 3. Provide one shared path resolver for runtime and build adapters.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createResolverByRootFile } from "@gaubee/node/path";

export interface OpenTrayPackageIdentity {
  readonly name: string;
  readonly root: string;
  readonly manifestPath: string;
}

export interface ResolveOpenTrayPackageIdentityOptions {
  readonly packageName?: string;
  readonly packageRoot?: string;
  readonly projectRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly scriptPath?: string;
}

/** Resolves the npm package that owns the running consumer or build. */
export const resolveOpenTrayPackageIdentity = async (
  options: ResolveOpenTrayPackageIdentityOptions = {},
): Promise<OpenTrayPackageIdentity> => {
  const explicit = await readPackageIdentity(options.packageRoot, options.packageName);
  if (explicit !== undefined) return explicit;

  const project = await readPackageIdentity(options.projectRoot);
  if (project !== undefined) return project;

  const scriptPath = options.scriptPath ?? process.argv[1] ?? process.cwd();
  const readScriptIdentity = async (): Promise<OpenTrayPackageIdentity | undefined> => {
    // `createResolverByRootFile` starts from a directory. Resolve the script's
    // containing directory explicitly so a file path cannot fall through to the
    // OpenTray package in the current working tree.
    return readNearestPackageIdentity(dirname(scriptPath));
  };
  // An explicitly supplied script path is stronger than pnpm's ambient
  // npm_package_json, which otherwise points at the package running the test or
  // build process rather than the consumer being resolved.
  if (options.scriptPath !== undefined) {
    const fromScript = await readScriptIdentity();
    if (fromScript !== undefined) return fromScript;
  }

  const fromScript = await readScriptIdentity();
  if (fromScript !== undefined) return fromScript;

  // Package-manager environment metadata describes the command runner. It is
  // only a fallback when the actual consumer script has no package boundary.
  const env = options.env ?? process.env;
  const environmentManifest = env.npm_package_json;
  if (environmentManifest !== undefined) {
    const fromEnvironment = await readManifestIdentity(environmentManifest);
    if (fromEnvironment !== undefined) return fromEnvironment;
  }

  const fromCwd = await readNearestPackageIdentity(process.cwd());
  if (fromCwd !== undefined) return fromCwd;

  throw new OpenTrayPackageIdentityError(
    "missing_package_manifest",
    `unable to resolve the consumer package manifest from ${scriptPath}`,
  );
};

/** Encodes an npm package name as one stable filesystem component. */
export const encodeOpenTrayPackageName = (packageName: string): string => {
  const trimmed = packageName.trim();
  if (trimmed.length === 0) {
    throw new OpenTrayPackageIdentityError(
      "invalid_package_name",
      "consumer package name must not be empty",
    );
  }
  const encoded = trimmed.replaceAll("/", "+").replace(/[<>:"\\|?*\u0000-\u001f]/gu, "-");
  if (encoded === "." || encoded === ".." || encoded.includes("..")) {
    throw new OpenTrayPackageIdentityError(
      "invalid_package_name",
      `consumer package name cannot address a parent path: ${packageName}`,
    );
  }
  return encoded;
};

/** Resolves the default stable Darwin bundle path for one consumer package. */
export const resolveDefaultDarwinAppBundlePath = ({
  homeDir,
  packageName,
  appName,
}: {
  readonly homeDir: string;
  readonly packageName: string;
  readonly appName: string;
}): string => {
  const normalizedName = sanitizeAppBundleName(appName);
  return join(
    homeDir,
    ".opentray",
    "apps",
    encodeOpenTrayPackageName(packageName),
    `${normalizedName}.app`,
  );
};

/** Sanitizes the human label used as the stable bundle directory name. */
export const sanitizeAppBundleName = (appName: string): string => {
  const trimmed = appName.trim();
  const normalized = trimmed
    .replace(/[\\/:<>"|?*\u0000-\u001f]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/^\.+$/u, "")
    .trim();
  if (normalized.length === 0) {
    throw new OpenTrayPackageIdentityError(
      "invalid_app_name",
      `app name cannot address a filesystem entry: ${appName}`,
    );
  }
  return normalized;
};

export type OpenTrayPackageIdentityErrorCode =
  | "missing_package_manifest"
  | "invalid_package_manifest"
  | "invalid_package_name"
  | "invalid_app_name";

export class OpenTrayPackageIdentityError extends Error {
  constructor(
    readonly code: OpenTrayPackageIdentityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpenTrayPackageIdentityError";
  }
}

const readPackageIdentity = async (
  packageRoot: string | undefined,
  packageName?: string,
): Promise<OpenTrayPackageIdentity | undefined> => {
  if (packageRoot === undefined) {
    if (packageName !== undefined) {
      throw new OpenTrayPackageIdentityError(
        "invalid_package_manifest",
        "packageName metadata requires packageRoot metadata",
      );
    }
    return undefined;
  }
  const manifestPath = join(packageRoot, "package.json");
  const identity = await readManifestIdentity(manifestPath);
  if (identity === undefined) return undefined;
  if (packageName !== undefined && identity.name !== packageName) {
    throw new OpenTrayPackageIdentityError(
      "invalid_package_manifest",
      `package metadata name does not match ${manifestPath}`,
    );
  }
  return identity;
};

const readNearestPackageIdentity = async (
  fromPath: string,
): Promise<OpenTrayPackageIdentity | undefined> => {
  try {
    const resolver = createResolverByRootFile(fromPath, "package.json");
    return await readManifestIdentity(resolver("package.json"));
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return undefined;
    }
    throw error;
  }
};

const readManifestIdentity = async (
  manifestPath: string,
): Promise<OpenTrayPackageIdentity | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!isRecord(parsed) || typeof parsed.name !== "string" || parsed.name.trim().length === 0) {
      throw new OpenTrayPackageIdentityError(
        "invalid_package_manifest",
        `package.json must contain a non-empty name: ${manifestPath}`,
      );
    }
    return {
      name: parsed.name,
      root: dirname(manifestPath),
      manifestPath,
    };
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      throw new OpenTrayPackageIdentityError(
        "invalid_package_manifest",
        `package.json is not valid JSON: ${manifestPath}`,
      );
    }
    throw error;
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
