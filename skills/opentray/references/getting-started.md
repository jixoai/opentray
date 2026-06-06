# Getting Started

Use this reference when the user asks how to install OpenTray or create a first tray.

## Install

```bash
pnpm add opentray
```

`opentray` resolves the current platform daemon package through optional dependencies. The user installs the top-level package; they do not import platform binary packages directly.

## Protocol-Line Installs

`latest` means newest published package version. It is convenient, but it is not a compatibility contract across `opentray`, official extensions, and platform binary atoms.

Use an OpenTray protocol-line dist-tag when you want a compatible package closure:

```bash
pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B
```

For alpha testing on the same OpenTray protocol line:

```bash
pnpm add opentray@alpha-A-B @opentray/ext-lynx@alpha-A-B
```

Replace `A-B` with the current line from `@opentray/spec`. The protocol-line tag is extension-agnostic. Do not look for tags such as `stable-webview-1-0`; runtime compatibility is still enforced by the daemon handshake and extension ABI checks.

## First Flow

1. Import the top-level SDK from `opentray`.
2. Create or resolve a space.
3. Create a tray on that space.
4. Set title, tooltip, icon, and menu through the public SDK.

Typical consumer entrypoint:

```ts
import { createSpace } from "opentray";

const space = await createSpace({
  id: "com.example.app",
  default: true,
});

await space.createTray({
  trayId: "status",
  title: "OpenTray",
});
```

Use the lower-level transport APIs only for custom protocol work.

For a ready-made example:

```bash
pnpm --filter opentray example:basic
```

This is still useful for learning the request/response flow, but the public consumer path should start from top-level `opentray` exports.

## Real Native Smoke

For a real tray created through the public SDK and local broker:

```bash
opentray smoke daemon-tray
```

This is the consumer-facing smoke path.
