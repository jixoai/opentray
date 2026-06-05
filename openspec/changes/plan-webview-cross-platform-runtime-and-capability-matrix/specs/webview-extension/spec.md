## ADDED Requirements

### Requirement: Webview capability truth SHALL distinguish runtime absence, family mismatch, declarative gate, and context unavailability

The WebView extension SHALL keep four different support meanings distinct across runtime behavior, official docs, and skills:

- runtime absence: the current platform package or runtime cannot provide a visible WebView capability on this host
- family mismatch: a caller requested a platform-specific family on the wrong substrate
- declarative gate: the runtime could provide the capability, but the current WebView session did not enable it
- context unavailability: the capability exists, but the current session has no authoritative data for this request

The extension SHALL NOT collapse these meanings into one vague `unsupported` story in public guidance. Runtime absence and family mismatch MAY reject with typed unsupported errors. Declarative gate failures MAY reject with typed unsupported or rejected errors, but they SHALL remain distinguishable from runtime absence in message text and docs. Context unavailability SHALL prefer a structured availability result when the capability family already defines one.

#### Scenario: Runtime absence stays separate from family mismatch

- **GIVEN** a Windows or Linux runtime path has not yet landed a visible WebView implementation
- **WHEN** the caller asks the extension to show a WebView window
- **THEN** the extension returns a typed runtime-absence unsupported error
- **AND** that result is documented differently from requesting `platform.windows.*` on the macOS runtime.

#### Scenario: Declarative gate stays separate from runtime absence

- **GIVEN** a WebView session did not enable overlay support
- **WHEN** page code calls `navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- **THEN** the extension reports that overlay is not enabled for this WebView
- **AND** it does not claim that the whole platform lacks overlay capability.

#### Scenario: Context unavailability stays a structured availability result

- **GIVEN** a page calls `navigator.opentray.tray.getBounds()`
- **AND** the current WebView session has no authoritative tray anchor data
- **WHEN** the extension resolves the request
- **THEN** the result uses the tray availability shape such as `kind`, `source`, and `rect`
- **AND** it does not collapse the request into a generic unsupported error.

### Requirement: Webview official guidance SHALL publish maturity truth together with capability truth

The official `@opentray/ext-webview` README, published CLI README, platform package READMEs, and repo skills SHALL describe capability maturity and platform truth together. When a capability is stable only on macOS while Windows and Linux currently expose contract or package-topology-only paths, the guidance SHALL say so directly.

This maturity guidance SHALL use the same public vocabulary as the runtime and spec surface. It SHALL avoid implying that a published platform package automatically means a stable visible runtime on that platform.

#### Scenario: Guidance teaches macOS stability without overstating other platforms

- **GIVEN** a developer reads the official WebView docs and skills
- **WHEN** they inspect platform support for glass windows, overlay, screen details, or tray panels
- **THEN** the guidance states that macOS is the current human-visual acceptance path
- **AND** it states that Windows and Linux remain alpha or package-topology-only until their native runtime atoms land
- **AND** it does not imply that those platforms already have stable visible UI behavior.

## MODIFIED Requirements

### Requirement: WebView unsupported capability SHALL be explicit

If a platform package exists but the native WebView runtime cannot create a visible window on that host, the extension SHALL return a structured unsupported or capability error. It SHALL NOT report success for a fake invisible WebView.

Unsupported truth SHALL remain classified rather than vague. Runtime absence, platform-family mismatch, and declarative gate failures SHALL remain distinguishable in runtime behavior and official guidance. When the capability family already defines an availability result shape, missing authoritative session data SHALL be reported through that availability result rather than by pretending the whole capability is unsupported.

#### Scenario: Unsupported native WebView does not fake success

- **GIVEN** a platform lacks the required native WebView capability at runtime
- **WHEN** the client sends `show`
- **THEN** the WebView extension returns a typed unsupported/capability error
- **AND** the demo prints that failure as acceptance evidence rather than pretending the window appeared.

#### Scenario: Wrong platform family does not fake portable support

- **GIVEN** the macOS runtime receives a real `platform.windows` window-style request
- **WHEN** the extension validates that request
- **THEN** it rejects the request as a platform-family mismatch
- **AND** it does not silently treat the Windows family as a portable style field.

#### Scenario: Missing tray anchor does not impersonate runtime failure

- **GIVEN** a tray-scoped WebView page requests tray bounds
- **AND** the session currently has no authoritative tray anchor data
- **WHEN** the extension resolves the request
- **THEN** it returns the tray availability result with an unavailable kind/source
- **AND** it does not claim that tray bounds are unsupported on the whole runtime.
