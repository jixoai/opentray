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
  /** Discovery source: wizard scaffold project or v1 registration envelope. */
  readonly source?: "registered" | "wizard";
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
  readonly projectDir?: string;
  readonly isLink: boolean;
  readonly hasEnv?: boolean;
  /** True when the project carries a composed app-icon asset. */
  readonly hasIcon?: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

export const fetchApps = (): Promise<{ readonly status: number; readonly data: AppRecord[] }> =>
  request<AppRecord[]>("/api/apps");

/** Raw v1 create-opentray.json of a registration (edit-mode source of truth). */
export const fetchAppConfig = (
  appId: string,
): Promise<{ readonly status: number; readonly data: Record<string, unknown> | { readonly code: string; readonly message: string } }> =>
  request<Record<string, unknown> | { code: string; message: string }>(
    `/api/apps/${encodeURIComponent(appId)}/config`,
  );

/** Row icon: the project's composed app icon as a data URL. */
export const fetchAppIcon = (
  key: string,
): Promise<{ readonly status: number; readonly data: { readonly dataUrl?: string } | { readonly code: string; readonly message: string } }> =>
  request<{ dataUrl?: string } | { code: string; message: string }>(
    `/api/apps/${encodeURIComponent(key)}/icon`,
  );

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
  /** 核心调用行（不含注释/脚手架）——复制命令用。 */
  readonly commandLine?: string;
  /** How the app icon traveled in a script share (drives the inline toggle). */
  readonly iconSharedAs?: "url" | "embedded" | "none";
}

export interface ExportRunnerOptions {
  readonly format: "sh" | "ps1";
  readonly acknowledgeEnv: boolean;
  readonly inlineIcon: boolean;
}

/** Key-addressed share/export — works for wizard AND registered entries. */
export const exportApp = (
  key: string,
  options: ExportRunnerOptions,
): Promise<{
  readonly status: number;
  readonly data: ExportResponse | { readonly code: string; readonly message: string; readonly envCount?: number };
}> =>
  request<ExportResponse | { code: string; message: string; envCount?: number }>(
    `/api/apps/${encodeURIComponent(key)}/export`,
    { method: "POST", body: { ...options } },
  );

export interface OpenAppResult {
  readonly ok: boolean;
  readonly detail: string;
}

/** Open a listed application (bundle launcher or detached cold start). */
export const openApp = (
  key: string,
): Promise<{ readonly status: number; readonly data: OpenAppResult | { readonly code: string; readonly message: string } }> =>
  request<OpenAppResult | { code: string; message: string }>(
    `/api/apps/${encodeURIComponent(key)}/open`,
    { method: "POST", body: {} },
  );

/**
 * Share the wizard's FROZEN parameters (pre-create): self-contained script
 * built without running anything. The result maps onto the export dialog's
 * shared response shape.
 */
export const shareFrozen = (
  options: ExportRunnerOptions,
): Promise<{
  readonly status: number;
  readonly data: ExportResponse | { readonly code: string; readonly message: string };
}> =>
  request<ExportResponse | { code: string; message: string }>("/api/export", {
    method: "POST",
    body: { ...options },
  }).then((response) => {
    if (response.status !== 200) {
      return response as { status: number; data: ExportResponse | { code: string; message: string } };
    }
    const data = response.data as
      | { ok: true; kind: "command"; command: string }
      | { ok: true; kind: "script"; filename: string; content: string; commandLine?: string; iconSharedAs?: "url" | "embedded" | "none" }
      | { ok: false; code: string; message: string };
    if (data.ok !== true) {
      return { status: 409, data: { code: data.code, message: data.message } };
    }
    return {
      status: 200,
      data: data.kind === "command"
        ? { command: data.command }
        : {
            filename: data.filename,
            content: data.content,
            ...(data.commandLine === undefined ? {} : { commandLine: data.commandLine }),
            ...(data.iconSharedAs === undefined ? {} : { iconSharedAs: data.iconSharedAs }),
          },
    };
  });
