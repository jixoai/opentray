# ext-webview

Use this reference when the user asks how to use the official OpenTray WebView extension.

## Install

```bash
pnpm add opentray @opentray/ext-webview
```

The facade package stays platform-neutral. The daemon resolves the current platform native library package automatically.

## Public Shape

Attach the facade to an existing tray handle:

```ts
import { attachWebview } from "@opentray/ext-webview";

const webview = attachWebview(tray);
await webview.show({
  type: "show",
  html: "<main>Hello</main>",
  width: 360,
  height: 220,
  fallbackRect: { x: 0, y: 0, width: 1, height: 1 },
});
```

Supported commands:

- `show`
- `hide`
- `navigate`
- `evaluate`
- `postMessage`

## Examples

Protocol-only facade example:

```bash
pnpm --filter @opentray/ext-webview example:webview
```

Real native smoke through the public SDK:

```bash
opentray smoke daemon-tray
```

## Platform Truth

- macOS is the current human-visible acceptance path.
- If a platform cannot create a visible native WebView runtime, it should return explicit unsupported/capability failure rather than fake success.
