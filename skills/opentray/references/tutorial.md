<!--
Orthogonal intents (maintained 2026-07-21; original user request: make the public Skill
teach package consumers rather than OpenTray repository mechanics):
1. Grow one consumer from a tray into retained extension windows.
2. Keep runtime identity and application lifecycle explicit.
3. Route advanced decisions to focused public references.
-->

# Progressive Tutorial

Use this reference to grow one installed-package integration without exposing
OpenTray repository internals.

## Stage 1: Own One Tray

```ts
import { createTray } from "opentray";

const tray = await createTray(
  {
    id: "com.example.status",
    icon: { "text-only": "OT" },
    menu: { items: [{ type: "item", id: 1, title: "Open", primaryEvent: true }] },
  },
  {
    appId: "com.example.status",
    appName: "Example Status",
  },
);
```

The application process owns this handle and its event handlers. Keep the
process alive; call `tray.destroy()` during final application teardown.

## Stage 2: Route Events And Mutation

```ts
tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) {
    // Open the application surface or execute the primary command.
  }
});

await tray.setIcon({
  type: "file",
  path: "./tray-active.png",
  text: "Ready",
});
```

Mutate the existing tray instead of rebuilding it. Use handle events when the
application needs one router, logging, permission checks, or stable IDs.

## Stage 3: Add A Retained WebView

```ts
import { WebviewExt } from "@opentray/ext-webview";

const webviewTray = tray.extend(WebviewExt);
const panel = webviewTray.createWebviewWindow({
  url,
  width: 360,
  height: 220,
});

tray.onMenuClick(({ itemId }) => {
  if (itemId === 1) void panel.show();
});
```

Create one handle and retain it. Repeated activations restore that session;
`destroy()` is page-runtime teardown, not ordinary dismissal. Read
`ext-webview.md` for content, placement, permissions, and native-window APIs.

## Stage 4: Choose The Window Role

Use `style.appMode: true` for a normal desktop application window and keep the
default `false` for a tray utility. The role is independent from `keepOnTop`,
`autoHide`, frameless chrome, material, and visibility. Read `app-mode.md` for
warm Dock reopen, cold `appLaunch`, and development-supervisor decisions.

## Stage 5: Package And Accept The Application

Choose the adapter matching the consumer's existing bundler; do not change
bundlers only for OpenTray. Read `bundling.md`, then run the consumer's real
production build and lifecycle command. Use `visual-acceptance.md` to verify the
tray, retained window, process-exit relaunch, and cleanup behavior that the
product actually claims.
