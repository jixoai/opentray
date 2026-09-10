## MODIFIED Requirements

### Requirement: Webview lifecycle SHALL be scoped to surface tray and lease

The webview extension SHALL associate each window session with a surface/tray scope and the owning lease. A tray scope SHALL own at most one active WebView window session per extension instance. A window session SHALL host one or more webview instances as sibling native views inside the window, addressed by webview id; the session SHALL remain valid as webviews are created and destroyed within it. Lease cleanup SHALL hide or destroy all webview state owned by the disconnected client without affecting webview state owned by other leases.

`hide` SHALL make the tray-scoped window session invisible without destroying its page runtimes. Re-showing the same tray with a compatible session SHALL reuse that session instead of replacing it. Explicit destroy, lease cleanup, or extension deinitialization SHALL destroy the owned session together with every webview instance it hosts and their page runtimes cleanly.

Compatibility SHALL be defined by the bootstrap-immutable portion of the session contract, not by mutable shell state. Size, position, title, icon, and supported live style fields MAY update on a reused session. Bootstrap-level navigator injection, global binding, source-policy, sync-policy, and equivalent page-bridge settings SHALL NOT be silently changed under an existing page runtime.

#### Scenario: Re-show preserves the existing tray session

- **GIVEN** a client has already shown a WebView window for its tray
- **AND** that window has been hidden instead of destroyed
- **WHEN** the same tray receives another compatible `show`
- **THEN** the extension reuses the existing session
- **AND** the page runtimes remain available instead of being replaced.

#### Scenario: Destroy removes the owned tray session

- **GIVEN** a tray has an active WebView session
- **WHEN** the client sends the explicit destroy command
- **THEN** the extension destroys the native slot and every hosted webview's page runtime for that tray
- **AND** a subsequent `show(...)` creates a new session from scratch.

#### Scenario: Lease cleanup closes owned popup

- **GIVEN** a client shows a webview popup for its tray
- **WHEN** that client disconnects
- **THEN** the kernel closes or invalidates the webview session owned by that lease
- **AND** other clients' webview sessions remain unaffected.

## ADDED Requirements

### Requirement: A window session SHALL orchestrate multiple webviews as sibling native views

The webview facade SHALL expose `createWebview` (parent window session, unique webview id, url or html content), `destroyWebview`, and `listWebviews` on the window handle. A webview created inside a window SHALL be a sibling native child view (macOS: NSView subview; Windows: child HWND) — never a separate OS window. Webview ids SHALL be unique within their window session. The page bridge SHALL expose the owning webview's id as a read-only property. In the v1 scope this orchestration SHALL apply to framed windows; requesting multi-webview composition on frameless or material-styled windows SHALL fail with a typed unsupported error instead of undefined behavior. Opaque stacking of webviews across layers SHALL be supported; translucent compositing between two webviews SHALL be rejected as unsupported in v1.

#### Scenario: Two webviews compose one window

- **GIVEN** a framed webview window session
- **WHEN** the caller creates webviews `toolbar` and `content` and applies a two-row layout
- **THEN** both SHALL render as sibling views inside the same OS window
- **AND** destroying `toolbar` SHALL leave `content` and its page runtime alive in the same session

#### Scenario: Frameless multi-webview is a typed rejection

- **GIVEN** a frameless or material-styled window
- **WHEN** the caller creates a second webview inside it
- **THEN** the extension SHALL reject with a typed capability error
- **AND** the existing single-webview behavior SHALL remain unchanged

#### Scenario: The page bridge knows its own webview id

- **GIVEN** a webview whose page bridge is enabled by page-access policy
- **WHEN** page code reads the webview id property
- **THEN** it SHALL observe the same opaque id the host facade uses to address this webview

### Requirement: Webview navigation SHALL be per-view with push URL and title events

Each webview SHALL expose `navigate` (explicit content replacement for that webview only, consistent with the content-replacement law), plus `back` and `forward` over the webview's native session history. URL and title changes SHALL be delivered to the host facade as push events (`urlChange`, `titleChange`) sourced from native page-load callbacks; the extension SHALL NOT introduce polling loops for these events.

#### Scenario: navigate retargets one webview without touching siblings

- **GIVEN** webviews `toolbar` and `content` in one window
- **WHEN** the host calls `navigate(content, "https://example.org")`
- **THEN** only `content` SHALL load the new address
- **AND** `toolbar` SHALL keep its page runtime and position

#### Scenario: urlChange reports in-page navigation truth

- **GIVEN** webview `content` showing a page that links internally
- **WHEN** the operator activates an in-page link
- **THEN** the host SHALL receive one `urlChange` push event carrying the page's actual new URL
- **AND** no polling mechanism SHALL be required to observe it
