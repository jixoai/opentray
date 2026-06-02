# Getting Started

Use this reference when the user asks how to install OpenTray or create a first tray.

## Install

```bash
pnpm add opentray
```

`opentray` resolves the current platform daemon package through optional dependencies. The user installs the top-level package; they do not import platform binary packages directly.

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
