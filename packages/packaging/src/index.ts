import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";

export {
  DarwinAppBundleError,
  buildDarwinAppBundle,
  clearDarwinAppBundleOwner,
  convergeDarwinAppBundleIdentity,
  ensureDarwinAppBundle,
  validateDarwinAppBundle,
  writeDarwinAppBundleOwner,
  type DarwinAppBundleErrorCode,
  type DarwinAppBundleIdentityConvergenceOptions,
  type DarwinAppBundleIdentityConvergenceResult,
  type DarwinAppBundleManifest,
  type DarwinAppBundleOptions,
  type DarwinAppBundleTarget,
  type OpenTrayAppBundleOptions,
  type OpenTrayDarwinAppBundleResult,
} from "./app-bundle";
export {
  DARWIN_APP_LAUNCH_DESCRIPTOR,
  parseDarwinAppLaunchDescriptor,
  readDarwinAppLaunchDescriptor,
  resolveDarwinAppLaunchDescriptorPath,
  updateDarwinAppLaunchDescriptor,
  type OpenTrayAppLaunchDescriptor,
  type OpenTrayAppLaunchOptions,
} from "./app-launch";
export {
  encodeOpenTrayPackageName,
  resolveDefaultDarwinAppBundlePath,
  resolveOpenTrayPackageIdentity,
  sanitizeAppBundleName,
  OpenTrayPackageIdentityError,
  type OpenTrayPackageIdentity,
  type OpenTrayPackageIdentityErrorCode,
  type ResolveOpenTrayPackageIdentityOptions,
} from "./package-identity";

export type OpenTrayArtifactRole = "runtime-host" | "native-sidecar" | "companion";

export interface OpenTrayPackagingApp {
  /**
   * Stable app identity used for artifact addressing. Human labels belong in `name`.
   */
  readonly id: string;
  /**
   * Human-facing app label recorded in the manifest and diagnostics.
   */
  readonly name: string;
}

export interface OpenTrayArtifactInput {
  readonly source: string;
  readonly path?: string;
  readonly executable?: boolean;
}

export interface OpenTrayPackagingAdapter {
  readonly name: string;
  readonly mode: string;
}

export interface OpenTrayPackageOptions {
  readonly app: OpenTrayPackagingApp;
  readonly outDir: string;
  readonly entry: string;
  readonly adapter: OpenTrayPackagingAdapter;
  readonly runtimeHost: OpenTrayArtifactInput;
  readonly nativeArtifacts?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly companionAssets?: Readonly<Record<string, OpenTrayArtifactInput>>;
  readonly manifestPath?: string;
}

export interface OpenTrayManifestArtifact {
  readonly role: OpenTrayArtifactRole;
  readonly path: string;
  readonly name: string;
}

export interface OpenTrayPackageManifest {
  readonly schemaVersion: 1;
  readonly app: OpenTrayPackagingApp;
  readonly artifactStem: string;
  readonly entry: string;
  readonly adapter: OpenTrayPackagingAdapter;
  readonly runtimeHost: OpenTrayManifestArtifact;
  readonly nativeArtifacts: Readonly<Record<string, OpenTrayManifestArtifact>>;
  readonly companionAssets: Readonly<Record<string, OpenTrayManifestArtifact>>;
}

export interface OpenTrayPackageResult {
  readonly manifest: OpenTrayPackageManifest;
  readonly manifestPath: string;
  readonly stagedPaths: readonly string[];
}

export interface OpenTrayResolvedPackage {
  readonly manifest: OpenTrayPackageManifest;
  readonly manifestPath: string;
  readonly runtimeHostPath: string;
  readonly nativeArtifactPaths: Readonly<Record<string, string>>;
  readonly companionAssetPaths: Readonly<Record<string, string>>;
}

export interface OpenTrayResolvePackageOptions {
  /**
   * Directory that manifest artifact paths are relative to. Default manifests infer
   * this from the app artifact directory; custom nested manifest paths should pass it.
   */
  readonly artifactRoot?: string;
}

export type OpenTrayPackagingErrorCode =
  | "missing_app_id"
  | "missing_app_name"
  | "invalid_relative_path"
  | "duplicate_artifact_path"
  | "invalid_manifest";

export class OpenTrayPackagingError extends Error {
  constructor(
    readonly code: OpenTrayPackagingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpenTrayPackagingError";
  }
}

export const stageOpenTrayPackage = async (
  options: OpenTrayPackageOptions,
): Promise<OpenTrayPackageResult> => {
  const app = validateApp(options.app);
  const artifactStem = formatOpenTrayArtifactStem(app.id);
  const nativeArtifacts = options.nativeArtifacts ?? {};
  const companionAssets = options.companionAssets ?? {};
  const planned = [
    planArtifact(artifactStem, "runtimeHost", "runtime-host", options.runtimeHost),
    ...Object.entries(nativeArtifacts).map(([key, artifact]) =>
      planArtifact(artifactStem, key, "native-sidecar", artifact),
    ),
    ...Object.entries(companionAssets).map(([key, artifact]) =>
      planArtifact(artifactStem, key, "companion", artifact),
    ),
  ];
  const manifestPath = assertRelativePath(
    options.manifestPath ?? `${artifactStem}/opentray-app-manifest.json`,
  );

  assertUniquePaths([...planned.map((artifact) => artifact.path), manifestPath]);

  for (const artifact of planned) {
    const destination = join(options.outDir, artifact.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(artifact.source, destination);
    if (artifact.executable) {
      await chmod(destination, 0o755);
    }
  }

  const runtimeHost = planned[0];
  if (runtimeHost === undefined) {
    throw new Error("runtime host planning failed");
  }

  const manifest: OpenTrayPackageManifest = {
    schemaVersion: 1,
    app,
    artifactStem,
    entry: options.entry,
    adapter: options.adapter,
    runtimeHost: toManifestArtifact(runtimeHost),
    nativeArtifacts: toArtifactRecord(planned, "native-sidecar"),
    companionAssets: toArtifactRecord(planned, "companion"),
  };

  const absoluteManifestPath = join(options.outDir, manifestPath);
  await mkdir(dirname(absoluteManifestPath), { recursive: true });
  await writeFile(absoluteManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    manifest,
    manifestPath,
    stagedPaths: [...planned.map((artifact) => artifact.path), manifestPath],
  };
};

export const readOpenTrayPackageManifest = async (
  manifestPath: string,
): Promise<OpenTrayPackageManifest> => {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  return parseOpenTrayPackageManifest(parsed);
};

export const resolveOpenTrayPackage = async (
  manifestPath: string,
  options: OpenTrayResolvePackageOptions = {},
): Promise<OpenTrayResolvedPackage> => {
  const manifest = await readOpenTrayPackageManifest(manifestPath);
  const artifactRoot = options.artifactRoot ?? inferArtifactRoot(manifestPath, manifest);
  return {
    manifest,
    manifestPath,
    runtimeHostPath: join(artifactRoot, manifest.runtimeHost.path),
    nativeArtifactPaths: resolveArtifactRecord(artifactRoot, manifest.nativeArtifacts),
    companionAssetPaths: resolveArtifactRecord(artifactRoot, manifest.companionAssets),
  };
};

export const formatOpenTrayArtifactStem = (appId: string): string => {
  const normalized = normalizeAppId(appId);
  const digest = createHash("sha256").update(appId).digest("hex").slice(0, 10);
  return `${normalized}-${digest}`;
};

export const normalizeAppId = (appId: string): string => {
  const trimmed = appId.trim();
  if (trimmed.length === 0) {
    throw new OpenTrayPackagingError(
      "missing_app_id",
      "OpenTray packaging requires a stable app.id",
    );
  }
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.length === 0) {
    throw new OpenTrayPackagingError(
      "missing_app_id",
      "OpenTray packaging requires app.id to contain addressable characters",
    );
  }
  return normalized;
};

const validateApp = (app: OpenTrayPackagingApp): OpenTrayPackagingApp => {
  normalizeAppId(app.id);
  if (app.name.trim().length === 0) {
    throw new OpenTrayPackagingError(
      "missing_app_name",
      "OpenTray packaging requires a human-readable app.name",
    );
  }
  return {
    id: app.id,
    name: app.name,
  };
};

interface PlannedArtifact {
  readonly key: string;
  readonly role: OpenTrayArtifactRole;
  readonly source: string;
  readonly path: string;
  readonly executable: boolean;
}

const planArtifact = (
  artifactStem: string,
  key: string,
  role: OpenTrayArtifactRole,
  artifact: OpenTrayArtifactInput,
): PlannedArtifact => ({
  key,
  role,
  source: artifact.source,
  executable: artifact.executable === true,
  path:
    artifact.path === undefined
      ? defaultArtifactPath(artifactStem, key, role, artifact.source)
      : assertRelativePath(artifact.path),
});

const defaultArtifactPath = (
  artifactStem: string,
  key: string,
  role: OpenTrayArtifactRole,
  source: string,
): string => {
  const extension = extname(source);
  switch (role) {
    case "runtime-host":
      return `${artifactStem}/runtime/${artifactStem}${extension}`;
    case "native-sidecar":
      return `${artifactStem}/native/${normalizeArtifactKey(key)}${extension}`;
    case "companion":
      return `${artifactStem}/assets/${normalizeArtifactKey(key)}${extension}`;
  }
};

const normalizeArtifactKey = (key: string): string => {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length === 0 ? "artifact" : normalized;
};

const assertRelativePath = (path: string): string => {
  if (path.trim().length === 0 || isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new OpenTrayPackagingError(
      "invalid_relative_path",
      `OpenTray staged artifact paths must be relative output paths: ${path}`,
    );
  }
  return path;
};

const assertUniquePaths = (paths: readonly string[]): void => {
  const seen = new Set<string>();
  for (const path of paths) {
    const normalized = path.split(/[\\/]/).join(sep);
    if (seen.has(normalized)) {
      throw new OpenTrayPackagingError(
        "duplicate_artifact_path",
        `OpenTray packaging cannot stage two artifacts to the same path: ${path}`,
      );
    }
    seen.add(normalized);
  }
};

const toManifestArtifact = (artifact: PlannedArtifact): OpenTrayManifestArtifact => ({
  role: artifact.role,
  path: artifact.path,
  name: artifact.path.split(/[\\/]/).at(-1) ?? artifact.path,
});

const toArtifactRecord = (
  artifacts: readonly PlannedArtifact[],
  role: OpenTrayArtifactRole,
): Readonly<Record<string, OpenTrayManifestArtifact>> =>
  Object.fromEntries(
    artifacts
      .filter((artifact) => artifact.role === role)
      .map((artifact) => [artifact.key, toManifestArtifact(artifact)]),
  );

export const relativeOutputPath = (outDir: string, path: string): string =>
  relative(outDir, path).split(sep).join("/");

const resolveArtifactRecord = (
  artifactRoot: string,
  artifacts: Readonly<Record<string, OpenTrayManifestArtifact>>,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(artifacts).map(([key, artifact]) => [key, join(artifactRoot, artifact.path)]),
  );

const inferArtifactRoot = (manifestPath: string, manifest: OpenTrayPackageManifest): string => {
  const manifestRoot = dirname(manifestPath);
  return basename(manifestRoot) === manifest.artifactStem ? dirname(manifestRoot) : manifestRoot;
};

const parseOpenTrayPackageManifest = (value: unknown): OpenTrayPackageManifest => {
  const record = requireRecord(value, "OpenTray package manifest");
  const schemaVersion = requireNumber(record.schemaVersion, "schemaVersion");
  if (schemaVersion !== 1) {
    throw invalidManifest(`unsupported OpenTray package manifest schemaVersion: ${schemaVersion}`);
  }
  return {
    schemaVersion: 1,
    app: parseApp(record.app),
    artifactStem: requireString(record.artifactStem, "artifactStem"),
    entry: requireString(record.entry, "entry"),
    adapter: parseAdapter(record.adapter),
    runtimeHost: parseManifestArtifact(record.runtimeHost, "runtimeHost"),
    nativeArtifacts: parseManifestArtifactRecord(record.nativeArtifacts, "nativeArtifacts"),
    companionAssets: parseManifestArtifactRecord(record.companionAssets, "companionAssets"),
  };
};

const parseApp = (value: unknown): OpenTrayPackagingApp => {
  const record = requireRecord(value, "app");
  return {
    id: requireString(record.id, "app.id"),
    name: requireString(record.name, "app.name"),
  };
};

const parseAdapter = (value: unknown): OpenTrayPackagingAdapter => {
  const record = requireRecord(value, "adapter");
  return {
    name: requireString(record.name, "adapter.name"),
    mode: requireString(record.mode, "adapter.mode"),
  };
};

const parseManifestArtifactRecord = (
  value: unknown,
  field: string,
): Readonly<Record<string, OpenTrayManifestArtifact>> => {
  const record = requireRecord(value, field);
  return Object.fromEntries(
    Object.entries(record).map(([key, artifact]) => [
      key,
      parseManifestArtifact(artifact, `${field}.${key}`),
    ]),
  );
};

const parseManifestArtifact = (value: unknown, field: string): OpenTrayManifestArtifact => {
  const record = requireRecord(value, field);
  const role = requireString(record.role, `${field}.role`);
  if (role !== "runtime-host" && role !== "native-sidecar" && role !== "companion") {
    throw invalidManifest(`invalid OpenTray manifest artifact role at ${field}: ${role}`);
  }
  return {
    role,
    path: assertRelativePath(requireString(record.path, `${field}.path`)),
    name: requireString(record.name, `${field}.name`),
  };
};

const requireRecord = (value: unknown, field: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidManifest(`OpenTray package manifest field must be an object: ${field}`);
  }
  return value as Readonly<Record<string, unknown>>;
};

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidManifest(`OpenTray package manifest field must be a non-empty string: ${field}`);
  }
  return value;
};

const requireNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number") {
    throw invalidManifest(`OpenTray package manifest field must be a number: ${field}`);
  }
  return value;
};

const invalidManifest = (message: string): OpenTrayPackagingError =>
  new OpenTrayPackagingError("invalid_manifest", message);
