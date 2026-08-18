// Applications route (openspec change redesign-create-opentray-webui;
// wizard-share-and-list-scan added dual-layout discovery rows with accordion
// details, open, and share actions).
//
// Core-backed list/edit/open/share/uninstall with explicit destructive
// confirmation, exact retained/deleted path reporting, and the manual OS-pin
// caveat shown before AND after completion. Refresh failures keep known apps
// visible with a stale/error state.

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  PencilIcon,
  RefreshCwIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";

import {
  exportApp,
  fetchAppConfig,
  fetchAppIcon,
  fetchApps,
  openApp,
  uninstallApp,
  type AppRecord,
} from "../api";
import { ExportDialog, type ExportRunner } from "./export";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { Checkbox } from "../components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { usePreferences } from "../preferences";
import { useWorkbenchNavigation } from "../workbench-shell";

const STATUS_LABEL_KEYS: Record<AppRecord["status"], keyof ReturnType<typeof statusLabels>> = {
  healthy: "statusHealthy",
  "invalid-config": "statusInvalidConfig",
  "incompatible-version": "statusIncompatible",
  "missing-payload": "statusMissingPayload",
  "broken-link": "statusBrokenLink",
  running: "statusRunning",
};

const statusLabels = (messages: ReturnType<typeof usePreferences>["messages"]) => ({
  statusHealthy: messages.applications.statusHealthy,
  statusInvalidConfig: messages.applications.statusInvalidConfig,
  statusIncompatible: messages.applications.statusIncompatible,
  statusMissingPayload: messages.applications.statusMissingPayload,
  statusBrokenLink: messages.applications.statusBrokenLink,
  statusRunning: messages.applications.statusRunning,
});

interface AppDetail {
  readonly command: string;
  readonly cwd: string;
  readonly envKeys: readonly string[];
  readonly packageManager: string;
  readonly window: string;
  readonly developerMode: boolean;
}

/** Project the v1-shaped config document into the accordion detail view.
 * Env VALUES never land here — only key names (values live in the edit form). */
const toDetail = (config: Record<string, unknown>): AppDetail => {
  const command = (config.command ?? {}) as {
    executable?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  const window = (config.window ?? {}) as { width?: number; height?: number };
  return {
    command: [command.executable ?? "", ...(command.args ?? [])].filter(Boolean).join(" "),
    cwd: command.cwd ?? "",
    envKeys: Object.keys(command.env ?? {}),
    packageManager: typeof config.packageManager === "string" ? config.packageManager : "",
    window: `${window.width ?? "—"}×${window.height ?? "—"}`
      .replace(/—×—/u, "—"),
    developerMode: config.developerMode === true,
  };
};

const DetailRow = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
    <span className="text-muted-foreground">{label}</span>
    <span className="tech-ltr break-all">{value}</span>
  </div>
);

/** Row icon tile: the project's composed app icon, else the app's initial. */
const AppIconTile = ({ app, dataUrl }: { app: AppRecord; dataUrl: string | undefined }): React.JSX.Element => {
  const initial = (app.appName ?? app.key).trim().charAt(0).toUpperCase() || "A";
  return (
    <span
      className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md text-sm font-semibold"
      aria-hidden
    >
      {dataUrl !== undefined ? (
        <img src={dataUrl} alt="" className="size-full object-contain" />
      ) : (
        initial
      )}
    </span>
  );
};

export const ApplicationsRoute = (): React.JSX.Element => {
  const { messages } = usePreferences();
  const { navigate } = useWorkbenchNavigation();
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "stale">("loading");
  const [confirmTarget, setConfirmTarget] = useState<AppRecord | null>(null);
  const [purge, setPurge] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<AppRecord | null>(null);
  // 手风琴：同一时刻只展开一行；详情在首次展开时按 key 拉取。
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, AppDetail | "error">>({});
  // 行图标：每个应用的合成 app icon（data URL），按 key 懒加载。
  const [icons, setIcons] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setState((prev) => (prev === "ready" ? "stale" : "loading"));
    const response = await fetchApps();
    if (response.status === 200) {
      setApps(response.data);
      // 详情随列表刷新失效：展开中的行会在下次 toggle 时重新拉取。
      setDetails({});
      setState("ready");
      await Promise.all(
        response.data
          .filter((app) => app.hasIcon === true)
          .map(async (app) => {
            const icon = await fetchAppIcon(app.key);
            const data = icon.data;
            if (icon.status === 200 && "dataUrl" in data && data.dataUrl !== undefined) {
              setIcons((prev) => ({ ...prev, [app.key]: data.dataUrl! }));
            }
          }),
      );
    } else {
      setState("stale"); // keep known apps visible with the stale state
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleDetail = async (app: AppRecord): Promise<void> => {
    if (expandedKey === app.key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(app.key);
    if (details[app.key] === undefined) {
      const response = await fetchAppConfig(app.key);
      setDetails((prev) => ({
        ...prev,
        [app.key]: response.status === 200 ? toDetail(response.data as Record<string, unknown>) : "error",
      }));
    }
  };

  const open = async (app: AppRecord): Promise<void> => {
    const response = await openApp(app.key);
    const data = response.data;
    setResult(
      response.status === 200 && "ok" in data && data.ok === true
        ? data.detail
        : ("message" in data ? data.message : messages.common.error),
    );
  };

  const confirmUninstall = async (): Promise<void> => {
    const target = confirmTarget;
    setConfirmTarget(null);
    if (target?.appId === undefined) return;
    const response = await uninstallApp(target.appId, { stopRunning: false, purgeTarget: purge });
    if (response.status === 200) {
      const data = response.data as { registrationPath: string; targetRetained: boolean; targetDeleted: boolean; payloadPath: string; manualPinCleanupHint: string };
      setResult(
        [
          `${messages.applications.uninstallRetained} ${data.targetRetained ? data.payloadPath : ""}`.trim(),
          data.targetDeleted ? `${messages.applications.uninstallDeleted} ${data.payloadPath}` : "",
          data.manualPinCleanupHint,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } else {
      const data = response.data as { message?: string };
      setResult(data.message ?? messages.common.error);
    }
    await refresh();
  };

  const exportRunner: ExportRunner = (options) => {
    if (exportTarget === null) {
      return Promise.resolve({ status: 400, data: { code: "state_error", message: "no target" } });
    }
    // The config/export endpoints address the REGISTRY KEY (encoded directory
    // name), not the raw dotted appId.
    return exportApp(exportTarget.key, options);
  };

  return (
    <section className="flex h-full flex-col overflow-hidden" aria-label={messages.applications.title}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold">{messages.applications.title}</h1>
        <Button variant="ghost" size="icon-sm" aria-label={messages.common.refresh} onClick={() => void refresh()}>
          <RefreshCwIcon width={16} height={16} aria-hidden />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {state === "loading" && (
          <div className="space-y-2" aria-label={messages.common.loading}>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {state !== "loading" && apps.length === 0 && (
          <p className="text-muted-foreground text-sm">{messages.applications.emptyHint}</p>
        )}

        {apps.length > 0 && (
          <ul className="space-y-2">
            {apps.map((app) => {
              const expanded = expandedKey === app.key;
              const detail = details[app.key];
              const unhealthy = app.status !== "healthy";
              return (
                <li
                  key={app.key}
                  className="border-border bg-card text-card-foreground rounded-lg border px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <AppIconTile app={app} dataUrl={icons[app.key]} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{app.appName ?? app.key}</span>
                        {/* 只有异常才占视觉：健康态零徽章；异常时 tooltip 给出原因。 */}
                        {unhealthy && (
                          <Tooltip>
                            <TooltipTrigger
                              render={(props) => (
                                <Badge variant="destructive" {...props}>
                                  {statusLabels(messages)[STATUS_LABEL_KEYS[app.status]]}
                                </Badge>
                              )}
                            />
                            <TooltipContent>
                              {app.error?.message ?? statusLabels(messages)[STATUS_LABEL_KEYS[app.status]]}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {app.isLink && <Badge variant="outline">{messages.applications.linked}</Badge>}
                      </div>
                      <div className="tech-ltr text-muted-foreground truncate text-xs">{app.appId ?? app.key}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded}
                      onClick={() => void toggleDetail(app)}
                    >
                      {expanded ? <ChevronUpIcon width={14} height={14} aria-hidden /> : <ChevronDownIcon width={14} height={14} aria-hidden />}
                      {messages.applications.details}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        window.location.hash = `#/add?edit=${encodeURIComponent(app.key)}`;
                      }}
                    >
                      <PencilIcon width={14} height={14} aria-hidden />
                      {messages.applications.edit}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void open(app)}>
                      <ExternalLinkIcon width={14} height={14} aria-hidden />
                      {messages.applications.open}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setExportTarget(app)}>
                      <Share2Icon width={14} height={14} aria-hidden />
                      {messages.applications.share}
                    </Button>
                    {app.source !== "wizard" && (
                      <Button variant="destructive" size="sm" onClick={() => setConfirmTarget(app)}>
                        <Trash2Icon width={14} height={14} aria-hidden />
                        {messages.applications.uninstall}
                      </Button>
                    )}
                  </div>

                  {expanded && (
                    <div className="border-border mt-2 space-y-1 rounded-md border bg-muted/40 p-3">
                      {detail === undefined && (
                        <p className="text-muted-foreground text-xs">{messages.common.loading}</p>
                      )}
                      {detail === "error" && (
                        <p className="text-destructive text-xs" role="alert">{messages.common.error}</p>
                      )}
                      {detail !== undefined && detail !== "error" && (
                        <>
                          <DetailRow
                            label={messages.applications.source}
                            value={app.source === "wizard"
                              ? messages.applications.sourceWizard
                              : messages.applications.sourceRegistered}
                          />
                          <DetailRow label={messages.applications.detailsCommand} value={detail.command} />
                          <DetailRow label={messages.applications.detailsCwd} value={detail.cwd} />
                          <DetailRow
                            label={messages.applications.detailsEnv}
                            value={detail.envKeys.length > 0 ? detail.envKeys.join(", ") : "—"}
                          />
                          <DetailRow label={messages.applications.detailsPm} value={detail.packageManager} />
                          <DetailRow label={messages.applications.detailsWindow} value={detail.window} />
                          <DetailRow
                            label={messages.applications.detailsDevMode}
                            value={detail.developerMode ? "ON" : "OFF"}
                          />
                          <DetailRow
                            label={messages.applications.detailsProjectDir}
                            value={app.projectDir ?? app.payloadPath ?? app.registrationDir}
                          />
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {state === "stale" && (
          <p className="text-warning mt-3 text-xs" role="status">{messages.common.error}</p>
        )}

        {result !== null && (
          <p className="text-muted-foreground bg-muted mt-3 whitespace-pre-line rounded-md p-3 text-xs" role="status">
            {result}
          </p>
        )}
      </div>

      <AlertDialog open={confirmTarget !== null} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.applications.uninstallTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {messages.applications.uninstallDescription}
              {confirmTarget?.appId !== undefined && (
                <span className="tech-ltr mt-2 block truncate">{confirmTarget.appId}</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmTarget?.isLink === true && (
            <label className="flex items-start gap-2 text-xs">
              <Checkbox checked={purge} onCheckedChange={(checked) => setPurge(checked === true)} />
              <span>
                {messages.applications.uninstallPurge}
                <span className="text-muted-foreground block">{messages.applications.uninstallPurgeHint}</span>
              </span>
            </label>
          )}
          <p className="text-muted-foreground text-xs">{messages.applications.uninstallPinHint}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmUninstall()}>{messages.applications.uninstall}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ExportDialog
        open={exportTarget !== null}
        subtitle={exportTarget?.appId ?? exportTarget?.key ?? ""}
        hasEnv={exportTarget?.hasEnv === true}
        runner={exportRunner}
        onClose={() => setExportTarget(null)}
      />
    </section>
  );
};
