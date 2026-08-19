## ADDED Requirements

### Requirement: `skill-creator-v2` SHALL use application mode without keep-on-top

The `skill-creator-v2` tray-host consumer SHALL configure its retained WebView window with:

```ts
style: {
  appMode: true,
  frameless: false,
  keepOnTop: false,
  autoHide: false,
}
```

Its tray `primaryEvent` SHALL use the extension's authoritative `isVisible()` / `toVisible()` / `close()` contract. The consumer SHALL not call `setStyle({ keepOnTop: true })` during reveal and SHALL not maintain a parallel local visibility boolean as the source of truth.

#### Scenario: Tray opens the normal application window

- **GIVEN** `skill-creator-v2` starts with its tray and retained WebView session
- **WHEN** the user activates the tray primary event while the window is hidden
- **THEN** the same application window is shown and focused
- **AND** the platform Shell icon appears
- **AND** the app does not enable keep-on-top.

#### Scenario: Closing the window leaves tray-only access

- **GIVEN** the `skill-creator-v2` app window is visible
- **WHEN** the user closes it through the native window controls
- **THEN** the Shell icon disappears
- **AND** the tray remains available
- **AND** the next primary event reveals the same retained page session.

### Requirement: Consumer documentation SHALL teach app mode as a product intent

The official WebView README, examples, and consumer skill guidance SHALL describe `appMode` as the normal application-versus-tray-tool decision. They SHALL not teach `showInSwitchers` as a public field or recommend `keepOnTop` as the default workaround for application discoverability. Examples SHALL retain the established dynamic `primaryEvent` label and `visibleChange` synchronization.

#### Scenario: Documentation uses the new public vocabulary

- **GIVEN** a developer reads the WebView window style guidance
- **WHEN** they choose a normal application window
- **THEN** the guidance uses `style.appMode: true`
- **AND** it explains that `keepOnTop` is independent.

#### Scenario: Example labels follow authoritative visibility

- **GIVEN** a runnable example owns a retained app-mode WebView
- **WHEN** the native window is closed or revealed outside the tray handler
- **THEN** its `visibleChange` listener updates the tray primary label
- **AND** the example does not drift from native state.
