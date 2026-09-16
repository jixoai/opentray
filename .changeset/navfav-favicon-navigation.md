---
"opentray": minor
---

ext-webview: navigationAction events, declarative navigation rules, native favicon surface

- New per-view `navigationAction` event: one push per native navigation decision point, payload `{ url, navigationType, isUserInitiated? }`. Platform truth is documented per side: Windows maps redirects exactly and projects unredirected user navigations as `link`; macOS maps WKNavigationAction with no redirect distinction and omits the user flag.
- Declarative navigation rules: `createWebview({ navigationRules: [{ pattern, action: "block" }] })` and `setNavigationRules()`. Rules are evaluated synchronously on the native UI thread; a blocked navigation cancels before it starts and reports `loadState failed` with the stable error code `4500001` (`navigation_blocked`). Patterns are URL globs — `*` matches any character run, everything else is literal.
- Native favicon observation: `createWebview({ favicon: true })` opts a view into `faviconChange` pushes (Latest class, same-href dedupe) plus the `getFavicon()` `(value, seq)` query. Works on bridgeless children through an observe-only bootstrap that exposes no bridge surface.
- Contract fingerprint bumped to `opentray-ext-webview-contract-6`; the event family is now seven kinds.
