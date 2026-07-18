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
