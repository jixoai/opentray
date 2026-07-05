// Central registry of every example route. Used by the index page (card grid)
// and the layout (sidebar navigation). Add a new entry here when a route is
// created; the launcher matrix stays the source of truth for which rows run.

export interface ExampleEntry {
  href: string;
  title: string;
  description: string;
  // Routes ready in the current phase. Routes not yet migrated are listed as
  // "coming soon" on the index page so the sidebar stays complete.
  ready: boolean;
}

export const EXAMPLES: readonly ExampleEntry[] = [
  {
    href: "/download",
    title: "Download",
    description:
      "Download lifecycle events, suggestedFilename dedupe, concurrent and slow-endpoint progress.",
    ready: true,
  },
  {
    href: "/webview-control",
    title: "WebView Control",
    description:
      "Window, style, overlay, screen, navigation, and title/icon bridge surface.",
    ready: true,
  },
  {
    href: "/tray-panel",
    title: "Tray Panel",
    description: "Tray-anchored frameless panel with material and placement controls.",
    ready: false,
  },
  {
    href: "/placement",
    title: "Placement Kit",
    description: "WebviewPlacementKit watch/applyOnce for tray, screen, and edge anchors.",
    ready: false,
  },
  {
    href: "/media-query",
    title: "Media Query Kit",
    description: "mediaQueryKit + styleKit responsive native-window recipes.",
    ready: false,
  },
  {
    href: "/badge",
    title: "Badge",
    description: "ext-badge debug panel projected through ext-webview IPC.",
    ready: false,
  },
  {
    href: "/debug-runtime-tray",
    title: "Debug Runtime Tray",
    description: "Single-primary tray action that opens a WebView panel.",
    ready: false,
  },
] as const;
