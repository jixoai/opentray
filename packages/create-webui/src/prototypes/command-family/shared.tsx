/**
 * Shared prototype furniture: the realistic wizard-page scaffold, plus the
 * product-shaped atoms the InputGroup design needs — derivation preview strip
 * (dialog), env-preset chips, the identity card where derived defaults land,
 * demo run/copy buttons, preset chips.
 */
import { Check, Copy, Play, Terminal } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DerivationPreview, EnvPreset } from "./derive";

export function WizardScaffold({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl px-6 pt-10 pb-28">
        <p className="text-[11px] tracking-wider text-muted-foreground uppercase">
          create-opentray · 原型演示
        </p>
        <h1 className="mt-1 text-lg font-semibold">命令配置 — 系列预设</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          5 种系列 + 自定义 · 分系列默认 appId 推导 · npm 系列环境变量注入
        </p>
        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}

/** 演示用运行按钮：点击给出真实反馈，但不真正执行命令。 */
export function DemoRunButton({ label }: { label?: string }): React.JSX.Element {
  const [accepted, setAccepted] = React.useState(false);
  React.useEffect(() => {
    if (!accepted) {
      return;
    }
    const timer = window.setTimeout(() => setAccepted(false), 1200);
    return () => window.clearTimeout(timer);
  }, [accepted]);
  return (
    <Button
      size="sm"
      variant={accepted ? "secondary" : "default"}
      disabled={accepted}
      onClick={() => setAccepted(true)}
      aria-label="运行命令"
    >
      {accepted ? <Check /> : <Play />}
      {accepted ? "已接收（演示）" : (label ?? "运行")}
    </Button>
  );
}

export function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
  React.useEffect(() => {
    if (state === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setState("idle"), 1200);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="复制命令"
      title={text}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => setState("copied"))
          .catch(() => setState("failed"));
      }}
    >
      {state === "copied" ? <Check /> : <Copy />}
    </Button>
  );
}

/** 新旧 appId 对照条 — Dialog 内展示「默认 appid 生成效果」。 */
export function DerivationStrip({
  preview,
}: {
  preview: DerivationPreview;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          默认应用标识（由命令推导，可改）
        </span>
        {preview.changed ? (
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
            新规则
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="font-mono text-sm font-medium break-all">
          {preview.appId}
        </code>
        {preview.changed ? (
          <span className="font-mono text-[11px] text-muted-foreground line-through">
            {preview.legacyAppId}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          名称{" "}
          <span className="font-medium text-foreground">{preview.appName}</span>
          {preview.tail.length > 0 ? (
            <span className="ml-1">（名称不含生态尾段）</span>
          ) : null}
        </span>
        <span className="font-mono">~/.opentray/create/{preview.dirName}/</span>
      </div>
    </div>
  );
}

/** 环境变量预设 chip 行：注入可见、可移除、可恢复。 */
export function EnvPresetRow({
  presets,
  removed,
  onRemovedChange,
}: {
  presets: readonly EnvPreset[];
  removed: boolean;
  onRemovedChange(removed: boolean): void;
}): React.JSX.Element {
  if (presets.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        此系列/runner 无需注入环境变量。
      </p>
    );
  }
  const preset = presets[0];
  if (preset === undefined) {
    return <></>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">环境变量预设</span>
      {removed ? (
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:bg-accent hover:text-foreground hover:underline"
          onClick={() => onRemovedChange(false)}
        >
          + {preset.key}={preset.value}（恢复预设）
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 py-0.5 pr-1 pl-1.5 font-mono text-[11px]"
          title={preset.note}
        >
          <span className="text-muted-foreground" aria-hidden="true">
            <Terminal className="inline size-3" />
          </span>
          {preset.key}={preset.value}
          <button
            type="button"
            aria-label={`移除 ${preset.key}`}
            title={preset.note}
            className="rounded px-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onRemovedChange(true)}
          >
            ×
          </button>
        </span>
      )}
      <span className="text-[11px] text-muted-foreground" title={preset.note}>
        {preset.note}
      </span>
    </div>
  );
}

/** 简化的「应用配置」卡：展示推导默认值以 placeholder 落位的真实产品模式。 */
export function AppIdentityCard({
  preview,
}: {
  preview: DerivationPreview;
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>应用 ID</Label>
          <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
            留空使用左侧推导的默认值；注册后不可变。
          </p>
          <Input
            className="mt-0 font-mono text-xs"
            value=""
            placeholder={preview.appId}
            readOnly
          />
        </div>
        <div>
          <Label>应用名称</Label>
          <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
            留空使用推导名称。
          </p>
          <Input
            className="mt-0 font-mono text-xs"
            value=""
            placeholder={preview.appName}
            readOnly
          />
        </div>
      </div>
      <p className="mt-2 font-mono text-[11px] break-all text-muted-foreground">
        ~/.opentray/create/{preview.dirName}/
      </p>
    </section>
  );
}

/** 预设 chip 行（Dialog 内使用）。 */
export function PresetChipRow({
  presets,
  onPick,
}: {
  presets: readonly { id: string; title: string; command: string }[];
  onPick(id: string): void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">预设</span>
      {presets.map((preset) => (
        <button
          key={preset.id}
          type="button"
          title={preset.command}
          onClick={() => onPick(preset.id)}
          className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] transition-colors hover:border-ring/50 hover:bg-accent"
        >
          {preset.title}
        </button>
      ))}
    </div>
  );
}
