/**
 * Chrome-style tabs panel: one terminal tab + one iframe tab per confirmed
 * service. The navigation bar is context-sensitive (terminal command vs
 * editable URL with per-tab back/forward history).
 */
import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  RotateCw,
  Terminal as TerminalIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hostnameOf, type DiscoveredService } from "@/wizard-protocol";
import { cn } from "@/lib/utils";

export interface IframeTab {
  /** Stable key: service port. */
  port: number;
  /** Current URL shown in the nav bar / iframe src. */
  url: string;
  history: string[];
  historyIndex: number;
}

export interface TerminalStatusBarState {
  cursorX: number;
  cursorY: number;
  cols: number;
  rows: number;
  selection?: { start: { x: number; y: number }; end: { x: number; y: number } };
}

interface TabsPanelProps {
  command: string;
  terminalHostRef: React.RefObject<HTMLDivElement | null>;
  terminalReady: boolean;
  interactive: boolean;
  status: TerminalStatusBarState;
  services: DiscoveredService[];
  iframeTabs: IframeTab[];
  activeTab: string;
  onActiveTabChange(tab: string): void;
  onIframeNavigate(port: number, url: string, mode: "push" | "replace"): void;
  onIframeHistoryMove(port: number, delta: -1 | 1): void;
  onJumpToService(port: number): void;
  /** Layout hook for the detail pane (e.g. "h-full" to fill it). */
  className?: string;
}

/** Web Navigation API guard: the address bar is managed through
 * window.navigation (currentEntry + navigate events) when available;
 * history API is never used for the address bar. */
const navigationApi = (): Navigation | undefined =>
  typeof window !== "undefined" && "navigation" in window
    ? (window as { navigation?: Navigation }).navigation
    : undefined;

const navigateViaApi = (url: string): boolean => {
  const nav = navigationApi();
  if (nav === undefined) return false;
  try {
    nav.navigate(url);
    return true;
  } catch {
    return false;
  }
};

const normalizeUrl = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`).href;
  } catch {
    return undefined;
  }
};

export function TabsPanel({
  command,
  terminalHostRef,
  terminalReady,
  interactive,
  status,
  services,
  iframeTabs,
  activeTab,
  onActiveTabChange,
  onIframeNavigate,
  onIframeHistoryMove,
  onJumpToService,
  className,
}: TabsPanelProps): React.JSX.Element {
  const activeIframe = iframeTabs.find((tab) => `svc-${tab.port}` === activeTab);
  const [navDraft, setNavDraft] = React.useState("");

  React.useEffect(() => {
    setNavDraft(activeIframe?.url ?? "");
  }, [activeIframe?.url, activeTab]);

  const canBack =
    activeIframe !== undefined && activeIframe.historyIndex > 0;
  const canForward =
    activeIframe !== undefined &&
    activeIframe.historyIndex < activeIframe.history.length - 1;

  return (
    <div className={cn("flex flex-col rounded-xl border border-border bg-card overflow-hidden", className)}>
      <Tabs value={activeTab} onValueChange={onActiveTabChange} className="flex min-h-0 flex-1 flex-col">
        {/* Tabs strip first (browser convention), then the context toolbar. */}
        <TabsList>
          <TabsTrigger value="terminal">
            <TerminalIcon className="size-3.5" />
            终端
            {!interactive && terminalReady ? (
              <span className="text-[10px] text-amber-400">非交互</span>
            ) : null}
          </TabsTrigger>
          {iframeTabs.map((tab) => (
            <TabsTrigger key={tab.port} value={`svc-${tab.port}`}>
              <Globe className="size-3.5" />
              {hostnameOf(tab.url)}:{new URL(tab.url).port}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Context navigation bar */}
        <div className="flex h-11 items-center gap-2 border-y border-border px-3">
          {activeIframe === undefined ? (
            <>
              <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-xs text-muted-foreground">
                {command || "尚未运行命令"}
              </span>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canBack}
                onClick={() => onIframeHistoryMove(activeIframe.port, -1)}
                aria-label="后退"
              >
                <ArrowLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!canForward}
                onClick={() => onIframeHistoryMove(activeIframe.port, 1)}
                aria-label="前进"
              >
                <ArrowRight />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onIframeNavigate(activeIframe.port, activeIframe.url, "replace")}
                aria-label="重新加载"
              >
                <RotateCw />
              </Button>
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <Input
                className="h-7 font-mono text-xs"
                value={navDraft}
                placeholder="输入 URL 跳转"
                onChange={(event) => setNavDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const next = normalizeUrl(navDraft);
                  if (next !== undefined) {
                    onIframeNavigate(activeIframe.port, next, "push");
                  }
                }}
              />
            </>
          )}
        </div>

        <TabsContent
          value="terminal"
          className="mt-0 min-h-0 flex-1"
          style={{ display: activeTab === "terminal" ? "flex" : "none", flexDirection: "column" }}
        >
          <div
            ref={terminalHostRef}
            className="min-h-0 min-w-0 flex-1 bg-[#05070b] px-1"
          />
          {!terminalReady ? (
            <div className="p-3 text-xs text-muted-foreground">正在加载终端渲染器…</div>
          ) : null}
        </TabsContent>

        {iframeTabs.map((tab) => (
          <TabsContent
            key={tab.port}
            value={`svc-${tab.port}`}
            className="mt-0 min-h-0 flex-1"
            style={{ display: activeTab === `svc-${tab.port}` ? "flex" : "none", flexDirection: "column" }}
          >
            <iframe
              title={`service-${tab.port}`}
              src={tab.url}
              className="min-h-0 w-full flex-1 border-0 bg-white"
              sandbox="allow-same-origin allow-scripts allow-forms"
            />
          </TabsContent>
        ))}
      </Tabs>

      {/* Status bar lives at the PANEL level: it belongs to the whole panel
          (terminal cursor/size/selection + service jumps), never inside the
          terminal tab content — that put it under iframe address bars. */}
      <div className="flex h-8 shrink-0 items-center gap-3 overflow-x-auto border-t border-border px-3 text-[11px] text-muted-foreground">
        <span className="font-mono whitespace-nowrap">
          光标 {status.cursorY}:{status.cursorX}
        </span>
        <span className="font-mono whitespace-nowrap">
          {status.cols}×{status.rows}
        </span>
        <span className="font-mono whitespace-nowrap">
          {status.selection === undefined
            ? "无选区"
            : `选区 ${status.selection.start.y}:${status.selection.start.x} – ${status.selection.end.y}:${status.selection.end.x}`}
        </span>
        <span className="h-3 w-px bg-border" />
        {services.length === 0 ? (
          <span>嗅探 HTTP 服务中…（未发现不影响创建应用）</span>
        ) : (
          services.map((service) => (
            <Badge
              key={service.port}
              variant={activeTab === `svc-${service.port}` ? "default" : "secondary"}
              className="cursor-pointer font-mono whitespace-nowrap"
              onClick={() => onJumpToService(service.port)}
            >
              :{service.port}
              {service.title ? ` · ${service.title}` : ""}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
