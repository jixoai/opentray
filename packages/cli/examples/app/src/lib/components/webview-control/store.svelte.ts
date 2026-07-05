import type { NavigatorWindow } from "$lib/types";

// Bridge acquisition — opentray-prefixed first, global fallback.
export function resolveWindowBridge(): NavigatorWindow | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    opentrayWindow?: NavigatorWindow;
    window?: NavigatorWindow;
  };
  return nav.opentrayWindow ?? nav.window;
}

// Screen API — opentray-prefixed first, then navigator.screen if it has
// getScreenDetails, else undefined.
export interface ScreenApi {
  getScreenDetails(): Promise<unknown>;
}
export function resolveScreenApi(): ScreenApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    opentrayScreen?: ScreenApi;
    screen?: ScreenApi;
  };
  return nav.opentrayScreen ?? nav.screen;
}

// The opentray namespace exec command.
export function execCommand(command: string): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { opentray?: { execCommand(c: string): void } };
  nav.opentray?.execCommand(command);
}

export interface EventLogEntry {
  id: number;
  ts: number;
  label: string;
  payload: unknown;
}

let entryId = 0;
const EVENT_LOG_CAP = 12;

// Central reactive state shared across all webview-control panels. Svelte 5
// runes: every mutation produces a fresh array/object so $derived consumers
// re-run reliably.
class WebviewControlStore {
  events = $state<EventLogEntry[]>([]);
  capabilities = $state<Record<string, unknown> | null>(null);
  platform = $state<string>("unknown");
  style = $state<Record<string, unknown> | null>(null);
  windowState = $state<{
    state?: string;
    minimized?: boolean;
    maximized?: boolean;
    visible?: boolean;
  } | null>(null);
  overlayInsets = $state<{ left: number; right: number; height: number }>({
    left: 0,
    right: 0,
    height: 44,
  });
  overlayStatusText = $state<string>("");
  title = $state<string>(typeof document !== "undefined" ? document.title : "");

  appendEvent(label: string, payload: unknown): void {
    const entry: EventLogEntry = {
      id: (entryId += 1),
      ts: Date.now(),
      label,
      payload,
    };
    const next = [entry, ...this.events];
    if (next.length > EVENT_LOG_CAP) next.length = EVENT_LOG_CAP;
    this.events = next;
  }

  setCapabilities(caps: Record<string, unknown> | null): void {
    this.capabilities = caps ? { ...caps } : null;
    const platform = caps && typeof caps === "object" && "platform" in caps
      ? String((caps as { platform: unknown }).platform)
      : "unknown";
    this.platform = platform;
  }

  setStyle(style: Record<string, unknown> | null): void {
    this.style = style ? { ...style } : null;
  }

  setWindowState(state: Record<string, unknown> | null): void {
    this.windowState = state ? { ...state } : null;
  }

  setOverlayInsets(insets: { left: number; right: number; height: number }): void {
    this.overlayInsets = { ...insets };
  }

  setOverlayStatusText(text: string): void {
    this.overlayStatusText = text;
  }

  setTitle(title: string): void {
    this.title = title;
  }

  clearEvents(): void {
    this.events = [];
  }
}

export const store = new WebviewControlStore();

// ---- Pure helpers (ported from the original webview-control.html) ----

export function formatError(error: unknown): string {
  if (!error) return "(unknown error)";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const MACOS_MATERIALS = [
  "hudWindow",
  "sidebar",
  "windowBackground",
  "contentBackground",
  "underWindowBackground",
  "appearanceBased",
];

const WINDOWS_MATERIALS = ["mica", "acrylic", "tabbed", "auto"];

export function backgroundOptionsForPlatform(platform: string): string[] {
  if (platform === "windows") return WINDOWS_MATERIALS;
  if (platform === "macos") return MACOS_MATERIALS;
  return [];
}

export function isWindowsStyle(style: Record<string, unknown> | null): boolean {
  if (!style) return false;
  const bg = style.background as Record<string, unknown> | undefined;
  if (!bg) return false;
  if (bg.kind === "platformMaterial") {
    return WINDOWS_MATERIALS.includes(String(bg.material ?? ""));
  }
  return false;
}

export function backgroundStateOptions(
  style: Record<string, unknown> | null,
): string[] {
  if (isWindowsStyle(style)) return ["active", "inactive"];
  return ["followsWindowActiveState", "active", "inactive"];
}

export function normalizeOpacityInput(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

export function formatOpacity(value: number): string {
  return `${Math.round(value * 100)}%`;
}
