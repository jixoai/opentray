## ADDED Requirements

### Requirement: Extension host SHALL separate extension identity from mount identity

The generic `load-ext` request SHALL support an optional `mountId`. The extension `name` and `path` SHALL continue to identify the package/native library to resolve. The `mountId`, when present, SHALL identify the registered command endpoint for that loaded instance.

The extension host registry SHALL dispatch `ext-command.ext` to the mounted instance id. If `mountId` is absent, the host SHALL preserve the previous behavior and register the instance under `name`.

#### Scenario: Same extension package mounts twice inside one space

- **GIVEN** a client loads `name: "webview"` with `mountId: "webview.tray-a"`
- **AND** the same client loads `name: "webview"` with `mountId: "webview.tray-b"`
- **WHEN** commands are sent to each mount id
- **THEN** they dispatch to separate extension instances
- **AND** dynamic library discovery still uses `name: "webview"` rather than either mount id.

#### Scenario: Legacy load without mount id keeps old command endpoint

- **GIVEN** a client sends `load-ext` with `name: "webview"` and no `mountId`
- **WHEN** it sends `ext-command` with `ext: "webview"`
- **THEN** the command dispatches to the loaded instance under the legacy endpoint.
