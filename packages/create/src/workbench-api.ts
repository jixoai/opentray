// Workbench API endpoints (openspec change redesign-create-opentray-webui).
//
// Applications list / skill documents / export planning are thin Core
// projections: this module never edits configuration, follows or deletes
// links, kills processes, or generates application files itself. Env values
// are never echoed into ordinary output.

import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildExportPlan,
  buildScriptExport,
  findCreateEntry,
  listCreateEntries,
  openMaterializedApp,
  quotePosix,
  readResourceBytes,
  readWizardProjectIcon,
  stopRunningApp,
  uninstallApp,
  type CreateConfigV1,
  type EmbeddedResource,
} from "@create-opentray/core";

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

/** Resolve the packaged skill root served to the WebUI help center. */
const resolveSkillRoot = async (): Promise<string | undefined> => {
  const candidates = [
    join(moduleDirectory, "skill"),
    // Source checkout: packages/create/src → ../../skill
    join(moduleDirectory, "..", "..", "skill"),
    // Built bundle: packages/create/dist → ./skill (staged by copy-skill.mjs)
    join(moduleDirectory, "..", "skill"),
  ];
  for (const candidate of candidates) {
    try {
      await readdir(candidate);
      return resolve(candidate);
    } catch {
      // try next
    }
  }
  return undefined;
};

const SKILL_PATH_PATTERN = /^(?!-_)[A-Za-z0-9._-]+(?:\/(?!_)[A-Za-z0-9._-]+)*$/u;

const containedSkillPath = (logical: string): string | undefined => {
  if (!SKILL_PATH_PATTERN.test(logical) || logical.includes("..") || logical.includes("\0")) {
    return undefined;
  }
  return logical;
};

export interface WorkbenchRequest {
  readonly method: string;
  readonly pathname: string;
  /** Parsed query parameters (GET routes read inputs from the URL). */
  readonly query: URLSearchParams;
  readonly body: Record<string, unknown>;
}

export type WorkbenchStatus = 200 | 400 | 404 | 409 | 500;

export interface WorkbenchResponse {
  readonly status: WorkbenchStatus;
  readonly body: unknown;
}

/**
 * Handle one workbench API request. Returns undefined when the pathname is
 * not a workbench route (the caller falls through to its own handling).
 */
export const handleWorkbenchApi = async (
  request: WorkbenchRequest,
): Promise<WorkbenchResponse | undefined> => {
  const { pathname } = request;

  if (pathname === "/api/apps" && request.method === "GET") {
    // Dual-layout discovery (wizard-share-and-list-scan D2): envelope
    // registrations AND wizard scaffold projects, unified read-only projection.
    const entries = await listCreateEntries();
    return {
      status: 200,
      body: await Promise.all(
        entries.map(async (entry) => {
          if (entry.source === "wizard") {
            const projectDir = entry.dir;
            return {
              key: entry.key,
              source: "wizard",
              appId: entry.config?.appId,
              appName: entry.config?.appName,
              status: "healthy",
              registrationDir: entry.dir,
              payloadPath: entry.dir,
              projectDir,
              isLink: false,
              hasEnv:
                entry.config !== undefined &&
                Object.keys(entry.config.command.env ?? {}).length > 0,
              hasIcon: await exists(join(projectDir, "app-icon", "app-icon.png")),
              ...(entry.config === undefined
                ? { error: { code: "invalid_config", message: "unreadable wizard project config" } }
                : {}),
            };
          }
          const projectDir = entry.record.payloadPath ?? entry.record.appDir;
          return {
            key: entry.key,
            source: "registered",
            appId: entry.record.config?.appId,
            appName: entry.record.config?.appName,
            status: entry.record.status,
            registrationDir: entry.record.dir,
            payloadPath: entry.record.payloadPath,
            projectDir,
            isLink: entry.record.isLink,
            hasEnv:
              entry.record.config !== undefined &&
              Object.keys(entry.record.config.command.env ?? {}).length > 0,
            hasIcon: await exists(join(projectDir, "app-icon", "app-icon.png")),
            ...(entry.record.error === undefined
              ? {}
              : { error: { code: entry.record.error.code, message: entry.record.error.message } }),
          };
        }),
      ),
    };
  }

  const iconMatch = /^\/api\/apps\/([^/]+)\/icon$/.exec(pathname);
  if (iconMatch !== null && request.method === "GET") {
    // Row icon: the project's stable composed app icon as a data URL (list
    // rows render <img src>; the workbench channel stays JSON-only).
    const key = decodeURIComponent(iconMatch[1]!);
    const entry = await findCreateEntry(key);
    if (entry === undefined) {
      return { status: 404, body: { code: "not_found", message: `no application at key ${key}` } };
    }
    const projectDir = entry.source === "wizard" ? entry.dir : entry.record.payloadPath;
    if (projectDir === undefined) {
      return { status: 404, body: { code: "missing_payload", message: "application payload is unavailable" } };
    }
    try {
      const bytes = new Uint8Array(await readFile(join(projectDir, "app-icon", "app-icon.png")));
      return {
        status: 200,
        body: { dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` },
      };
    } catch {
      return { status: 404, body: { code: "not_found", message: "no app icon asset" } };
    }
  }

  const readMatch = /^\/api\/apps\/([^/]+)\/config$/.exec(pathname);
  if (readMatch !== null && request.method === "GET") {
    const key = decodeURIComponent(readMatch[1]!);
    const entry = await findCreateEntry(key);
    if (entry === undefined) {
      return { status: 404, body: { code: "not_found", message: `no application at key ${key}` } };
    }
    if (entry.source === "wizard") {
      if (entry.config === undefined) {
        return { status: 500, body: { code: "invalid_config", message: "unreadable wizard project config" } };
      }
      // Same v1-shaped document the edit flow consumes, projected read-only
      // from the wizard project's frozen opentray.app.json.
      const config: CreateConfigV1 = {
        schemaVersion: 1,
        appId: entry.config.appId,
        appName: entry.config.appName,
        command: {
          executable: entry.config.command.executable,
          args: [...entry.config.command.args],
          cwd: entry.config.command.cwd,
          ...(entry.config.command.env === undefined
            ? {}
            : { env: { ...entry.config.command.env } }),
        },
        packageManager: entry.config.packageManager,
        icons: { imageSmoothingEnabled: true, background: "transparent", scale: 0.8 },
        window: entry.config.window,
        developerMode: entry.config.developerMode,
      };
      return { status: 200, body: config };
    }
    if (entry.record.config === undefined) {
      return { status: 500, body: { code: "invalid_config", message: "unreadable registration" } };
    }
    return { status: 200, body: entry.record.config };
  }

  const openMatch = /^\/api\/apps\/([^/]+)\/open$/.exec(pathname);
  if (openMatch !== null && request.method === "POST") {
    // Open works for BOTH layouts (wizard-share-and-list-scan D4): the shared
    // launcher needs only the project directory — bundle present → platform
    // launcher, else detached cold start. No registration envelope required.
    const key = decodeURIComponent(openMatch[1]!);
    const entry = await findCreateEntry(key);
    if (entry === undefined) {
      return { status: 404, body: { code: "not_found", message: `no application at key ${key}` } };
    }
    const projectDir =
      entry.source === "wizard" ? entry.dir : entry.record.payloadPath;
    if (projectDir === undefined) {
      return { status: 409, body: { code: "missing_payload", message: "application payload is unavailable" } };
    }
    const opened = await openMaterializedApp({ projectDir, bundlePath: undefined });
    return { status: opened.ok ? 200 : 500, body: opened };
  }

  const uninstallMatch = /^\/api\/apps\/([^/]+)\/uninstall$/.exec(pathname);
  if (uninstallMatch !== null && request.method === "POST") {
    const appId = typeof request.body.appId === "string" ? request.body.appId : undefined;
    if (appId === undefined) {
      return { status: 400, body: { code: "invalid_config", message: "appId is required" } };
    }
    const result = await uninstallApp({
      appId,
      stopRunning: request.body.stopRunning === true,
      purgeTarget: request.body.purgeTarget === true,
    });
    if (!result.ok) {
      return { status: result.error.code === "not_found" ? 404 : result.error.code === "app_running" ? 409 : 500, body: result.error };
    }
    return { status: 200, body: result.value };
  }

  const stopMatch = /^\/api\/apps\/([^/]+)\/stop$/.exec(pathname);
  if (stopMatch !== null && request.method === "POST") {
    const appId = typeof request.body.appId === "string" ? request.body.appId : undefined;
    if (appId === undefined) {
      return { status: 400, body: { code: "invalid_config", message: "appId is required" } };
    }
    const result = await stopRunningApp({ appId });
    if (!result.ok) {
      return { status: 500, body: result.error };
    }
    return { status: 200, body: result.value };
  }

  const exportMatch = /^\/api\/apps\/([^/]+)\/export$/.exec(pathname);
  if (exportMatch !== null && request.method === "POST") {
    // Key-addressed share/export for BOTH layouts (wizard-share-and-list-scan
    // D1/D4): wizard projects derive the config from the scaffold projection
    // and embed the stable in-project icon asset; registrations keep the
    // committed-snapshot flow.
    const key = decodeURIComponent(exportMatch[1]!);
    const entry = await findCreateEntry(key);
    if (entry === undefined) {
      return { status: 404, body: { code: "not_found", message: `no application at key ${key}` } };
    }
    let config: CreateConfigV1;
    const embedded: EmbeddedResource[] = [];
    if (entry.source === "wizard") {
      if (entry.config === undefined) {
        return { status: 500, body: { code: "invalid_config", message: "unreadable wizard project config" } };
      }
      const icon = await readWizardProjectIcon(entry.dir);
      config = {
        schemaVersion: 1,
        appId: entry.config.appId,
        appName: entry.config.appName,
        command: {
          executable: entry.config.command.executable,
          args: [...entry.config.command.args],
          cwd: entry.config.command.cwd,
          ...(entry.config.command.env === undefined
            ? {}
            : { env: { ...entry.config.command.env } }),
        },
        packageManager: entry.config.packageManager,
        icons: {
          imageSmoothingEnabled: true,
          background: "transparent",
          scale: 0.8,
          ...(icon === undefined
            ? {}
            : {
                appIcon: {
                  path: "app-icon.png",
                  format: "png" as const,
                  sha256: icon.sha256,
                  source: { kind: "file" as const, ref: icon.path },
                },
              }),
        },
        window: entry.config.window,
        developerMode: entry.config.developerMode,
      };
      if (icon !== undefined) {
        embedded.push({ flag: "app-icon", filename: "app-icon.png", bytes: icon.bytes });
      }
    } else {
      if (entry.record.config === undefined) {
        return { status: 500, body: { code: "invalid_config", message: "unreadable registration" } };
      }
      config = entry.record.config;
      // Embedded uploads: file-provenance sources carry their committed bytes.
      for (const ref of [config.icons.appIcon, config.icons.trayIcon]) {
        if (ref === undefined || ref.source.kind === "http") continue;
        const bytes = await readResourceBytes(entry.record.dir, ref);
        if (bytes.ok) {
          embedded.push({
            flag: ref === config.icons.appIcon ? "app-icon" : "tray-icon",
            filename: ref.path.split("/").pop() ?? "icon.png",
            bytes: bytes.value,
          });
        }
      }
    }
    const envCount = Object.keys(config.command.env ?? {}).length;
    if (envCount > 0 && request.body.acknowledgeEnv !== true) {
      // Env guard WITHOUT heuristics and WITHOUT echoing values.
      return {
        status: 409,
        body: { code: "env_ack_required", message: "environment entries present; acknowledgement required", envCount },
      };
    }
    const format = request.body.format === "sh" || request.body.format === "ps1" || request.body.format === "command"
      ? (request.body.format as "sh" | "ps1" | "command")
      : "command";
    if (format === "command") {
      const plan = buildExportPlan({
        config,
        embeddedResources: embedded,
        forceCopy: request.body.forceCopy === true,
      });
      if (!plan.ok) {
        return { status: 500, body: plan.error };
      }
      if (plan.value.directCommand === null) {
        return { status: 409, body: { code: "export_unsafe", message: plan.value.directCommandBlockedReason ?? "direct copy requires force-copy" } };
      }
      // Shell-safe display: quote any element containing spaces or shell
      // metacharacters so copy-paste reproduces the EXACT argv.
      const command = plan.value.directCommand.command
        .map((element) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(element) ? element : quotePosix(element)))
        .join(" ");
      return { status: 200, body: { command } };
    }
    const script = buildScriptExport(
      { config, embeddedResources: embedded },
      format === "sh" ? "sh" : "powershell",
    );
    if (!script.ok) {
      return { status: 500, body: script.error };
    }
    return {
      status: 200,
      body: {
        filename: script.value.filename,
        content: script.value.content,
        requiresEnvAcknowledgement: script.value.requiresEnvAcknowledgement,
      },
    };
  }

  if (pathname === "/api/skill" && request.method === "GET") {
    const root = await resolveSkillRoot();
    if (root === undefined) {
      return { status: 404, body: { code: "not_found", message: "packaged skill not found" } };
    }
    const requested = request.query.get("path");
    const logical = containedSkillPath(requested !== null && requested.length > 0 ? requested : "SKILL.md");
    if (logical === undefined) {
      return { status: 400, body: { code: "path_escape", message: "invalid skill path" } };
    }
    try {
      const content = await readFile(join(root, logical), "utf8");
      return { status: 200, body: { path: logical, content } };
    } catch {
      return { status: 404, body: { code: "not_found", message: `skill file not found: ${logical}` } };
    }
  }

  if (pathname === "/api/skill/list" && request.method === "GET") {
    const root = await resolveSkillRoot();
    if (root === undefined) {
      return { status: 404, body: { code: "not_found", message: "packaged skill not found" } };
    }
    const walk = async (prefix: string): Promise<{ path: string; type: "file" | "directory" }[]> => {
      const entries = await readdir(join(root, prefix), { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      const out: { path: string; type: "file" | "directory" }[] = [];
      for (const entry of entries) {
        const logical = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          out.push({ path: logical, type: "directory" });
          out.push(...(await walk(logical)));
        } else if (entry.isFile()) {
          out.push({ path: logical, type: "file" });
        }
      }
      return out;
    };
    return { status: 200, body: await walk("") };
  }

  return undefined;
};
