// Typed client for the workbench API (apps / skill / export).

const token = (): string =>
  new URLSearchParams(window.location.search).get("token") ?? "";

const request = async <T>(
  path: string,
  init: { readonly method?: string; readonly body?: unknown } = {},
): Promise<{ readonly status: number; readonly data: T }> => {
  const response = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token()}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
};

export interface AppRecord {
  readonly key: string;
  readonly appId?: string;
  readonly appName?: string;
  readonly status:
    | "healthy"
    | "invalid-config"
    | "incompatible-version"
    | "missing-payload"
    | "broken-link"
    | "running";
  readonly registrationDir: string;
  readonly payloadPath?: string;
  readonly isLink: boolean;
  readonly hasEnv?: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

export const fetchApps = (): Promise<{ readonly status: number; readonly data: AppRecord[] }> =>
  request<AppRecord[]>("/api/apps");

export interface UninstallResult {
  readonly registrationPath: string;
  readonly payloadPath: string;
  readonly linkRemoved: boolean;
  readonly targetRetained: boolean;
  readonly targetDeleted: boolean;
  readonly manualPinCleanupHint: string;
}

export const uninstallApp = (
  appId: string,
  options: { readonly stopRunning: boolean; readonly purgeTarget: boolean },
): Promise<{ readonly status: number; readonly data: UninstallResult | { readonly code: string; readonly message: string } }> =>
  request<UninstallResult | { code: string; message: string }>(`/api/apps/${encodeURIComponent(appId)}/uninstall`, {
    method: "POST",
    body: { appId, ...options },
  });

export interface SkillEntry {
  readonly path: string;
  readonly type: "file" | "directory";
}

export const fetchSkillList = (): Promise<{ readonly status: number; readonly data: SkillEntry[] }> =>
  request<SkillEntry[]>("/api/skill/list");

export const fetchSkillFile = (
  path: string,
): Promise<{ readonly status: number; readonly data: { readonly path: string; readonly content: string } | { readonly code: string; readonly message: string } }> =>
  request<{ path: string; content: string } | { code: string; message: string }>(
    `/api/skill?path=${encodeURIComponent(path)}`,
  );

export interface ExportResponse {
  readonly command?: string;
  readonly filename?: string;
  readonly content?: string;
}

export const exportApp = (
  appId: string,
  options: { readonly format: "command" | "sh" | "ps1"; readonly acknowledgeEnv: boolean; readonly forceCopy: boolean },
): Promise<{
  readonly status: number;
  readonly data: ExportResponse | { readonly code: string; readonly message: string; readonly envCount?: number };
}> =>
  request<ExportResponse | { code: string; message: string; envCount?: number }>(
    `/api/apps/${encodeURIComponent(appId)}/export`,
    { method: "POST", body: { appId, ...options } },
  );
