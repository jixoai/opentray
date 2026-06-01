export type PackageKind = "plain" | "platform" | "extension-platform";
export type AuthMode = "token" | "ambient" | "legacy-env";

export type RegistryState =
  | { type: "exists"; version: string }
  | { type: "missing" }
  | { type: "error"; message: string };

export type TrustState =
  | { type: "trusted"; id?: string }
  | { type: "missing" }
  | { type: "mismatch"; message: string }
  | { type: "auth-required"; message: string }
  | { type: "error"; message: string };

export interface Options {
  packageName: string;
  dir: string;
  kind: PackageKind;
  initialVersion: string;
  createWorkspace: boolean;
  publishIfMissing: boolean;
  configureTrust: boolean;
  publishAuth: AuthMode;
  trustAuth: Exclude<AuthMode, "token">;
  dryRun: boolean;
  yes: boolean;
  replaceTrust: boolean;
  repo: string;
  file: string;
  environment: string;
  registry: string;
  visibilityTimeoutMs: number;
  visibilityIntervalMs: number;
}

export interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  type?: string;
  license?: string;
  repository?: { type?: string; url?: string } | string;
  publishConfig?: { access?: string };
  files?: string[];
  scripts?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AuthContext {
  cleanup: () => Promise<void>;
  env: Record<string, string>;
  secrets: string[];
}

export interface NpmRuntime {
  cmd: string[];
  label: string;
}

export interface Report {
  packageName: string;
  dir: string;
  dryRun: boolean;
  stages: string[];
  registry?: RegistryState;
  trust?: TrustState;
  published: boolean;
  trustedConfigured: boolean;
}
