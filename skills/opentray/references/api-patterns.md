# API Patterns

Use this reference when the user asks how to write code with OpenTray.

## Main Public Pieces

- `createClient()`: build a client over a transport.
- `createSpace()`: get a broker-owned space.
- `createTray()`: mount a client-owned tray onto that space.
- `TrayHandle.commandExtension()`: send extension traffic through the public contract.

## Typical Shape

```ts
const connection = await connectLocalBroker();
const client = createClient(connection);

const space = await client.createSpace({
  id: "com.example.app",
  title: "Example",
  default: true,
});

const tray = await space.createTray({
  trayId: "status",
  title: "OpenTray",
  menu: { items: [{ type: "item", id: 1, title: "Open" }] },
});
```

## Extension Shape

Official extensions should attach through the tray handle, not by reaching into private broker details. `@opentray/ext-webview` is the current reference example.
