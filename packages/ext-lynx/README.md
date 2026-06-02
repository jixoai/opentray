# @opentray/ext-lynx

Official macOS-first Lynx window extension for OpenTray.

## Role

- Launch a real Lynx Explorer runtime from the generic OpenTray extension host path.
- Keep Lynx bundle loading, runtime extraction, and process lifecycle inside the extension artifact.
- Treat `.lynx.bundle` files as client-owned payloads scoped to the owning `spaceId` / `trayId`.

This package is an extension atom. It must not become the owner of core tray lifecycle or daemon policy.

The facade stays platform-neutral. Native libraries are optional platform packages named `@opentray/ext-lynx-<os>-<arch>`, and the daemon resolves them through the dynamic extension discovery law when `load-ext` requests `@opentray/ext-lynx`.

The macOS native dylib owns the Lynx command protocol and the runtime sidecar contract. `opentray` forwards scoped extension traffic to it, but does not keep a daemon-side Lynx parser or a daemon-owned Lynx runtime.

## Command Surface

First-stage public commands:

- `show({ bundlePath })`
- `hide()`

First-stage runtime events:

- `shown`
- `hidden`

`show` expects a real `.lynx.bundle` file path. On macOS, the native extension extracts `LynxExplorer.app.zip`, stages the external bundle into the runtime resources, and launches:

```text
file://lynx?local://opentray-external/main.lynx.bundle
```

## Example

Run the facade-only protocol example:

```bash
pnpm --filter @opentray/ext-lynx example:lynx
```

Use the installed CLI smoke when you want a real native window:

```bash
pnpm --filter opentray cli -- smoke daemon-lynx --bundle ./research/lynx/app/dist/main.lynx.bundle
```

## Runtime Sidecar

The darwin platform package ships two artifacts:

- `lib/libopentray_ext_lynx.dylib`
- `runtime/LynxExplorer.app.zip`

The native extension resolves the runtime zip next to the loaded dylib by default. For local debugging, you may override the sidecar path with `OPENTRAY_LYNX_RUNTIME_ZIP=/absolute/path/to/LynxExplorer.app.zip`.

Current first-stage native support:

- macOS arm64 and x64: real runtime extraction and external bundle launch
- Linux / Windows: not published yet; OpenTray should fail explicitly instead of pretending support exists
