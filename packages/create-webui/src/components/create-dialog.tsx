/** Confirm → materialize (pending logs) → success/failed dialog flow. */
import { CheckCircle2, ExternalLink, TriangleAlert } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WizardFormValues } from "@/wizard-protocol";
import { fmt } from "@/i18n";
import { usePreferences } from "@/preferences";

// 生成 = scaffold → icon → install；命令的首次运行属于「打开应用」（用户决策 D1）。
const PIPELINE_STEPS = ["scaffold", "icon", "install"] as const;

export interface CreateDialogProps {
  open: boolean;
  phase: "confirm" | "pending" | "success" | "failed";
  frozenValues: WizardFormValues;
  /** Resolved app-icon thumbnail (chosen candidate/upload), when any. */
  iconSrc: string | undefined;
  iconLabel: string;
  /** Tray icon thumbnail (raw source — the tray never uses the composite). */
  traySrc: string | undefined;
  trayLabel: string;
  selectedPort: number | undefined;
  currentStep: string;
  logs: readonly string[];
  error: string | undefined;
  result: { projectDir: string; bundlePath?: string; pinHint: string } | undefined;
  onBack(): void;
  onCreate(): void;
  /** 分享冻结参数（未生成即可分享）——wizard-share-and-list-scan D3。 */
  onShare(): void;
  onOpenApp(): void;
  /** Dialog dismissal (X / Esc / overlay / 完成). */
  onClose(): void;
  /** Confirm-phase rejection reason (409s must not vanish). */
  confirmError: string | undefined;
  onOpenChange(open: boolean): void;
}

export function CreateDialog({
  open,
  phase,
  frozenValues,
  iconSrc,
  iconLabel,
  traySrc,
  trayLabel,
  selectedPort,
  currentStep,
  logs,
  error,
  result,
  onBack,
  onCreate,
  onShare,
  onOpenApp,
  onClose,
  confirmError,
  onOpenChange,
}: CreateDialogProps): React.JSX.Element {
  const { messages } = usePreferences();
  const stepLabel: Record<(typeof PIPELINE_STEPS)[number], string> = {
    scaffold: messages.dialog.stepScaffold,
    icon: messages.dialog.stepIcon,
    install: messages.dialog.stepInstall,
  };
  const logRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs.length]);

  const stepState = (step: string): "done" | "active" | "" => {
    const index = PIPELINE_STEPS.indexOf(step as (typeof PIPELINE_STEPS)[number]);
    const currentIndex = PIPELINE_STEPS.indexOf(
      currentStep as (typeof PIPELINE_STEPS)[number],
    );
    if (phase === "success") return "done";
    if (index < currentIndex) return "done";
    if (index === currentIndex) return "active";
    return "";
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Pending generation must not be dismissable: losing the dialog
        // strands the wizard with no way to reach 完成/打开应用.
        if (phase === "pending" && next === false) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl">
        {phase === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle>{messages.dialog.confirmTitle}</DialogTitle>
              <DialogDescription>{messages.dialog.confirmDescription}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">App ID</dt>
              <dd className="font-mono break-all">{frozenValues.appId}</dd>
              <dt className="text-muted-foreground">{messages.form.appName}</dt>
              <dd className="break-all">{frozenValues.appName}</dd>
              <dt className="text-muted-foreground">{messages.dialog.icon}</dt>
              <dd className="flex flex-wrap items-center gap-4">
                <span className="flex items-center gap-2">
                  <span
                    className="icon-checker flex size-10 items-center justify-center overflow-hidden rounded-md"
                    aria-label={messages.dialog.appIconPreview}
                  >
                    {iconSrc !== undefined ? (
                      <img
                        src={iconSrc}
                        alt={messages.dialog.appIcon}
                        className="size-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {messages.common.none}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-xs leading-tight">{messages.dialog.appIcon}</span>
                    <span className="font-mono text-[10px] leading-tight text-muted-foreground">{iconLabel}</span>
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className="icon-checker flex size-10 items-center justify-center overflow-hidden rounded-md"
                    aria-label={messages.dialog.trayIconPreview}
                  >
                    {traySrc !== undefined ? (
                      <img
                        src={traySrc}
                        alt={messages.dialog.trayIcon}
                        className="size-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        {messages.dialog.textTray}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-xs leading-tight">{messages.dialog.trayIcon}</span>
                    <span className="font-mono text-[10px] leading-tight text-muted-foreground">{trayLabel}</span>
                  </span>
                </span>
              </dd>
              <dt className="text-muted-foreground">{messages.dialog.port}</dt>
              <dd className="font-mono">
                {selectedPort !== undefined
                  ? fmt(messages.dialog.portSelected, { port: selectedPort })
                  : messages.dialog.portRuntime}
              </dd>
              <dt className="text-muted-foreground">{messages.advanced.pm}</dt>
              <dd>{frozenValues.pm}</dd>
            </dl>
            {confirmError !== undefined ? (
              <p className="text-xs font-medium text-red-400">{confirmError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onBack}>
                {messages.dialog.back}
              </Button>
              <Button variant="outline" onClick={onShare}>
                {messages.dialog.share}
              </Button>
              <Button onClick={onCreate}>{messages.dialog.confirmCreate}</Button>
            </div>
          </>
        ) : phase === "pending" ? (
          <>
            <DialogHeader>
              <DialogTitle>{messages.dialog.pendingTitle}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap gap-1.5">
              {PIPELINE_STEPS.map((step) => (
                <Badge
                  key={step}
                  variant={stepState(step) === "done" ? "default" : "secondary"}
                >
                  {stepLabel[step]}
                </Badge>
              ))}
            </div>
            <div
              ref={logRef}
              className="h-48 overflow-y-auto rounded-md border border-border bg-[#05070b] p-3 font-mono text-[11px] leading-5 text-[#b7c3d8] whitespace-pre-wrap"
            >
              {logs.join("\n")}
            </div>
          </>
        ) : phase === "success" && result !== undefined ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-400" />
                {messages.dialog.successTitle}
              </DialogTitle>
            </DialogHeader>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{messages.dialog.projectDir}</dt>
              <dd className="font-mono break-all">{result.projectDir}</dd>
              {result.bundlePath ? (
                <>
                  <dt className="text-muted-foreground">{messages.dialog.macosBundle}</dt>
                  <dd className="font-mono break-all">{result.bundlePath}</dd>
                </>
              ) : null}
            </dl>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {messages.dialog.done}
              </Button>
              <Button onClick={onOpenApp}>
                <ExternalLink />
                {messages.dialog.openApp}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{result.pinHint}</p>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5 text-red-400" />
                {messages.dialog.failedTitle}
              </DialogTitle>
            </DialogHeader>
            <p className="break-all font-mono text-xs text-red-400">
              {error ?? messages.dialog.unknownError}
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onBack}>
                {messages.dialog.backRetry}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
