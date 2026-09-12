<!--
Orthogonal intents (maintained 2026-09-12; add-webview-orchestration plan D12/D13/D15):
1. Teach the pattern of an OpenTray program with a backend entry exposing capabilities
   to trusted pages over an ext-webview message channel.
2. Use the create-opentray navigation interface as the worked example while keeping the
   schema private to the application that owns it.
3. Keep control-plane traffic on the channel: a companion local server does not grow a
   navigation/capability HTTP API just because a toolbar exists.
4. State the native toolbar carrier facts for generated apps: both application forms,
   one carrier, default off, no embedding-policy probing.
-->

# Backend Capabilities Over a Message Channel

Use this reference when an OpenTray program with a backend entry (the Node process that
calls `createTray()`) needs to expose capabilities to a trusted page — commands the page
can invoke, state it can query, and state changes it should observe — without widening
an HTTP surface or embedding the target page.

## The pattern

Compose one window out of sibling webviews through `@opentray/ext-webview` orchestration,
then connect your entry to the trusted page with one message channel:

1. Create the trusted page (a toolbar, sidebar, or control strip you serve yourself)
   with an explicit per-child bridge policy — `{ webviewId: true, messageChannels: true }`
   is the toolbar shape.
2. Create the content webview with NO bridge policy: an arbitrary page stays bridgeless
   by construction and can neither create nor receive channels.
3. `createMessageChannel({ target })` from the entry; the trusted page receives its
   endpoint through `navigator.opentrayWebview.onCreatedMessageChannel(...)` (the
   surface exists only when the policy injects it).
4. Define your payload schema (command / state-query / state-event) as plain JSON
   values over the channel. The schema is application-owned — it is yours, not an
   OpenTray protocol contract.
5. Drive truth from events, not scraping: subscribe to the content webview's
   `urlChange`/`titleChange` pushes and relay them over the channel; answer state
   queries with `getUrl()`/`getTitle()`, which return the current value together
   with its `seq` so the page can discard stale events by sequence number.

A channel failure is a bug to expose (log it), not a reason to build a fallback path.
If the program also runs a companion local server (static assets, an existing
supervision API), keep the new capability OFF that server: commands, state queries,
and state events flow exclusively over the channel.

## Worked example: the create-opentray navigation interface

`create-opentray --toolbar` (URL and command applications alike) is this pattern in
production. The generated entry composes a native toolbar webview above the content
webview and drives navigation over a channel whose schema is private to the create
package:

```ts
// Entry side (generated project) — simplified from the create-opentray carrier.
const win = tray
  .extend(WebviewExt)
  .createWebviewWindow({ windowOnly: true, width: 1200, height: 800 });

await win.show();
await win.createWebview({
  id: "toolbar",
  url: toolbarUrl, // served by the entry's local shell host
  bridge: { webviewId: true, messageChannels: true },
});
const content = await win.createWebview({ id: "content", url: targetUrl }); // bridgeless
await win.setLayout(column([fixed("toolbar", 44), grow("content")]));

const channel = await win.createMessageChannel({ target: "toolbar" });

// State events: the content webview's urlChange IS the address bar's truth.
content.onUrlChange((event) => {
  void channel.post({ kind: "url", url: event.url });
});

// Commands: navigate / back / forward / reload / get-url arrive as payloads.
channel.onMessage((payload) => {
  const message = payload ?? {};
  if (message.kind === "navigate") void content.navigate(message.url);
  if (message.kind === "back") void content.back();
  if (message.kind === "forward") void content.forward();
  if (message.kind === "reload") {
    void content.getUrl().then(({ url }) => content.navigate(url));
  }
  if (message.kind === "get-url") {
    void content.getUrl().then(({ url }) => channel.post({ kind: "url", url }));
  }
});
```

```ts
// Toolbar page side (trusted page served by the entry).
const bridge = navigator.opentrayWebview; // injected by the bridge policy
bridge.onCreatedMessageChannel((endpoint) => {
  endpoint.onMessage((payload) => {
    if (payload?.kind === "url") setAddressBar(payload.url);
  });
  void endpoint.post({ kind: "get-url" }); // seed current truth
});
```

The create package keeps this `{kind: ...}` schema out of `@opentray/spec` on purpose:
OpenTray provides the transport and primitives; each application owns its channel
vocabulary.

## Channel facts that shape the design

- Endpoints expose `id`, `post(payload)`, `onMessage(handler)`, `onClose(handler)`,
  `close()`, and `destroy()` — there is no port transfer, and the host cannot be
  targeted; it participates as creator.
- Payloads are UTF-8 strings or JSON values delivered FIFO; messages posted before the
  first `onMessage` registration are buffered, not dropped. Each port queue holds at
  most 1000 messages / 1 MiB; overflow closes the channel with reason `queue_overflow`.
- A page-side endpoint closes with `document_navigated` when its document navigates —
  never buffer protocol state across navigation; re-establish after a load.
- `onClose` fires at most once per endpoint per channel; treat it as terminal for that
  channel and create a new one when needed.
- Keystrokes land in whichever webview holds native focus. If the trusted page binds
  keyboard shortcuts, they work while that webview holds focus — state this limitation
  to users instead of trying to observe keys inside the content page.

## The native toolbar carrier in create-opentray

- `--toolbar` (or the wizard's 「导航工具栏」 toggle, default off) applies to BOTH
  application forms: URL apps compose it over the target address; command apps compose
  it over every dedicated service window.
- The carrier is native multi-webview composition: one toolbar webview pinned at a
  fixed top strip plus one content webview loading the address/service directly as a
  top-level browsing context. No generated app wraps the target in an iframe.
- Embedding policy (`X-Frame-Options`, CSP `frame-ancestors`) is not consulted
  anywhere: a top-level content webview is not an embedded context, so
  embedding-hostile sites render the same as any other address. Creation does not
  probe, warn about, or downgrade the toolbar request.
- The wizard's own preview tabs are a different surface: they are authoring-time-only
  previews and never the carrier for a materialized application.
- The tray menu still offers Reload in every mode; it reloads the content webview
  without restarting the app process.

Read [`ext-webview.md`](ext-webview.md) for the full orchestration contract (layout
sugar, bridge policy, event family, error codes) and
[`create-app.md`](create-app.md) for the create-opentray product flow.
