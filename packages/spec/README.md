# @opentray/spec

Shared TypeScript protocol and contract package for OpenTray.

## Role

- Define JSON-RPC payload shapes.
- Define public `Surface`, `Tray`, `Lease`, and extension contract types.
- Keep protocol types reusable by the `opentray` package and official extensions.

This package must stay platform-neutral and must not import native implementation packages.

## Example

Run a protocol parser example that shows successful server-frame parsing and malformed-frame rejection:

```bash
pnpm --filter @opentray/spec example:parse
```
