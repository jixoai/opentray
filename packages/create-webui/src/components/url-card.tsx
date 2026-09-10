/**
 * URL card (add-create-url-apps webui 入口)：与 CommandCard 并列的源输入卡。
 * 地址即源——「获取预设」触发服务端一次抓取（title/favicon/嵌入策略），
 * 状态机进入 discovered；后续 identity/图标/高级选项/确认流与命令模式
 * 完全同构（AppConfigCard 复用）。
 */
import { Globe, Link2, Loader2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/preferences";

export interface UrlCardProps {
  value: string;
  onChange(value: string): void;
  /** Active URL-mode source (server session truth); undefined = not entered. */
  activeSource: string | undefined;
  frozen: boolean;
  /** A preset fetch is in flight. */
  loading: boolean;
  /** Failed-state reason from the session (URL 模式唯一的错误显示面). */
  failedReason?: string | undefined;
  /** Receives the NORMALIZED url (protocol-completed). */
  onSubmit(value: string): void;
}

const normalize = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  return /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
};

export function UrlCard({
  value,
  onChange,
  activeSource,
  frozen,
  loading,
  failedReason,
  onSubmit,
}: UrlCardProps): React.JSX.Element {
  const { messages } = usePreferences();
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 pb-3 text-sm font-medium text-muted-foreground">
        <Link2 className="size-4" />
        {messages.wizard.sourceUrl}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Globe className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 font-mono text-xs"
            value={value}
            placeholder="https://example.com"
            disabled={frozen}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || frozen || loading) return;
              const normalized = normalize(value);
              onChange(normalized);
              onSubmit(normalized);
            }}
            aria-label={messages.wizard.sourceUrl}
          />
        </div>
        <Button
          size="sm"
          disabled={frozen || loading || value.trim().length === 0}
          onClick={() => {
            const normalized = normalize(value);
            onChange(normalized);
            onSubmit(normalized);
          }}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          {messages.url.fetch}
        </Button>
      </div>
      {failedReason !== undefined ? (
        <p className="pt-2 text-xs text-destructive" role="alert">{failedReason}</p>
      ) : null}
      {activeSource !== undefined ? (
        <p className="pt-2 text-xs text-muted-foreground">
          <span>{messages.url.sourcePrefix}</span>
          <span className="font-mono">{activeSource}</span>
          <span>{messages.url.activeSuffix}</span>
        </p>
      ) : (
        <p className="pt-2 text-xs text-muted-foreground">{messages.url.idleNote}</p>
      )}
    </section>
  );
}
