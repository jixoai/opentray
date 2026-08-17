/**
 * Address-bar wrapper window for one service port of a generated app:
 * an address bar on top (managed through the Web Navigation API with a
 * history-array fallback) and the service in an iframe below.
 *
 * Navigation model: the wrapper document NEVER navigates cross-origin. Each
 * address-bar entry is a same-origin pseudo-route `?url=<encoded target>`;
 * the NavigateEvent is intercepted and only the IFRAME moves. Back/forward
 * traverse pseudo-routes, so the wrapper stays mounted and the Navigation
 * API remains the sole navigation authority (no history.pushState).
 */
import { ArrowLeft, ArrowRight, Globe, RotateCw } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const navigationApi = (): Navigation | undefined =>
  typeof window !== "undefined" && "navigation" in window
    ? (window as { navigation?: Navigation }).navigation
    : undefined;

const normalizeUrl = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`).href;
  } catch {
    return undefined;
  }
};

const pseudoRoute = (target: string): string =>
  `${location.pathname}?url=${encodeURIComponent(target)}`;

const initialTarget = (): string => {
  const param = new URLSearchParams(location.search).get("url");
  return normalizeUrl(param ?? "") ?? "about:blank";
};

export function BrowsePage(): React.JSX.Element {
  const initial = React.useRef(initialTarget());
  const [bar, setBar] = React.useState(initial.current);
  const [frameSrc, setFrameSrc] = React.useState(initial.current);
  const fallbackHistory = React.useRef<string[]>([initial.current]);
  const fallbackIndex = React.useRef(0);
  const nav = React.useRef(navigationApi());
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [navVersion, setNavVersion] = React.useState(0);

  const applyTarget = React.useCallback((target: string): void => {
    setFrameSrc(target);
    setBar(target);
  }, []);

  React.useEffect(() => {
    const api = nav.current;
    if (api === undefined) return;
    // Intercept every same-origin pseudo-route navigation: the wrapper
    // document stays; only the iframe moves.
    const onNavigate = (event: NavigateEvent): void => {
      if (!event.canIntercept || event.hashChange) return;
      event.intercept({
        handler: () => {
          const target = new URLSearchParams(
            new URL(event.destination.url).search,
          ).get("url");
          if (target === null) return;
          const normalized = normalizeUrl(target);
          if (normalized !== undefined) applyTarget(normalized);
        },
      });
    };
    const onDone = (): void => setNavVersion((v) => v + 1);
    api.addEventListener("navigate", onNavigate);
    api.addEventListener("currententrychange", onDone);
    return () => {
      api.removeEventListener("navigate", onNavigate);
      api.removeEventListener("currententrychange", onDone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (target: string): void => {
    const api = nav.current;
    if (api !== undefined) {
      try {
        // Same-origin pseudo-route → intercepted above → iframe moves.
        api.navigate(pseudoRoute(target));
        return;
      } catch {
        /* fall through */
      }
    }
    fallbackHistory.current = [
      ...fallbackHistory.current.slice(0, fallbackIndex.current + 1),
      target,
    ];
    fallbackIndex.current = fallbackHistory.current.length - 1;
    applyTarget(target);
  };

  const back = (): void => {
    const api = nav.current;
    if (api !== undefined && api.currentEntry !== null && api.currentEntry.index > 0) {
      const previous = api.entries()[api.currentEntry.index - 1];
      if (previous !== undefined) {
        try {
          api.traverseTo(previous.key);
          return;
        } catch {
          /* fall through */
        }
      }
    }
    if (fallbackIndex.current > 0) {
      fallbackIndex.current -= 1;
      applyTarget(fallbackHistory.current[fallbackIndex.current] as string);
    }
  };

  const forward = (): void => {
    const api = nav.current;
    if (api !== undefined && api.currentEntry !== null) {
      const entries = api.entries();
      const next = entries[api.currentEntry.index + 1];
      if (next !== undefined) {
        try {
          api.traverseTo(next.key);
          return;
        } catch {
          /* fall through */
        }
      }
    }
    if (fallbackIndex.current < fallbackHistory.current.length - 1) {
      fallbackIndex.current += 1;
      applyTarget(fallbackHistory.current[fallbackIndex.current] as string);
    }
  };

  // Re-derive availability per navigation commit (navVersion bump).
  const entry = nav.current?.currentEntry ?? null;
  const canBack =
    entry !== null ? entry.index > 0 : fallbackIndex.current > 0;
  const canForward =
    entry !== null
      ? entry.index < (nav.current?.entries().length ?? 1) - 1
      : fallbackIndex.current < fallbackHistory.current.length - 1;
  void navVersion;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Address bar (Web Navigation API managed) */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <Button variant="ghost" size="icon-sm" disabled={!canBack} onClick={back} aria-label="后退">
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!canForward} onClick={forward} aria-label="前进">
          <ArrowRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            if (frameRef.current !== null) {
              frameRef.current.src = frameSrc;
            }
          }}
          aria-label="重新加载"
        >
          <RotateCw />
        </Button>
        <Globe className="size-4 shrink-0 text-muted-foreground" />
        <Input
          className="h-7 font-mono text-xs"
          value={bar}
          placeholder="输入 URL 跳转"
          onChange={(event) => setBar(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const next = normalizeUrl(bar);
            if (next !== undefined) go(next);
          }}
        />
      </div>
      {/* Service content */}
      <iframe
        ref={frameRef}
        title="service"
        src={frameSrc}
        className="min-h-0 flex-1 border-0 bg-white"
        sandbox="allow-same-origin allow-scripts allow-forms"
      />
    </div>
  );
}
