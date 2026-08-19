---
title: "Wry permission hooks are not publicly policy-controlled"
state: open
github_issue_status: open
type: risk
group: "webview-browser-permissions"
labels:
  - "native-substrate"
  - "risk"
depends_on: []
blocks: []
priority: high
owner: "codex"
source: "bun run openspec:vision2 -- issues darwin-runtime-carrier-and-webview-permissions --new risk --title Wry permission hooks are not publicly policy-controlled --group webview-browser-permissions --label native-substrate --priority high --owner codex"
---

## Summary

The current Wry substrate does not expose a stable public builder callback for all browser permission decisions that this change models. Wry 0.55.1 grants macOS media capture inside its internal `WKUIDelegate`, and Windows WebView2 currently has an internal clipboard permission handler path.

## Impact

If OpenTray claims native browser permissions are fully enforced before owning the substrate hook, remote or local pages could still reach engine-level grants outside OpenTray's policy law. The most visible risk is camera/microphone on macOS: `Info.plist` can make the app identity valid, but Wry's internal delegate still decides media capture unless OpenTray controls or patches that delegate path.

This release therefore scopes the implemented surface to typed policy parsing, exact-origin `opentrayPermissions` injection, app-scoped durable permission facts, and typed unsupported request results for browser-engine permission grants that the native substrate cannot route through OpenTray yet.

## Evidence

- `~/.cargo/registry/src/.../wry-0.55.1/src/wkwebview/class/wry_web_view_ui_delegate.rs` implements `requestMediaCapturePermissionForOrigin` and calls `WKPermissionDecision::Grant`.
- `~/.cargo/registry/src/.../wry-0.55.1/src/webview2/mod.rs` registers `PermissionRequested` only for its internal clipboard path when `.with_clipboard(true)` is used.
- `wry::WebViewBuilder` exposes `.with_autoplay(...)` and `.with_clipboard(...)`, but no stable public all-permission policy callback in the version currently used by `opentray-ext-webview`.

## Recommendation

Keep native browser-engine grant enforcement scoped as unsupported until the native substrate is owned. Before closing this risk, add an OpenTray-owned Wry extension point / fork patch for native permission callbacks. Verification must include a native test or manual smoke proving camera/microphone requests pass through OpenTray policy before WebKit/WebView2 grant.
