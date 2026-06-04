## ADDED Requirements

### Requirement: Webview window session architecture SHALL stay extension-owned

The WebView extension SHALL own a tray-scoped window session law inside the extension atom itself. `opentray-core` and `opentray-bin` SHALL continue to forward generic extension traffic and SHALL NOT become the place where repeated `show`, `hide`, destroy, or content-replacement semantics are interpreted.

The WebView session law SHALL remain distinct from the Lynx runtime law. The Lynx extension MAY replace a short-lived child process on repeated `show`, but the WebView extension SHALL treat page runtime continuity as a first-class concern and SHALL define its own explicit session semantics instead of inheriting the Lynx behavior by analogy.

#### Scenario: Architecture law stays visible

- **GIVEN** the WebView extension needs to distinguish visibility, session destruction, and content replacement
- **WHEN** the lifecycle contract is implemented
- **THEN** that distinction is owned by `@opentray/ext-webview` and `crates/opentray-ext-webview`
- **AND** the kernel and daemon do not grow WebView-specific lifecycle branches.

### Requirement: Webview window session data shape SHALL separate session, shell, and page runtime

The WebView extension SHALL preserve three durable state domains instead of collapsing them into one ambiguous “window” concept:

- `WindowSessionIdentity`: tray scope, bootstrap-immutable capability settings, and current content descriptor
- `WindowShellState`: visibility, size, position, title, icon, and native style
- `PageRuntimeState`: the live JS/DOM context, including transient UI state such as scroll, form input, and in-page caches

`hide()` SHALL affect `WindowShellState` visibility only. Explicit content replacement SHALL replace `PageRuntimeState` and update the current content descriptor. Explicit destroy SHALL invalidate the whole session.

#### Scenario: Data law stays visible

- **GIVEN** a WebView session has live page state
- **WHEN** the host hides and later re-shows the same tray window
- **THEN** only shell visibility changes
- **AND** the page runtime state remains intact.

### Requirement: Webview content replacement SHALL be explicit

The WebView extension SHALL NOT treat repeated `show(...)` as an implicit page reload path for an already-active compatible session. `show(...)` is the visibility and session-bootstrap verb. Content replacement SHALL use an explicit command surface.

The public command family SHALL include an explicit content-replacement command that can replace either host HTML or URL content. `navigate(url)` MAY remain as a URL-focused alias, but it SHALL be semantically equivalent to an explicit content replacement request rather than a second hidden lifecycle path.

If a caller sends `show(...)` against an existing compatible session and also supplies content that would differ from the active content descriptor, the extension SHALL reject that request explicitly and direct the caller toward the content-replacement or destroy path. It SHALL NOT silently reload the page runtime behind a visibility verb.

#### Scenario: Re-show preserves page runtime

- **GIVEN** a tray already has a compatible hidden WebView session with local HTML content
- **WHEN** the host calls `show(...)` again for that tray
- **THEN** the extension makes the existing window visible
- **AND** it preserves the existing page runtime instead of reloading the HTML.

#### Scenario: Show rejects implicit content replacement

- **GIVEN** a tray already has an active WebView session
- **WHEN** the host calls `show(...)` with a different HTML payload or URL for that same session
- **THEN** the extension rejects the request with an explicit typed error
- **AND** it tells the caller to use the content-replacement or destroy path instead of silently reloading.

## MODIFIED Requirements

### Requirement: Webview lifecycle SHALL be scoped to surface tray and lease

The webview extension SHALL associate each window session with a surface/tray scope and the owning lease. A tray scope SHALL own at most one active WebView window session per extension instance. Lease cleanup SHALL hide or destroy webview state owned by the disconnected client without affecting webview state owned by other leases.

`hide` SHALL make the tray-scoped window session invisible without destroying its page runtime. Re-showing the same tray with a compatible session SHALL reuse that session instead of replacing it. Explicit destroy, lease cleanup, or extension deinitialization SHALL destroy the owned session and its page runtime cleanly.

Compatibility SHALL be defined by the bootstrap-immutable portion of the session contract, not by mutable shell state. Size, position, title, icon, and supported live style fields MAY update on a reused session. Bootstrap-level navigator injection, global binding, source-policy, sync-policy, and equivalent page-bridge settings SHALL NOT be silently changed under an existing page runtime.

#### Scenario: Re-show preserves the existing tray session

- **GIVEN** a client has already shown a WebView window for its tray
- **AND** that window has been hidden instead of destroyed
- **WHEN** the same tray receives another compatible `show`
- **THEN** the extension reuses the existing tray session
- **AND** the page runtime remains available instead of being replaced.

#### Scenario: Destroy removes the owned tray session

- **GIVEN** a tray has an active WebView session
- **WHEN** the client sends the explicit destroy command
- **THEN** the extension destroys the native slot and page runtime for that tray
- **AND** a subsequent `show(...)` creates a new session from scratch.

#### Scenario: Lease cleanup closes owned popup

- **GIVEN** a client shows a webview popup for its tray
- **WHEN** that client disconnects
- **THEN** the kernel closes or invalidates the webview session owned by that lease
- **AND** other clients' webview sessions remain unaffected.

### Requirement: Webview facade SHALL be typed and platform-neutral

The TypeScript `@opentray/ext-webview` facade SHALL depend only on `opentray` public contracts and `@opentray/spec` types. It MUST NOT import platform binary packages, Rust backend implementation details, or private kernel protocol internals.

The facade SHALL remain a platform-neutral contract layer even after the native runtime moves fully into `@opentray/ext-webview-<os>-<arch>` dynamic libraries. It SHALL not rely on daemon-side WebView parsers or hidden daemon-owned WebView runtime behavior.

The public host-side contract SHALL expose separate typed verbs for visibility/session bootstrap, explicit hide, explicit content replacement, explicit destroy, script evaluation, and postMessage delivery. The facade SHALL NOT force callers to overload repeated `show(...)` as the only way to replace content or reset a page runtime.

#### Scenario: Webview package stays platform neutral

- **GIVEN** `@opentray/ext-webview` is installed in a project
- **WHEN** its public exports are inspected
- **THEN** they expose typed webview commands and events
- **AND** they do not require importing any `@opentray/<platform>` binary package directly.

#### Scenario: Host facade exposes explicit lifecycle verbs

- **GIVEN** a tray handle has the WebView facade attached
- **WHEN** a developer inspects the host-side API
- **THEN** visibility, destroy, and content replacement are exposed as separate typed operations
- **AND** the developer does not need to encode page replacement through repeated `show(...)`.

### Requirement: WebView platform dylib SHALL own the public WebView protocol end-to-end

The official WebView native library SHALL parse `show`, `hide`, explicit destroy, explicit content replacement, `navigate`, `evaluate`, and `postMessage` commands itself and SHALL emit the resulting scoped extension events itself. `opentray` SHALL forward these commands through the generic extension host law and SHALL NOT keep a daemon-side shadow parser or shadow event builder for WebView payloads.

The same dylib SHALL also decide session-compatibility checks and the rejection path for implicit reload attempts on existing sessions. `opentray` SHALL NOT keep a daemon-side shadow implementation for those session semantics.

#### Scenario: The platform library owns WebView lifecycle parsing

- **GIVEN** the `@opentray/ext-webview` facade sends a lifecycle-shaped `ext-command`
- **WHEN** the daemon dispatches that command to the platform library
- **THEN** the platform library validates and interprets the WebView lifecycle payload
- **AND** the daemon does not keep a second implementation of the same session law outside the extension artifact.
