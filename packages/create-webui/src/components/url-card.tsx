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

export interface UrlCardProps {
  value: string;
  onChange(value: string): void;
  /** Active URL-mode source (server session truth); undefined = not entered. */
  activeSource: string | undefined;
  frozen: boolean;
  /** A preset fetch is in flight. */
  loading: boolean;
  onSubmit(): void;
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
  onSubmit,
}: UrlCardProps): React.JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 pb-3 text-sm font-medium text-muted-foreground">
        <Link2 className="size-4" />
        网页地址
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
              onChange(normalize(value));
              onSubmit();
            }}
            aria-label="网页地址"
          />
        </div>
        <Button
          size="sm"
          disabled={frozen || loading || value.trim().length === 0}
          onClick={() => {
            onChange(normalize(value));
            onSubmit();
          }}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          获取预设
        </Button>
      </div>
      {activeSource !== undefined ? (
        <p className="pt-2 text-xs text-muted-foreground">
          源地址：<span className="font-mono">{activeSource}</span>
          ——标题/图标预设来自该页面，均可在下方修改。
        </p>
      ) : (
        <p className="pt-2 text-xs text-muted-foreground">
          直接把网页打包成应用：不需要命令，创建时抓取页面标题与图标作为预设。
        </p>
      )}
    </section>
  );
}
