// Central registry of every example route. Used by the index page (card grid)
// and the layout (sidebar navigation). Add a new entry here when a route is
// created; the launcher matrix stays the source of truth for which rows run.

export interface ExampleEntry {
  href: string;
  title: string;
  description: string;
}

export const EXAMPLES: readonly ExampleEntry[] = [
  {
    href: "/download",
    title: "Download",
    description:
      "Download lifecycle events, suggestedFilename dedupe, concurrent and slow-endpoint progress.",
  },
  {
    href: "/webview-control",
    title: "WebView Control",
    description:
      "Window, style, overlay, screen, navigation, and title/icon bridge surface.",
  },
  {
    href: "/tray-panel",
    title: "Tray Panel",
    description: "Tray-anchored frameless panel with material and placement controls.",
  },
  {
    href: "/placement",
    title: "Placement Kit",
    description: "WebviewPlacementKit watch/applyOnce for tray, screen, and edge anchors.",
  },
  {
    href: "/media-query",
    title: "Media Query Kit",
    description: "mediaQueryKit + styleKit responsive native-window recipes.",
  },
  {
    href: "/badge",
    title: "Badge",
    description: "ext-badge debug panel projected through ext-webview IPC.",
  },
  {
    href: "/debug-runtime-tray",
    title: "Debug Runtime Tray",
    description: "Single-primary tray action that opens a WebView panel.",
  },
] as const;
