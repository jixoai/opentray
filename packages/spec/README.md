# @opentray/spec

Shared TypeScript protocol and contract package for OpenTray.

## Role

- Define JSON-RPC payload shapes.
- Define broker protocol version and endpoint identity helpers.
- Define public `Space`, `Tray`, `Session`, and extension contract types.
- Keep protocol types reusable by the `opentray` package and official extensions.

This package must stay platform-neutral and must not import native implementation packages.

## Example

Run a protocol parser example that shows successful server-frame parsing and malformed-frame rejection:

```bash
pnpm --filter @opentray/spec example:parse
```

Endpoint identity is version-scoped during the current unstable broker stage:

```ts
import { createBrokerEndpointIdentity, formatUnixSocketPath } from "@opentray/spec";

const identity = createBrokerEndpointIdentity({ packageVersion: "0.1.0" });
console.log(formatUnixSocketPath("~", identity));
// ~/.opentray/0.1.0/opentray-p1.sock
```
