## ADDED Requirements

### Requirement: TrayHandle SHALL support typed extension mounting

The public SDK SHALL expose a generic `TrayHandle.extend(extension, options)` capability. The base SDK SHALL understand only the generic extension mount contract; it SHALL NOT import or branch on concrete extension packages such as WebView or Lynx.

`extend(...)` SHALL return the original tray handle intersected with the mounted extension capability so TypeScript users only see extension-specific methods after mounting that extension.

#### Scenario: Mounted capability appears on the returned tray handle

- **GIVEN** a tray extension atom declares a typed capability
- **WHEN** a developer calls `tray.extend(extension, options)`
- **THEN** the returned value exposes the extension capability methods
- **AND** an unextended tray handle does not need to know those methods.

### Requirement: TrayHandle SHALL expose generic extension loading for extension atoms

The public SDK SHALL expose `TrayHandle.loadExtension({ name, path, mountId })` for extension atoms and advanced callers. This method SHALL send the existing `load-ext` request family and SHALL include `mountId` when provided.

The SDK SHALL keep `commandExtension(ext, data)` available as the generic command dispatch path. Extension facades MAY use it through their mount context, but ordinary WebView docs SHOULD prefer typed extension capabilities.

#### Scenario: Extension mount loads once then commands through mount id

- **GIVEN** a mounted extension has `name: "webview"` and `mountId: "webview.tray-a"`
- **WHEN** the extension sends its first command
- **THEN** the SDK first sends `load-ext` with `name: "webview"` and `mountId: "webview.tray-a"`
- **AND** it sends `ext-command` with `ext: "webview.tray-a"`.
