# @opentray/spec

Shared TypeScript protocol and contract package for OpenTray.

## Role

- Define newline-delimited JSON protocol payload shapes.
- Define protocol version and endpoint identity helpers.
- Define public `App`, `Tray`, `Session`, icon projection, menu, tooltip, and extension contract types.
- Keep protocol types reusable by `opentray` and official extensions.

This package is platform-neutral and must not import native implementation packages.

## Broker Artifact Identity

`BrokerArtifactIdentity` identifies the exact broker executable selected by the SDK. It combines the caller package version, native target, executable SHA-256, and build identity. `BrokerReadyMetadata` persists that identity beside the caller-scoped endpoint, while the protocol `ready` frame carries the same identity to the connected SDK.

Use `isBrokerArtifactIdentity()` at untyped storage or transport boundaries and `brokerArtifactIdentityEquals()` when deciding whether a live broker can be reused. PID liveness, endpoint name, and package version alone are not compatibility evidence.

## Tray Contract

`TrayOptions` uses `id` as the tray atom identity. Visible tray text belongs to the unified `icon` field:

```ts
import type { Icon, TrayOptions } from "@opentray/spec";

const icon: Icon = {
  type: "file",
  path: "./status.png",
  text: "Status",
  "icon-only": { type: "file", path: "./status-small.png" },
  "text-only": "Status",
  "icon-text": { type: "file", path: "./status.png", text: "Status" },
  "darwin-icon-only": {
    type: "file",
    path: "./status-template.png",
    isTemplate: true,
  },
  "win32-icon-only": { type: "file", path: "./status.ico.png" },
  "linux-icon-only": { type: "file", path: "./status-linux.png" },
};

const tray: TrayOptions = {
  id: "com.example.status",
  icon,
};
```

`Space`, `Surface`, `spaceId`, `create-space`, and top-level tray `title` are removed public vocabulary in the current tray-first model.

OS-scoped candidates are peers of the generic keys. The active OS candidate shadows the matching generic candidate for the same mode; non-matching OS keys are ignored. Darwin candidates may carry `isTemplate` so the tray-icon backend can render a macOS template image.

## Multi-Webview Orchestration Protocol

`webview.ts` defines the platform-neutral wire DTOs for one window session hosting sibling webview native views (`ext-webview` carries them inside its extension command/event envelopes). Every frame carries the owner tuple `(appId, trayId, sessionId)` so session-scoped ids never collide across sessions.

- **Per-child bridge policy** — `WebviewBridgePolicy` is frozen as the boolean field set `{ webviewId, messageChannels, navigatorWindow, navigatorScreen, nativeApi }`, all defaulting to `false`; `resolveWebviewBridgePolicy()` normalizes partial input, and omitting the policy entirely means no bridge.
- **Commands and results** — `WebviewOrchestrationCommandFrame` covers `create-webview` / `destroy-webview` / `list-webviews`, per-view `navigate` / `back` / `forward` / `focus`, layout commit/patch, `getUrl` / `getTitle` queries (results carry the `(value, seq)` pair), and explicit `subscribe` / `unsubscribe` event frames.
- **Unified event family** — `WebviewEventFrame` is `{ type: "webview-event", owner, windowId, webviewId, kind, seq, payload }` with `kind ∈ { urlChange, titleChange, focused, geometryChange }` and field-frozen payloads; `isWebviewEventFrame()` validates incoming frames including kind↔payload coherence.
- **Layout protocol** — `WebviewLayoutDocument` is an ordered array of layers (bottom-to-top z-order), each owning one flex tree limited to `dir/gap/children` and the `width/height/flex/min/max` sizing fields, plus `box` paint views. `validateWebviewLayout()` performs the pre-solve validation (`unknown_view`, `invalid_layout_measure`).

The typed error-code registry is frozen in `WEBVIEW_ORCHESTRATION_ERROR_CODES` with the `{ error: { code, message } }` envelope shape.

## Message Channel Wire Protocol

`channel.ts` defines the targeted-connection channel protocol: `channel.create` / `channel.post` / `channel.close` / `channel.destroy` / `channel.list` plus the `channel.created` / `channel.closed` push events, result frames, and the typed error envelope. The owner tuple rides every frame envelope. Frozen registries and bounds: `CHANNEL_CLOSE_REASONS`, `CHANNEL_QUEUE_MAX_MESSAGES` (1000), `CHANNEL_QUEUE_MAX_BYTES` (1 MiB), `CHANNEL_TOMBSTONE_LIMIT` (32), and the per-command error lists. `channelListEntryForPage()` projects list entries to the page-visible shape — page peers see side labels only, never peer webview ids.

## Canonical JSON (RFC 8785)

`canonicalJsonEncode()` serializes a JSON value to its RFC 8785 (JCS) canonical form: UTF-16-code-unit key order, ECMAScript `Number::toString` number grammar (`-0` → `0`, `1.0` → `1`, `1e21` → `1e+21`), and JCS string escaping. The Rust mirror (`crates/opentray-spec/src/canonical_json.rs`) must produce identical bytes; both implementations are verified against the shared fixtures in `fixtures/canonical-json/`, and the frame wire shapes are pinned by `fixtures/frames/`. Values outside the RFC 8785 domain (NaN, Infinity, `undefined`, functions) are rejected — channel posting maps that to the typed error `invalid_payload`.
