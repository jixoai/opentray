/**
 * Navigation toolbar page for the multi-webview toolbar carrier
 * (add-webview-orchestration plan D12/D13/D22): one fixed 44px strip
 * rendered inside its own native webview ABOVE a sibling content webview.
 * There is no iframe — the content webview is a top-level browsing context,
 * so target-site embedding policy (X-Frame-Options / CSP frame-ancestors)
 * is never consulted (D14) and the content keeps first-party login state.
 * This page is a generated-app carrier asset; the wizard's authoring-time
 * stable-iframe preview tabs are a different surface and stay iframe
 * (D22 boundary).
 *
 * Channel protocol (create-package-private schema, D12 — flows over the
 * extension message channel, never over HTTP):
 *   this page → entry: {kind:"navigate",url} | {kind:"back"}
 *               | {kind:"forward"} | {kind:"reload"} | {kind:"get-url"}
 *   entry → this page: {kind:"url",url} — the address bar's source of truth
 *   is the content webview's urlChange events pushed by the entry.
 *
 * Keyboard shortcuts (⌘/Ctrl+←→, ⌘/Ctrl+[ ], ⌘/Ctrl+R, F5, ⌘/Ctrl+L) fire
 * only while THIS webview holds native focus — keystrokes never cross a
 * webview boundary, and the content page owns its own keys otherwise.
 */
import { ArrowLeft, ArrowRight, Globe, RotateCw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Page-bridge channel surface injected under the toolbar webview's
 *  `bridge: { webviewId: true, messageChannels: true }` policy. Declared
 *  locally (D12 keeps the channel payload schema create-private; the page
 *  bridge typings are not a create-webui dependency). */
interface ToolbarChannelEndpoint {
  readonly id: string;
  post(payload: unknown): Promise<void>;
  onMessage(handler: (payload: unknown) => void): () => void;
  onClose(handler: (notice: { readonly reason: string }) => void): () => void;
  close(): Promise<void>;
  destroy(): Promise<void>;
}

interface ToolbarPageBridge {
  readonly id: string;
  onCreatedMessageChannel(handler: (endpoint: ToolbarChannelEndpoint) => void): void;
}

/** The page's own webview id (bridge policy `webviewId`); kept for
 *  diagnostics — the entry targets this view by its own id. */
const pageBridge = (): ToolbarPageBridge | undefined =>
  (navigator as Navigator & { opentrayWebview?: ToolbarPageBridge }).opentrayWebview;

const normalizeUrl = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`).href;
  } catch {
    return undefined;
  }
};

export function ToolbarPage(): React.JSX.Element {
  const endpointRef = React.useRef<ToolbarChannelEndpoint | null>(null);
  const barRef = React.useRef<HTMLInputElement>(null);
  const [bar, setBar] = React.useState("");
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    const bridge = pageBridge();
    if (bridge === undefined) return; // bridgeless host: static strip only
    bridge.onCreatedMessageChannel((endpoint) => {
      endpointRef.current = endpoint;
      setConnected(true);
      // Address-bar truth: url pushes from the entry (urlChange + get-url
      // answers) own the field; local typing is transient until Enter.
      endpoint.onMessage((payload) => {
        const message = payload as { readonly kind?: unknown; readonly url?: unknown } | null;
        if (
          typeof message === "object" && message !== null &&
          message.kind === "url" && typeof message.url === "string"
        ) {
          setBar(message.url);
        }
      });
      endpoint.onClose(() => setConnected(false));
      endpoint.post({ kind: "get-url" }).catch(() => setConnected(false));
    });
  }, []);

  const send = React.useCallback((message: Record<string, unknown>): void => {
    const endpoint = endpointRef.current;
    if (endpoint === null) return;
    // D12: channel failure is an exposed bug — a failed post simply marks
    // the strip disconnected; no silent navigation fallback exists.
    void endpoint.post(message).catch(() => setConnected(false));
  }, []);

  const back = React.useCallback((): void => {
    send({ kind: "back" });
  }, [send]);

  const forward = React.useCallback((): void => {
    send({ kind: "forward" });
  }, [send]);

  const reload = React.useCallback((): void => {
    send({ kind: "reload" });
  }, [send]);

  const go = (value: string): void => {
    const next = normalizeUrl(value);
    if (next !== undefined) send({ kind: "navigate", url: next });
  };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      const focusInBar = document.activeElement === barRef.current;
      if (event.key === "F5" || (meta && event.key.toLowerCase() === "r")) {
        event.preventDefault();
        reload();
        return;
      }
      if (focusInBar) return; // typing in the address bar owns every other key
      if ((meta && event.key === "ArrowLeft") || (meta && event.key === "[")) {
        event.preventDefault();
        back();
        return;
      }
      if ((meta && event.key === "ArrowRight") || (meta && event.key === "]")) {
        event.preventDefault();
        forward();
        return;
      }
      if (meta && event.key.toLowerCase() === "l") {
        event.preventDefault();
        barRef.current?.focus();
        barRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back, forward, reload]);

  // Back/forward stay enabled while connected: the content webview's NATIVE
  // history is the authority and the v1 channel surface exposes no
  // history-state query (the entry forwards the commands natively).
  return (
    <div className="flex h-11 w-full items-center gap-2 border-b border-border bg-card px-3">
      <Button variant="ghost" size="icon-sm" disabled={!connected} onClick={back} aria-label="后退">
        <ArrowLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={!connected} onClick={forward} aria-label="前进">
        <ArrowRight />
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={!connected} onClick={reload} aria-label="重新加载">
        <RotateCw />
      </Button>
      <Globe className="size-4 shrink-0 text-muted-foreground" />
      <Input
        ref={barRef}
        className="h-7 font-mono text-xs"
        value={bar}
        placeholder="输入 URL 跳转"
        onChange={(event) => setBar(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          go(bar);
        }}
      />
    </div>
  );
}
