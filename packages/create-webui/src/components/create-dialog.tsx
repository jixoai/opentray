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

const PIPELINE_STEPS = ["scaffold", "icon", "install", "launch", "bundle"] as const;

export interface CreateDialogProps {
  open: boolean;
  phase: "confirm" | "pending" | "success" | "failed";
  frozenValues: WizardFormValues;
  selectedPort: number | undefined;
  currentStep: string;
  logs: readonly string[];
  error: string | undefined;
  result: { projectDir: string; bundlePath?: string; pinHint: string } | undefined;
  onBack(): void;
  onCreate(): void;
  onOpenApp(): void;
}

export function CreateDialog({
  open,
  phase,
  frozenValues,
  selectedPort,
  currentStep,
  logs,
  error,
  result,
  onBack,
  onCreate,
  onOpenApp,
}: CreateDialogProps): React.JSX.Element {
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
    <Dialog open={open}>
      <DialogContent className="max-w-xl">
        {phase === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle>确认应用信息</DialogTitle>
              <DialogDescription>
                表单已固定，以下值将用于生成应用。
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">App ID</dt>
              <dd className="font-mono break-all">{frozenValues.appId}</dd>
              <dt className="text-muted-foreground">应用名称</dt>
              <dd className="break-all">{frozenValues.appName}</dd>
              <dt className="text-muted-foreground">图标</dt>
              <dd className="font-mono break-all">
                {frozenValues.iconPath || "favicon / 首字母图标"}
              </dd>
              <dt className="text-muted-foreground">目标目录</dt>
              <dd className="font-mono break-all">{frozenValues.targetDir}</dd>
              <dt className="text-muted-foreground">服务端口</dt>
              <dd className="font-mono">{selectedPort ? `:${selectedPort}` : "—"}</dd>
              <dt className="text-muted-foreground">包管理器</dt>
              <dd>{frozenValues.pm}</dd>
            </dl>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onBack}>
                返回修改
              </Button>
              <Button onClick={onCreate}>确认生成</Button>
            </div>
          </>
        ) : phase === "pending" ? (
          <>
            <DialogHeader>
              <DialogTitle>正在生成应用…</DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap gap-1.5">
              {PIPELINE_STEPS.map((step) => (
                <Badge
                  key={step}
                  variant={stepState(step) === "done" ? "success" : stepState(step) === "active" ? "warning" : "secondary"}
                >
                  {step}
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
                应用已生成
              </DialogTitle>
            </DialogHeader>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">项目目录</dt>
              <dd className="font-mono break-all">{result.projectDir}</dd>
              {result.bundlePath ? (
                <>
                  <dt className="text-muted-foreground">macOS Bundle</dt>
                  <dd className="font-mono break-all">{result.bundlePath}</dd>
                </>
              ) : null}
            </dl>
            <div className="flex justify-end">
              <Button onClick={onOpenApp}>
                <ExternalLink />
                打开应用
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{result.pinHint}</p>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5 text-red-400" />
                生成失败
              </DialogTitle>
            </DialogHeader>
            <p className="break-all font-mono text-xs text-red-400">
              {error ?? "未知错误"}
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onBack}>
                返回重试
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
