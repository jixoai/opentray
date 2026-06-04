## ADDED Requirements

### Requirement: Webview SHALL project tray bounds into navigator.opentray.tray

The WebView extension SHALL expose tray bounds to page JavaScript through `navigator.opentray.tray.getBounds()` when the shown page is allowed to use the tray capability family. This API SHALL be the page projection of the same tray-owned capability used by trusted backend callers. It SHALL not rename the measured object as `host` or `space`, because the physical anchor being queried is the current tray contribution.

The page bridge SHALL keep tray bounds under the OpenTray-prefixed navigator root because the web platform has no standard tray object. The extension SHALL NOT add a second unprefixed `navigator.tray` surface in this change.

#### Scenario: Page reads tray bounds from OpenTray tray namespace

- **GIVEN** a WebView is shown with tray capability enabled for the current page source
- **WHEN** the page calls `await navigator.opentray.tray.getBounds()`
- **THEN** the extension resolves the current tray's bounds in the shared `Rect` shape
- **AND** the API does not require page code to know broker request details.

#### Scenario: Tray namespace names the measured atom

- **GIVEN** the page bridge exposes tray geometry
- **WHEN** a developer inspects the navigator surface
- **THEN** the capability lives under `navigator.opentray.tray`
- **AND** it is not exposed as `navigator.opentrayHost` or `navigator.opentraySpace`.

### Requirement: Webview tray capability SHALL follow declarative source policy

Tray-bounds projection into the page SHALL follow the same declarative capability-policy mindset as window and screen projection. The WebView `show(...)` contract SHALL be able to gate tray capability independently from window and screen capability. Remote content SHALL NOT receive tray bounds by accident.

The page bridge MAY use a dedicated tray capability family such as `tray` in the existing policy structure. The tray capability SHALL not be implicitly granted merely because `nativeWindowApi` or `nativeScreenApi` is enabled.

#### Scenario: Remote page does not receive tray bounds by accident

- **GIVEN** a WebView is shown with remote URL content
- **AND** no tray capability policy explicitly allows that source
- **WHEN** the page loads
- **THEN** `navigator.opentray.tray` is absent or denies tray-bounds access
- **AND** the extension does not widen the page bridge accidentally.

#### Scenario: Tray capability can diverge from window and screen

- **GIVEN** a WebView is shown with a declarative native capability policy
- **WHEN** the policy allows tray capability for the current source but denies screen capability
- **THEN** the page may call `navigator.opentray.tray.getBounds()`
- **AND** it still does not receive `navigator.screen`.
