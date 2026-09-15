# Multi-Webview Orchestration

One window session hosts any number of sibling native webviews composed
through a declarative layered layout, connected by targeted message channels,
and observed through one per-view push event family. This reference is the
consumer contract: the composition model, the layout document, the bridge
policy, events, channels, and the toolbar recipe `create-opentray` uses.
Laws and decision context live in
[`ext-webview.md`](ext-webview.md); the backend-capability pattern over a
channel is in [`backend-ipc.md`](backend-ipc.md).

## Composition model

```ts
const win = tray.createWebviewWindow({ windowOnly: true, width: 1024, height: 720 });
await win.show();

const toolbar = await win.createWebview({
  id: "toolbar",
  url: "http://127.0.0.1:5173/toolbar.html",
  bridge: { webviewId: true, messageChannels: true },
});
const content = await win.createWebview({ id: "content", url: "https://example.com" });

const listed = await win.listWebviews();     // [{ id, ... }]
await content.navigate("https://example.org");
await content.back(); await content.forward();
await content.focus();
const { value, seq } = await content.getUrl();   // same pair shape for getTitle()
await win.destroyWebview("sidebar");
```

- `windowOnly: true` declares a window-only session: no primary webview, the
  window is a container for children.
- Every child is a native webview in the same window. A child without a
  `bridge` policy is bridgeless: its page has no id, no channel surface, no
  native capability — arbitrary content stays bridgeless by default.
- Session ownership is keyed by `(appId, trayId, sessionId)`. A second window
  session for the same tray is the typed `tray_session_active` rejection;
  closing a session destroys exactly its own windows, webviews, channels, and
  popups.
- Exclusivity: a window style that affects translucency (frameless,
  material) cannot host multi-webview composition, and applying such a style
  to a window that already hosts more than one webview is rejected the same
  way. Both reject `multiwebview_unsupported_style` before any state changes.

## The layout document

Principle: JS declares *what* it wants; the native side is the solver. A
layout is data, not coordinate math — the JS side never computes view
positions.

A document is an ordered list of layers; array order is the z-order (there
is no `zIndex` field anywhere). Each layer owns one independent flex tree.
Sugar builders compile to the wire protocol:

- `row(children, options?)` / `column(children, options?)` — flex containers;
  `options.gap` sets spacing.
- `view(id, sizing?)` — a webview reference with optional sizing fields.
- `fixed(id, 44)` — a fixed size (`number` sets `height`, the canonical
  column-child toolbar shape; the object form carries any sizing fields,
  e.g. `{ width: 200 }` for row children).
- `grow(id, flex = 1)` — fills remaining space.
- `{ kind: "box", id, background, border, cornerRadius }` — the decorative
  paint primitive: solid color, border, corner radius, no web content,
  input passes through to whatever is beneath.

```ts
import { box, column, fixed, grow } from "@opentray/ext-webview";

await win.setLayout(column([fixed("toolbar", 44), grow("content")]));
await win.layout.update("toolbar", { height: 52 });   // single-node patch
```

`setLayout(tree)` accepts a document, a bare layer array, or a single root
node. Solving is native (Taffy) and transactional: frames are computed,
applied, overlay/titlebar safe areas are re-projected per webview, and drag
regions are re-registered in one commit. A window resize triggers the same
native re-solve directly — resize never round-trips through JS. Replacing a
layout keeps a webview that the new tree still references by id, without
reloading its page.

## Per-view events

One push-only family per webview, no replay, no polling:

| Event | Payload |
| --- | --- |
| `urlChange` | `{ url }` |
| `titleChange` | `{ title }` |
| `focused` | `{ focused }` |
| `geometryChange` | view-local logical-pixel rect |
| `loadState` | `{ phase: "started" \| "finished" \| "failed", url, errorCode?, progress? }` |

`loadState` is the navigation lifecycle: `started` when a navigation begins,
`finished` on success, `failed` with an `errorCode` on failure; `progress`
(0 to 1) rides phases the platform can measure and is omitted otherwise.
Every frame carries `{ windowId, webviewId, seq, ... }` where `seq` is a
per-view monotonic counter.

Subscription race rule: subscribe first, then query the current value
(`getUrl()` / `getTitle()` return `{ value, seq }`), and discard any event
whose `seq` is not greater than the queried one.

```ts
content.onUrlChange((event) => { /* address-bar truth */ });
content.onLoadState((event) => { /* progress bar, error surface */ });
```

## Message channels

Host-to-page and page-to-page messaging rides targeted channels:

```ts
const channel = await win.createMessageChannel({ target: "toolbar" });
channel.onMessage((payload) => { /* already parsed */ });
await channel.post({ kind: "navigate", url: "https://example.org" });
const stop = channel.onClose((notice) => { /* notice.reason */ });
```

- Lifecycle: `created → open → closed(reason) → destroyed`. `onClose`
  observes exactly once. Reasons include `explicit`, `destroyed`,
  `peer_webview_destroyed`, `window_destroyed`, `session_closed`,
  `document_navigated`, `queue_overflow`.
- Queue bounds are exact and cross-platform: at most 1000 messages and at
  1 MiB cumulative payload per endpoint, counted as the bytes of each
  payload's RFC 8785 canonical serialization.
- A channel is created against a target webview; a bridgeless target
  rejects creation (`bridge_required`). There is no port transfer.
- Page-side peers never see other participants' ids.
- Delivery is push: page-to-host messages and document-navigation closes
  reach the host immediately through the extension EventPort, without any
  command in flight. Records the port cannot guarantee stay queued for the
  command-response path; messages are never silently dropped.

## The toolbar recipe

`create-opentray`'s navigation toolbar uses no private interface. Four
steps, copyable:

1. Create a `windowOnly` window with two webviews: the toolbar page with
   `bridge: { webviewId: true, messageChannels: true }`, the content page
   with no bridge policy.
2. Compose once: `setLayout(column([fixed("toolbar", 44), grow("content")]))`.
3. Subscribe to the content webview's `urlChange` / `titleChange` /
   `loadState` in the host, and forward state to the toolbar page over the
   channel. The address bar renders only what `urlChange` pushes (it keeps
   no state of its own); the progress bar is `loadState`-driven.
4. Commands flow back over the same channel; the host calls
   `content.navigate(url)` / `content.back()` / `content.forward()`.
   Navigation drives the content webview's native session history.

Variations are layout changes: a left sidebar is
`row([fixed("sidebar", 200), grow("content")])`; more views are more
`createWebview` calls and more channel targets. `box` nodes add separators
and backgrounds without pages.

## Known limits (v1)

- No favicon acquisition surface. `iconSync` projects the page favicon to
  the window icon (and back) on the primary webview, but there is no public
  API to fetch favicon bytes/URL, and no push event when a site changes its
  favicon dynamically. A bridgeless content child in a composed window is
  not a favicon emitter.
- Navigation granularity is `loadState`'s three phases plus `urlChange`.
  There is no redirect-level event and no navigation veto hook.
- `setTitle` on the handle projects through the compatible re-show path;
  there is no host-side `setFavicon`.
