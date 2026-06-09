# ext-webview

Use this reference when the user asks how to use the official OpenTray WebView extension.

## Install

```bash
pnpm add opentray @opentray/ext-webview
```

The facade package stays platform-neutral. Official native WebView packages are published for macOS and Windows. Linux remains supported by OpenTray core, but `@opentray/ext-webview` does not publish a Linux native runtime package.

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

Real native smoke is a visual acceptance recipe, not an `opentray` CLI subcommand. In a source checkout, use:

```bash
OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=1 pnpm --filter opentray example:daemon-tray
```

## Platform Truth

- macOS is the stable human-visible acceptance path.
- Windows is the stable WebView2-backed runtime path.
- Linux is unsupported for `@opentray/ext-webview`; do not tell package users to install `@opentray/ext-webview-linux-*`.
- If a platform cannot create a visible native WebView runtime, it should return explicit unsupported/capability failure rather than fake success.
