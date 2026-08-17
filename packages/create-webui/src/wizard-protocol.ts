/** Wizard server event contract (mirrors packages/create/src/wizard.ts). */

export interface DiscoveredService {
  port: number;
  url: string;
  firstSeenAt: number;
  title?: string;
}

export interface WizardFormValues {
  appId: string;
  appName: string;
  iconPath: string;
  trayIconPath: string;
  pm: "npm" | "pnpm" | "bun";
  /** Wipe an existing non-empty target directory before materializing. */
  force: boolean;
  showStartupTerminal: boolean;
  showAddressBar: boolean;
}

/** One scraped icon candidate (ranked by clarity, deduplicated). */
export type IconVariant = "original" | "solid-black" | "solid-white";

export interface IconCandidate {
  index: number;
  url: string;
  width: number;
  height: number;
  format: string;
  variant: IconVariant;
  variantOf?: number;
}

export interface WizardFormDefaults {
  appId: string;
  appName: string;
  /** Resolved project directory the app will be generated into. */
  targetDir: string;
}

export interface WizardEnvEntry {
  key: string;
  value: string;
}

export interface WizardCommandOptions {
  /** Empty = the wizard's working directory. */
  cwd: string;
  env: WizardEnvEntry[];
  argsMode: "string" | "array";
}

export const DEFAULT_COMMAND_OPTIONS: WizardCommandOptions = {
  cwd: "",
  env: [],
  argsMode: "string",
};

export type WizardState =
  | "idle"
  | "running"
  | "discovered"
  | "failed"
  | "frozen"
  | "materializing"
  | "success";

export type WizardEvent =
  | { type: "state"; state: WizardState; reason?: string }
  | { type: "log"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "term-mode"; interactive: boolean; message?: string }
  | { type: "run-status"; running: boolean; code?: number | null }
  | { type: "command-display"; command: string }
  | {
      type: "command-options";
      options: WizardCommandOptions;
      defaultCwd: string;
    }
  | {
      type: "services";
      services: DiscoveredService[];
      selectedPort: number | undefined;
    }
  | { type: "scrape"; port: number; title?: string; hasIcon: boolean }
  | { type: "icons"; port: number; icons: IconCandidate[] }
  | {
      type: "form";
      values: WizardFormValues;
      defaults: WizardFormDefaults;
      targetDirExists: boolean;
    }
  | { type: "materialize-log"; message: string }
  | { type: "materialize-step"; step: string; message: string }
  | {
      type: "success";
      projectDir: string;
      bundlePath?: string;
      pinHint: string;
    };

const WIZARD_TOKEN = new URLSearchParams(location.search).get("token") ?? "";

export const api = (path: string, body: Record<string, unknown> = {}): Promise<Response> =>
  fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${WIZARD_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

export const openEventStream = (): EventSource =>
  new EventSource(`/api/events?token=${encodeURIComponent(WIZARD_TOKEN)}`);

/** Candidate thumbnail source (img tags cannot send auth headers). */
export const iconDataUrl = (port: number, index: number): string =>
  `/api/icon-data/${port}/${index}?token=${encodeURIComponent(WIZARD_TOKEN)}`;

/** Match a service URL to an iframe tab by hostname (port-agnostic). */
export const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};
