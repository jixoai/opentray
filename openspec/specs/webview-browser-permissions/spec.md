# webview-browser-permissions Specification

## Purpose
TBD - created by archiving change darwin-runtime-carrier-and-webview-permissions. Update Purpose after archive.
## Requirements
### Requirement: WebView browser permissions SHALL be a separate capability family

The WebView extension SHALL define browser/device permission policy separately from `nativeApiPolicy`. `nativeApiPolicy` SHALL continue to govern OpenTray-injected page APIs such as `navigator.window`, `navigator.screen`, tray APIs, globals, and sync controls. Browser permission policy SHALL govern WebView engine permission requests such as camera, microphone, geolocation, notifications, clipboard read, autoplay, local fonts, sensors, MIDI system exclusive, file read/write, multiple downloads, and window management.

The browser permission family set SHALL be typed. Platform gaps SHALL be reported as typed unsupported capability or typed unsupported decision results; unsupported permission families SHALL NOT be faked as successful grants.

#### Scenario: Browser permission policy does not overload native API policy

- **GIVEN** a WebView is shown with `nativeApiPolicy` allowing `navigator.window`
- **WHEN** the page requests camera permission
- **THEN** the camera request is evaluated by browser permission policy
- **AND** it is not allowed merely because `nativeApiPolicy` allowed page-native APIs.

#### Scenario: Unsupported families remain explicit

- **GIVEN** a platform WebView backend cannot control a declared permission family
- **WHEN** the page requests that permission
- **THEN** the extension returns a typed unsupported result or equivalent backend unsupported decision
- **AND** it does not report a grant that the substrate cannot enforce.

### Requirement: WebView permission decisions SHALL conserve to app session source and policy

Every browser permission decision SHALL be traceable to app identity, WebView window permission session, source classification, exact origin when remote, permission family, permission-management state, and prompt-confirmation policy. Silent authorization SHALL only occur when an explicit policy and source match allow it.

Local host HTML, `file:`, `data:`, `about:`, and loopback HTTP(S) sources MAY participate in local permission policy. Remote sources SHALL NOT inherit native trust from the app bundle and MUST match an exact allowed origin before participating in permission decisions.

#### Scenario: Local declared family can be allowed without remote trust

- **GIVEN** host HTML declares camera permission policy
- **AND** the policy allows local camera use without prompt
- **WHEN** the local page requests camera
- **THEN** the decision may be `allow`
- **AND** the decision records the app identity, WebView session, local source, and camera family.

#### Scenario: Remote origin requires exact allowlist

- **GIVEN** a remote page from `https://example.com` requests microphone
- **WHEN** no exact permission policy entry exists for `https://example.com`
- **THEN** the extension does not grant microphone permission
- **AND** the page does not receive native trust because OpenTray is a native app.

### Requirement: Permission management and prompt confirmation SHALL be independent switch sets

The WebView extension SHALL separate permission-management capability from prompt-confirmation behavior. Permission-management capability SHALL control whether `opentrayPermissions` or equivalent backend SDK primitives can read and mutate permission facts. Prompt-confirmation policy SHALL control whether a native authorization dialog is shown and which dialog decisions are available.

Both switch sets SHALL be fine-grained by source and permission family. Enabling one SHALL NOT imply enabling the other.

#### Scenario: Permission manager injection does not imply prompt

- **GIVEN** local host HTML has `opentrayPermissions` enabled for camera management
- **WHEN** camera permission is requested
- **THEN** the prompt-confirmation policy independently decides whether to allow silently, deny, or show a native dialog
- **AND** the presence of `opentrayPermissions` does not by itself grant the request.

#### Scenario: Prompt can run without management object injection

- **GIVEN** an exact-allowlisted remote origin is configured with prompt confirmation for geolocation
- **AND** `opentrayPermissions` injection is disabled for that origin
- **WHEN** the remote page requests geolocation
- **THEN** the native prompt may appear
- **AND** the remote page still does not receive the permission-management object.

### Requirement: Native authorization dialogs SHALL support allow deny and allow-once

When prompt-confirmation policy requests user confirmation, the WebView extension SHALL present a native-window authorization dialog with at least allow, deny, and allow-once choices when the backend can support prompting. The allow-once result SHALL be scoped to the WebView window permission session by default and SHALL NOT create a durable grant in the app-scoped permission database.

#### Scenario: Allow-once is WebView-session scoped

- **GIVEN** a WebView window session receives an allow-once decision for camera
- **WHEN** the same WebView window permission session requests camera again
- **THEN** the session grant may be reused
- **AND** a different WebView window session does not inherit that allow-once grant.

#### Scenario: Durable store is not mutated by allow-once

- **GIVEN** a native prompt returns allow-once for microphone
- **WHEN** the permission decision is recorded
- **THEN** no durable app-scoped permission fact is written
- **AND** the grant expires with the WebView window permission session.

### Requirement: Remote permission manager injection SHALL be explicitly opted in

The WebView extension SHALL NOT inject `opentrayPermissions` into remote-origin JavaScript by default. Remote origins MAY participate in permission requests only after exact-origin policy allows the relevant permission family, and MAY receive `opentrayPermissions` only after a separate exact-origin injection policy enables it.

#### Scenario: Remote origin can request permission without management object

- **GIVEN** `https://example.com` is exact-allowlisted for prompted camera requests
- **AND** `opentrayPermissions` injection is not enabled for that origin
- **WHEN** the page loads and requests camera
- **THEN** the permission request may reach native prompt policy
- **AND** `navigator.opentrayPermissions` is absent.

#### Scenario: Remote management object requires separate opt-in

- **GIVEN** a remote origin is exact-allowlisted for permission-manager injection
- **WHEN** the page loads
- **THEN** the extension may inject `opentrayPermissions`
- **AND** that injection does not grant any permission family without a matching permission decision.

