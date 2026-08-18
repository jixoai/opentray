// Applications route (openspec change redesign-create-opentray-webui).
//
// Core-backed list/edit/uninstall with explicit destructive confirmation,
// exact retained/deleted path reporting, and the manual OS-pin caveat shown
// before AND after completion. Refresh failures keep known apps visible with
// a stale/error state.

import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

import { fetchApps, uninstallApp, type AppRecord } from "../api";
import { ExportDialog } from "./export";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
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
import { Skeleton } from "../components/ui/skeleton";
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

export const ApplicationsRoute = (): React.JSX.Element => {
  const { messages } = usePreferences();
  const { navigate } = useWorkbenchNavigation();
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "stale">("loading");
  const [confirmTarget, setConfirmTarget] = useState<AppRecord | null>(null);
  const [purge, setPurge] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<AppRecord | null>(null);

  const refresh = useCallback(async () => {
    setState((prev) => (prev === "ready" ? "stale" : "loading"));
    const response = await fetchApps();
    if (response.status === 200) {
      setApps(response.data);
      setState("ready");
    } else {
      setState("stale"); // keep known apps visible with the stale state
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
            {apps.map((app) => (
              <li
                key={app.key}
                className="border-border bg-card text-card-foreground flex items-center gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{app.appName ?? app.key}</span>
                    <Badge variant={app.status === "healthy" ? "default" : "destructive"}>
                      {statusLabels(messages)[STATUS_LABEL_KEYS[app.status]]}
                    </Badge>
                    {app.isLink && <Badge variant="outline">{messages.applications.linked}</Badge>}
                  </div>
                  <div className="tech-ltr text-muted-foreground truncate text-xs" title={app.registrationDir}>
                    {app.appId ?? app.key}
                  </div>
                  <div className="tech-ltr text-muted-foreground truncate text-xs" title={app.payloadPath ?? app.registrationDir}>
                    {app.payloadPath ?? app.registrationDir}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // The config endpoint addresses the REGISTRY KEY
                    // (encoded directory name), not the raw dotted appId.
                    window.location.hash = `#/add?edit=${encodeURIComponent(app.key)}`;
                  }}
                >
                  {messages.applications.edit}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setExportTarget(app)}>
                  {messages.export.title}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setConfirmTarget(app)}>
                  {messages.applications.uninstall}
                </Button>
              </li>
            ))}
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
        appId={exportTarget?.appId ?? null}
        hasEnv={exportTarget?.hasEnv === true}
        onClose={() => setExportTarget(null)}
      />
    </section>
  );
};
