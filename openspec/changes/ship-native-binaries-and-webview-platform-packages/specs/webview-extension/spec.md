## ADDED Requirements

### Requirement: WebView native runtime SHALL ship as platform dynamic libraries

The official WebView native runtime SHALL be distributed through `@opentray/ext-webview-<os>-<arch>` platform packages. `@opentray/ext-webview` SHALL remain a platform-neutral TypeScript facade and SHALL NOT include all platform libraries in one package.

The platform packages SHALL contain the native dynamic library artifact at a documented package-adjacent path. The facade MAY declare platform packages as optional dependencies only if doing so does not force platform imports into the public facade API.

#### Scenario: WebView facade stays platform-neutral

- **GIVEN** `@opentray/ext-webview` is imported by an application
- **WHEN** its public exports are evaluated
- **THEN** it exposes only typed WebView commands/events over OpenTray public contracts
- **AND** it does not import `@opentray/ext-webview-<os>-<arch>` directly from public API code.

#### Scenario: WebView platform library is package-adjacent

- **GIVEN** the current platform WebView package is installed
- **WHEN** the daemon resolves extension `webview`
- **THEN** it can locate the package-adjacent dynamic library path
- **AND** it loads the library through the generic dynamic extension host boundary.

### Requirement: WebView command behavior SHALL remain visually testable after dynamic split

The dynamically loaded WebView extension SHALL support `show`, `hide`, `navigate`, `evaluate`, and `postMessage` commands with the same public facade semantics as the current internal adapter. `show`, `postMessage`, and `evaluate` SHALL remain human-visible in the first-stage demo.

#### Scenario: Dynamic WebView extension preserves visual demo

- **GIVEN** the daemon loaded the WebView dynamic library
- **WHEN** the npm-installed demo sends WebView commands
- **THEN** `Show HTML` opens a native WebView window
- **AND** `Post Message` and `Evaluate JS` visibly update the window
- **AND** terminal logs show extension-host command/event traffic.

### Requirement: WebView unsupported capability SHALL be explicit

If a platform package exists but the native WebView runtime cannot create a visible window on that host, the extension SHALL return a structured unsupported or capability error. It SHALL NOT report success for a fake invisible WebView.

#### Scenario: Unsupported native WebView does not fake success

- **GIVEN** a platform lacks the required native WebView capability at runtime
- **WHEN** the client sends `show`
- **THEN** the WebView extension returns a typed unsupported/capability error
- **AND** the demo prints that failure as acceptance evidence rather than pretending the window appeared.
