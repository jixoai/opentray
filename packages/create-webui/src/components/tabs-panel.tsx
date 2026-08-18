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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { StableIframe } from "@/components/stable-iframe";
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

const normalizeUrl = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`).href;
  } catch {
    return undefined;
  }
};

/** Per-tab footer: terminal telemetry + service jump chips. */
const StatusBar = ({
  status,
  services,
  activeTab,
  onJumpToService,
}: {
  status: TerminalStatusBarState;
  services: readonly DiscoveredService[];
  activeTab: string;
  onJumpToService(port: number): void;
}): React.JSX.Element => (
  <CardFooter className="h-8 shrink-0 gap-3 overflow-x-auto px-3 py-0 text-[11px] text-muted-foreground">
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
  </CardFooter>
);

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
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {/* The tab strip. Panels are kept mounted OUTSIDE TabsContent on
          purpose: Base UI unmounts inactive panels, which reloaded every
          service iframe on each switch. The Tabs root still drives
          keyboard nav and active styling; only this strip is its DOM. */}
      <Tabs value={activeTab} onValueChange={onActiveTabChange}>
        {/* Lifted browser-style strip (shadcn tabs-13 pattern on the
            official base-nova `line` variant). */}
        <TabsList variant="line" className="w-full justify-start border-b px-2">
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
      </Tabs>

      {/* Persistent pages: every tab's card stays mounted; visibility is
          CSS only. Switching tabs cannot reload iframes or reset the
          terminal renderer. */}
      <div className="flex min-h-0 flex-1 flex-col" hidden={activeTab !== "terminal"}>
        <Card size="sm" className="min-h-0 flex-1 gap-0">
          {/* CardHeader: the command this terminal is running. */}
          <CardHeader className="border-b [.border-b]:pb-2">
            <span className="tech-ltr flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
              <TerminalIcon className="size-4 shrink-0" />
              <span className="truncate">{command || "尚未运行命令"}</span>
            </span>
          </CardHeader>
          {/* CardBody: the terminal surface. */}
          <CardContent className="min-h-0 flex-1 p-0">
            <div
              ref={terminalHostRef}
              className="min-h-0 min-w-0 h-full bg-[#05070b] px-1"
            />
            {!terminalReady ? (
              <div className="p-3 text-xs text-muted-foreground">正在加载终端渲染器…</div>
            ) : null}
          </CardContent>
          <StatusBar
            status={status}
            services={services}
            activeTab={activeTab}
            onJumpToService={onJumpToService}
          />
        </Card>
      </div>

      {iframeTabs.map((tab) => (
        <div
          key={tab.port}
          className="flex min-h-0 flex-1 flex-col"
          hidden={activeTab !== `svc-${tab.port}`}
        >
          <Card size="sm" className="min-h-0 flex-1 gap-0">
            {/* CardHeader: the browser address bar for this service tab. */}
            <CardHeader className="border-b [.border-b]:pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={tab.historyIndex === 0}
                  onClick={() => onIframeHistoryMove(tab.port, -1)}
                  aria-label="后退"
                >
                  <ArrowLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={tab.historyIndex >= tab.history.length - 1}
                  onClick={() => onIframeHistoryMove(tab.port, 1)}
                  aria-label="前进"
                >
                  <ArrowRight />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onIframeNavigate(tab.port, tab.url, "replace")}
                  aria-label="重新加载"
                >
                  <RotateCw />
                </Button>
                <Globe className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  className="tech-ltr h-7 font-mono text-xs"
                  defaultValue={tab.url}
                  key={`${tab.port}:${tab.historyIndex}:${tab.url}`}
                  placeholder="输入 URL 跳转"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const raw = (event.target as HTMLInputElement).value;
                    const next = normalizeUrl(raw);
                    if (next !== undefined) {
                      onIframeNavigate(tab.port, next, "push");
                    }
                  }}
                />
              </div>
            </CardHeader>
            {/* CardBody: the service page. StableIframe navigates only on a
                REAL url change — visibility flips never reload it. */}
            <CardContent className="min-h-0 flex-1 p-0">
              <StableIframe
                port={tab.port}
                url={tab.url}
                visible={activeTab === `svc-${tab.port}`}
              />
            </CardContent>
            <StatusBar
              status={status}
              services={services}
              activeTab={activeTab}
              onJumpToService={onJumpToService}
            />
          </Card>
        </div>
      ))}
    </div>
  );
}
