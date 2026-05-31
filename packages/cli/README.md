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
