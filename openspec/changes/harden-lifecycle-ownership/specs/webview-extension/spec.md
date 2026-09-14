# webview-extension delta

## ADDED Requirements

### Requirement: Session-scoped destroy SHALL validate the full owner tuple

Every destroy-style path in the native webview extension — `session_closed`, `destroy_window_session`, `destroy_child_webview`, and the window registry's `destroy_window`/`remove` APIs, on both macOS and Windows — SHALL carry and validate the full owner tuple `(appId, trayId, sessionId, windowId)` before removing any native session, window, or registered view. A destroy addressing an owner tuple other than the tuple currently resident under that tray id SHALL remove at most its own registry bookkeeping and SHALL NOT touch the resident session, its window, its webviews, its channels, or its popups.

The transitional unattributed-entry rule SHALL follow the same law: an unattributed registry entry SHALL only be swept when the closing session is the one that could have owned it, and never as collateral of an attributed live session.

The extension SHALL expose an internal seam test hook (or equivalent test construction) that proves the reentrancy shape: collect a closing session's registry entries, insert a new same-tray session, then run the destroy and assert the new session survives with its webviews, channels, and popups intact.

#### Scenario: Late cleanup cannot destroy a newer same-tray session

- **GIVEN** a closing session's cleanup has collected its registry entries for tray T
- **WHEN** a new session for the same app and tray T has already become resident before the destroy step runs
- **THEN** the destroy removes only the closing session's registry bookkeeping
- **AND** the resident session's window, webviews, and channels are untouched.

#### Scenario: Destroy APIs are owner-tuple typed

- **GIVEN** an engineer extends the extension with a new destroy-style path
- **WHEN** the registry destroy/remove API signatures are consulted
- **THEN** a bare tray-id-only destroy is not expressible without supplying the owner tuple
- **AND** the platform twins (macOS and Windows) enforce the same contract.

## ADDED Requirements

### Requirement: Child webview creation SHALL re-assert window ordering and activation

The session-bootstrap ordering and activation run before any child exists (an empty windowOnly shell); WebKit never re-evaluates new children's visibility against that stale state, so their pages can stay suspended until an app activation. After a child webview is attached and the effective layout is solved, the extension SHALL re-assert `makeKeyAndOrderFront`/`orderFrontRegardless` and application activation so the newly framed views get their visibility evaluated.

#### Scenario: Content page executes immediately after bootstrap

- **GIVEN** a windowOnly session whose content webview was just created and laid out
- **WHEN** the page finishes loading without any Dock interaction
- **THEN** its scripts run and navigation commands take effect immediately.
