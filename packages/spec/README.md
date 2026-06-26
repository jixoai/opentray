# @opentray/spec

Shared TypeScript protocol and contract package for OpenTray.

## Role

- Define newline-delimited JSON protocol payload shapes.
- Define protocol version and endpoint identity helpers.
- Define public `App`, `Tray`, `Session`, icon projection, menu, tooltip, and extension contract types.
- Keep protocol types reusable by `opentray` and official extensions.

This package is platform-neutral and must not import native implementation packages.

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
};

const tray: TrayOptions = {
  id: "com.example.status",
  icon,
};
```

`Space`, `Surface`, `spaceId`, `create-space`, and top-level tray `title` are removed public vocabulary for v0.9.
