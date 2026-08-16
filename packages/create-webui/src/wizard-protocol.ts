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
  servicePort: string;
  targetDir: string;
  pm: "npm" | "pnpm" | "bun";
}

export interface WizardFormDefaults {
  appId: string;
  appName: string;
  targetDir: string;
}

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
      type: "services";
      services: DiscoveredService[];
      selectedPort: number | undefined;
    }
  | { type: "scrape"; port: number; title?: string; hasIcon: boolean }
  | { type: "form"; values: WizardFormValues; defaults: WizardFormDefaults }
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

/** Match a service URL to an iframe tab by hostname (port-agnostic). */
export const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};
