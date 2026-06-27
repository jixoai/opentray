# Getting Started

Use this reference when the user asks how to install OpenTray or create a first tray.

## Install

```bash
pnpm add opentray
```

`opentray` resolves the current platform runtime package through optional dependencies. The user installs the top-level package; they do not import platform binary packages directly.

For agent-assisted usage, install the consumer-facing OpenTray skill:

```bash
npx skills add jixiao/opentray --skill opentray
```

## Protocol-Line Installs

`latest` means newest published package version. It is convenient, but it is not a compatibility contract across `opentray`, official extensions, and platform binary atoms. For full version-selection rules, read `references/versioning.md`.

Use an OpenTray protocol-line dist-tag when you want a compatible package closure:

```bash
pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B
```

For alpha testing on the same OpenTray protocol line:

```bash
pnpm add opentray@alpha-A-B @opentray/ext-webview@alpha-A-B
```

Replace `A-B` with the current line from `@opentray/spec`. The protocol-line tag is extension-agnostic. Do not look for tags such as `stable-webview-1-0`; runtime compatibility is still enforced by the daemon handshake and extension ABI checks.

## First Flow

1. Import `runTrayApp` from `opentray/node` for the first app path.
2. Use the callback to create one tray and react to one menu item.
3. Let the helper own the visible-runtime host loop.
4. Switch to `createTray()` directly only when you already own the process shape.

Typical first app:

```ts
import { runTrayApp } from "opentray/node";

await runTrayApp(async ({ createTray }) => {
  const tray = await createTray({
    id: "com.example.status",
    icon: { "text-only": "OT" },
    menu: { items: [{ type: "item", id: 1, title: "Quit", primaryEvent: true }] },
  });
  tray.onMenuClick(({ itemId }) => void (itemId === 1 && tray.destroy()));
}, { autoExitAfterMs: 1500 });
```

If the user already owns the runtime/process boundary, use the lower-level direct tray path:

1. Import the top-level SDK from `opentray`.
2. Call `createTray(...)` with an `id`, plus optional `tooltip`, `icon`, and `menu`.
3. Mutate the tray through the returned handle: `setMenu`, `setTooltip`, `setIcon`, `loadExtension`, `extend`, etc.
4. Consume events through `onMenuClick` / `onTrayClick` / `onTrayDoubleClick` / `listen`.

Typical consumer entrypoint:

```ts
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.status",
  tooltip: { title: "OpenTray", description: "Status" },
  icon: { type: "file", path: "./tray.png" },
  menu: { items: [{ type: "item", id: 1, title: "Open" }] },
});
```

Visible tray text is part of icon projection (`icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`), not a top-level tray `title`. There is no `tray.setTitle()`; update text through `setIcon(...)`.

Runtime identity (app id/name) is separate from tray projection and is passed as the second argument when a host needs explicit diagnostic identity:

```ts
await createTray(options, { appId: "com.example.status", appName: "Status" });
```

Use the lower-level transport APIs (`createClient`) only for custom protocol work.

For ready-made examples:

```bash
pnpm --filter opentray example:first-app
pnpm --filter opentray example:basic
```

This is useful for learning the request/response flow, but the public consumer path should start from the top-level `opentray` exports.

## Real Native Acceptance

For a real native tray (and optional WebView), use the source-tree visual acceptance recipes in `references/visual-acceptance.md`. The public `opentray` CLI binary does not expose daemon lifecycle or smoke subcommands; smoke orchestration is a workflow over example scripts, not a CLI subcommand.
