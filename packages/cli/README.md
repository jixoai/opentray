# opentray

Developer-facing OpenTray package.

This is the package users install directly:

```bash
pnpm add opentray
```

## Role

- Resolve or auto-start the OpenTray broker.
- Expose `createSurface()`, `defaultSurface`, and `createTray()`.
- Route extension packages through public OpenTray contracts.
- Resolve per-platform optional binary packages.

`packages/cli` is the only unscoped npm package in this monorepo.

## Example

Run a protocol-only example that creates a surface, creates a tray, dispatches an extension command, and prints each client frame:

```bash
pnpm --filter opentray example:basic
```

Run the human-visible daemon tray example:

```bash
pnpm --filter opentray example:daemon-tray
```

This example starts or reuses the same-version daemon automatically, creates a real tray through the public SDK, and prints broker-routed menu events. Use manual lifecycle commands only for operator/debug control:

```bash
pnpm --filter opentray cli -- daemon start
pnpm --filter opentray cli -- daemon stop
pnpm --filter opentray cli -- daemon restart
```

The menu includes `WebView Commands` entries that call the `@opentray/ext-webview` facade and print broker extension traffic through a preview recorder. Use `cargo run --example visual_webview` when you need to visually inspect a real native WebView window.

The daemon exits automatically after 30 seconds with no connected clients. Set `OPENTRAY_DAEMON_IDLE_TIMEOUT_MS=0` to keep it alive during debugging, or provide another millisecond value for a custom idle release window.

Current native icon support is `rgba`. `encoded` and `file` are typed protocol shapes, but the native `tray-icon` backend reports them as unsupported until decoding and file loading policy are implemented.
