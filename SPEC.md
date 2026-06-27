# OpenTray Specification

> Canonical requirements live under `openspec/specs/**`. This root file is a short durable summary of the current tray-first model.

**Goal:** Build a cross-platform Desktop Status Platform that lets Node/Deno/Bun applications publish lightweight tray status with one install.

**Current model:**

- `App` is the caller-owned runtime identity and isolation boundary.
- `Tray` is one desktop status atom owned by that app/runtime.
- `Session` is the live source of authority for tray events and mutations.
- `Extension` is an optional native capability atom scoped to the app and tray.

**Public law:**

- Call `createTray()` directly.
- The default runtime starts the local broker on demand.
- `runVisibleRuntimeHost()` stays available only as an explicit diagnostic path.
- Public docs and SDK APIs do not use `Space`, `Surface`, `createSpace()`, `createSurface()`, or `resolveDefaultSpace()`.

**Where to read more:**

- `README.md` for consumer-facing quickstart and package guidance.
- `openspec/specs/client-sdk/spec.md` for the public TypeScript contract.
- `openspec/specs/runtime-host/spec.md` for runtime host diagnostics.
- `openspec/specs/example-matrix/spec.md` for example coverage rules.
