## ADDED Requirements

### Requirement: WebView pages SHALL expose a source-gated text clipboard capability

When the WebView bridge is installed, it SHALL expose `navigator.opentray.clipboard` with `readText(): Promise<string>` and `writeText(text: string): Promise<void>` only when the current page source matches `nativeApiPolicy.clipboard`, falling back to `defaultSrc` and its local-only default. The page capability SHALL use the Clipboard API of the WebView client that owns the visible native WebView; it SHALL NOT route clipboard contents through OpenTray Core or the broker. It SHALL preserve browser/platform permission and user-activation enforcement and SHALL propagate browser errors. The host-side `@opentray/ext-clipboard` API remains separate.

#### Scenario: A local page writes the client's system clipboard

- **GIVEN** a local page with the default bridge policy
- **WHEN** it calls `navigator.opentray.clipboard.writeText(text)` from a permitted user gesture
- **THEN** the WebView client's browser Clipboard API receives the text
- **AND** no clipboard payload is sent through the broker protocol.

#### Scenario: A page reads clipboard text

- **GIVEN** a page source allowed by `nativeApiPolicy.clipboard`
- **WHEN** it calls `navigator.opentray.clipboard.readText()` and the browser grants access
- **THEN** the promise resolves with the browser's text result
- **AND** browser permission rejection is propagated without being converted to empty text.

#### Scenario: A disallowed source has no OpenTray clipboard capability

- **GIVEN** a page source that does not match `nativeApiPolicy.clipboard` or its `defaultSrc` fallback
- **WHEN** its document loads
- **THEN** `navigator.opentray.clipboard` is not exposed.

#### Scenario: A browser rejects clipboard access

- **GIVEN** an allowed page without required user activation or browser permission
- **WHEN** it invokes a clipboard operation
- **THEN** the promise rejects with the browser's original rejection (for example `NotAllowedError`).
