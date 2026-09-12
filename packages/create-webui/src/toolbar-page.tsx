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
 *   entry → this page: {kind:"load-state",phase,url,progress?,errorCode?}
 *   (D24) — drives the thin load bar at the strip's bottom edge. `progress`
 *   (∈ [0,1]) and `errorCode` are best-effort; Windows sends phase only, so
 *   an in-flight load without progress renders indeterminate.
 *
 * Keyboard shortcuts (⌘/Ctrl+←→, ⌘/Ctrl+[ ], ⌘/Ctrl+R, F5, ⌘/Ctrl+L) fire
 * only while THIS webview holds native focus — keystrokes never cross a
 * webview boundary, and the content page owns its own keys otherwise.
 */
import { ArrowLeft, ArrowRight, Globe, RotateCw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { usePreferences } from "@/preferences";
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

/** Channel `load-state` frame (D24) forwarded verbatim by the entry carrier. */
interface LoadStateFrame {
  readonly kind: "load-state";
  readonly phase: "started" | "finished" | "failed";
  readonly url: string;
  readonly progress?: number;
  readonly errorCode?: number;
}

const isLoadStateFrame = (value: unknown): value is LoadStateFrame => {
  const frame = value as { kind?: unknown; phase?: unknown; url?: unknown } | null;
  return (
    typeof frame === "object" && frame !== null && frame.kind === "load-state" &&
    (frame.phase === "started" || frame.phase === "finished" || frame.phase === "failed") &&
    typeof frame.url === "string"
  );
};

/** Load-bar projection: `progress === null` renders the indeterminate sweep. */
interface LoadBarState {
  readonly active: boolean;
  readonly progress: number | null;
}

const LOAD_BAR_IDLE: LoadBarState = { active: false, progress: null };
/** How long a `finished` flash sits at 100% before the bar collapses. */
const LOAD_BAR_SETTLE_MS = 240;

const normalizeProgress = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
};

/**
 * Favicon derivation (D25): the current origin's `/favicon.ico`, fetched
 * client-side by the page itself (image rendering ignores CORS). Falls back
 * to a hostname letter glyph when the image errors or the URL has no
 * http(s) origin.
 */
interface FaviconTarget {
  readonly src: string;
  readonly glyph: string;
}

const deriveFavicon = (raw: string): FaviconTarget | undefined => {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (parsed.hostname.length === 0) return undefined;
    return { src: `${parsed.origin}/favicon.ico`, glyph: parsed.hostname[0]!.toUpperCase() };
  } catch {
    return undefined;
  }
};

export function ToolbarPage(): React.JSX.Element {
  const { messages } = usePreferences();
  const endpointRef = React.useRef<ToolbarChannelEndpoint | null>(null);
  const barRef = React.useRef<HTMLInputElement>(null);
  const settleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bar, setBar] = React.useState("");
  // The committed navigation target (url pushes only — transient typing in
  // the address bar never reaches it). Drives the favicon (D25).
  const [committedUrl, setCommittedUrl] = React.useState("");
  const [connected, setConnected] = React.useState(false);
  const [loadBar, setLoadBar] = React.useState<LoadBarState>(LOAD_BAR_IDLE);
  // The src of the last favicon image that errored; any src change retries.
  const [failedFaviconSrc, setFailedFaviconSrc] = React.useState<string | null>(null);

  const cancelSettle = React.useCallback((): void => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => cancelSettle, [cancelSettle]);

  // Load-bar state machine (D24): `started` raises the bar (indeterminate
  // until a progress-bearing frame arrives); intermediate frames are
  // `started` frames with progress; ANY terminal frame converges —
  // `finished` flashes to 100% then settles, `failed` collapses at once
  // with no error-color storm (the address bar's own state already speaks).
  // Convergence is idempotent: a terminal frame on an idle bar is a no-op,
  // and a `started` during the settle window cancels the pending collapse,
  // so a missing `failed` (macOS dead-port loads finish about:blank
  // honestly) is always healed by the next terminal or started frame.
  const applyLoadFrame = React.useCallback((frame: LoadStateFrame): void => {
    if (frame.phase === "started") {
      cancelSettle();
      setLoadBar({ active: true, progress: normalizeProgress(frame.progress) });
      return;
    }
    if (frame.phase === "finished") {
      setLoadBar((prev) => (prev.active ? { active: true, progress: 1 } : prev));
      cancelSettle();
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        setLoadBar(LOAD_BAR_IDLE);
      }, LOAD_BAR_SETTLE_MS);
      return;
    }
    setLoadBar((prev) => (prev.active ? LOAD_BAR_IDLE : prev));
  }, [cancelSettle]);

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
          setCommittedUrl(message.url);
          return;
        }
        if (isLoadStateFrame(message)) {
          applyLoadFrame(message);
        }
      });
      endpoint.onClose(() => setConnected(false));
      endpoint.post({ kind: "get-url" }).catch(() => setConnected(false));
    });
  }, [applyLoadFrame]);

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
  //
  // Favicon (D25): the committed origin's /favicon.ico, remounted per src so
  // a navigation retries the image; an errored fetch falls back to the
  // hostname's letter glyph, and a non-http(s) or unparseable target keeps
  // the globe placeholder.
  const favicon = deriveFavicon(committedUrl);
  const faviconBroken = favicon !== undefined && failedFaviconSrc === favicon.src;

  return (
    <div className="relative flex h-11 w-full items-center gap-2 border-b border-border bg-card px-3">
      <Button variant="ghost" size="icon-sm" disabled={!connected} onClick={back} aria-label={messages.common.back}>
        <ArrowLeft />
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={!connected} onClick={forward} aria-label={messages.common.forward}>
        <ArrowRight />
      </Button>
      <Button variant="ghost" size="icon-sm" disabled={!connected} onClick={reload} aria-label={messages.common.reload}>
        <RotateCw />
      </Button>
      {favicon === undefined ? (
        <Globe className="size-4 shrink-0 text-muted-foreground" aria-label={messages.tabs.siteIconPlaceholder} />
      ) : faviconBroken ? (
        <span
          className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted font-mono text-[10px] leading-none font-semibold text-muted-foreground"
          aria-label={messages.tabs.siteIconFallback}
        >
          {favicon.glyph}
        </span>
      ) : (
        <img
          key={favicon.src}
          src={favicon.src}
          alt=""
          className="size-4 shrink-0 rounded-sm"
          onError={() => {
            setFailedFaviconSrc(favicon.src);
          }}
        />
      )}
      <Input
        ref={barRef}
        className="h-7 font-mono text-xs"
        value={bar}
        placeholder={messages.tabs.urlPlaceholder}
        onChange={(event) => setBar(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          go(bar);
        }}
      />
      {/* Load bar (D24): a 2px strip on the toolbar's bottom edge — the
          boundary against the content webview below; the affordance exists
          only while a load is in flight or flashing done. Indeterminate
          sweep while progress is unknown (Windows phase-only frames, or
          before the first estimatedProgress frame lands); positioned width
          otherwise. Purely presentational — pointer events stay with the
          strip's controls. */}
      {loadBar.active ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(loadBar.progress === null ? {} : { "aria-valuenow": Math.round(loadBar.progress * 100) })}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
        >
          {loadBar.progress === null ? (
            <div className="toolbar-load-indeterminate h-full w-1/4 bg-primary" />
          ) : (
            <div
              className="h-full bg-primary transition-[width] duration-150 ease-out"
              style={{ width: `${Math.round(loadBar.progress * 100)}%` }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
