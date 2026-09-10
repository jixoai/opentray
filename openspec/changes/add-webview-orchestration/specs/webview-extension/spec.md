## MODIFIED Requirements

### Requirement: Webview lifecycle SHALL be scoped to surface tray and lease

The webview extension SHALL associate each window session with its owning App/Tray/Session identity — the owner tuple `(appId, trayId, sessionId)` — plus the owning lease. Every window session, webview, layout document, and message channel created by the extension SHALL be tagged with this owner tuple in protocol frames and native state, and cleanup SHALL be keyed by it: a session-close callback SHALL destroy exactly the webviews, layouts, and channels whose owner tuple matches that session, and SHALL NOT touch state owned by any other live session. A tray scope SHALL own at most one active WebView window session per extension instance. A window session SHALL host one or more webview instances as sibling native views inside the window, addressed by webview id unique within the window session; the session SHALL remain valid as webviews are created and destroyed within it. Lease cleanup SHALL hide or destroy all webview state owned by the disconnected client without affecting webview state owned by other leases.

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

#### Scenario: Session cleanup is scoped to the closing session only

- **GIVEN** two live sessions of the same app share a broker, each hosting a multi-webview window
- **WHEN** one session closes
- **THEN** only that session's window, its webviews, its layout, and its message channels SHALL be destroyed
- **AND** the other session's windows, webviews, and channels SHALL remain alive and observable

#### Scenario: Lease cleanup closes owned popup

- **GIVEN** a client shows a webview popup for its tray
- **WHEN** that client disconnects
- **THEN** the kernel closes or invalidates the webview session owned by that lease
- **AND** other clients' webview sessions remain unaffected.

## ADDED Requirements

### Requirement: A window session SHALL orchestrate multiple webviews as sibling native views

The webview facade SHALL expose `createWebview` (parent window session, unique webview id, url or html content), `destroyWebview`, and `listWebviews` on the window handle, and a per-webview `focus()` command raising that webview to native focus within its window. A webview created inside a window SHALL be a sibling native child view (macOS: NSView subview; Windows: child HWND) — never a separate OS window. Webview ids SHALL be unique within their window session. The page bridge SHALL expose the owning webview's id as a read-only property. In the v1 scope this orchestration SHALL apply to framed windows; requesting multi-webview composition on frameless or material-styled windows SHALL fail with the typed error `multiwebview_unsupported_style` before any layout is applied.

Stacking: opaque stacking of webviews across layers SHALL be supported; if any webview participating in an overlapping layout region is in a transparent or material style, `setLayout` SHALL be rejected with the typed error `translucent_overlap` before the layout commits, leaving the previously applied layout in effect. Every capability field introduced by this requirement (webview id, focus command, typed errors) SHALL be serialized by both platforms' capability DTOs — Darwin release-grade builds are the cross-platform compiler gate.

#### Scenario: Two webviews compose one window

- **GIVEN** a framed webview window session
- **WHEN** the caller creates webviews `toolbar` and `content` and applies a two-row layout
- **THEN** both SHALL render as sibling views inside the same OS window
- **AND** destroying `toolbar` SHALL leave `content` and its page runtime alive in the same session

#### Scenario: Frameless multi-webview is a typed rejection

- **GIVEN** a frameless or material-styled window
- **WHEN** the caller creates a second webview inside it
- **THEN** the extension SHALL reject with the typed error `multiwebview_unsupported_style`
- **AND** the existing single-webview behavior SHALL remain unchanged

#### Scenario: Opaque cross-layer overlap is legal; translucent is rejected pre-commit

- **GIVEN** webview `bottom` filling a window's bottom layer and webview `top` placed over part of it in an upper layer, both opaque
- **WHEN** the layout is applied
- **THEN** the layout SHALL commit and `top` SHALL visually cover the overlapped region of `bottom`
- **WHEN** the same layout is applied while either webview is in a transparent or material style
- **THEN** `setLayout` SHALL fail with the typed error `translucent_overlap` and the previous layout SHALL remain in effect

#### Scenario: Per-webview focus raises one view without touching siblings

- **GIVEN** webviews `toolbar` and `content` in one window with `content` holding native focus
- **WHEN** the host calls `focus()` on the `toolbar` webview handle
- **THEN** `toolbar` SHALL become the keyboard-focused view inside that window
- **AND** `content`'s page runtime and geometry SHALL be unaffected

#### Scenario: The page bridge knows its own webview id

- **GIVEN** a webview whose page bridge is enabled by page-access policy
- **WHEN** page code reads the webview id property
- **THEN** it SHALL observe the same opaque id the host facade uses to address this webview

### Requirement: Webview navigation SHALL be per-view with push URL and title events

Each webview SHALL expose `navigate` (explicit content replacement for that webview only, consistent with the content-replacement law), plus `back` and `forward` over the webview's native session history. URL and title changes SHALL be delivered to the host facade as push events (`urlChange`, `titleChange`), and focus transitions as `focused` events, all keyed by `(windowId, webviewId)`.

Event transport contract: subscription SHALL follow the facade handle's listeners (effective from creation, ended on handle destruction or broker disconnect); events SHALL be delivered in per-view order; the native implementation SHALL push these events from native page-load, title, and focus callbacks directly onto the event channel — reusing the 16 ms window-event drain polling loop as the observation mechanism for these events is prohibited. On broker disconnect, pending event delivery stops and listeners observe the disconnect through the existing connection lifecycle, not through synthetic events.

#### Scenario: navigate retargets one webview without touching siblings

- **GIVEN** webviews `toolbar` and `content` in one window
- **WHEN** the host calls `navigate(content, "https://example.org")`
- **THEN** only `content` SHALL load the new address
- **AND** `toolbar` SHALL keep its page runtime and position

#### Scenario: urlChange reports in-page navigation truth without polling

- **GIVEN** webview `content` showing a page that links internally
- **WHEN** the operator activates an in-page link
- **THEN** the host SHALL receive one `urlChange` push event carrying the page's actual new URL
- **AND** the delivery path SHALL not depend on any polling interval

#### Scenario: Events stop cleanly at disconnect

- **GIVEN** a host facade subscribed to a webview's `urlChange` events
- **WHEN** the broker connection drops
- **THEN** no further `urlChange` events SHALL be synthesized after the disconnect is observed
- **AND** re-establishing a session SHALL produce fresh subscriptions without replaying stale events

### Requirement: Windows multi-webview SHALL share one WebView2 environment and retained profile

On Windows, all webview controllers of one extension session SHALL share a single WebView2 environment whose user-data profile follows the existing WebView2 Profile Law (the retained `WebContext` beside the WebView; the profile path never derives from the broker executable path). The shared environment and `WebContext` SHALL outlive every child controller; destroying one controller SHALL NOT dispose the environment or affect sibling controllers' profile state. A controller creation failure SHALL include the resolved profile path in its error. Multi-child resize SHALL go through the existing WM_SIZE ordering law (host paint → each controller's bounds → WRY child bounds → parent-position notification) with every controller updated in one resize pass.

#### Scenario: Sibling controllers share profile state and survive each other

- **GIVEN** a Windows window session hosting webviews `toolbar` and `content` on one shared environment
- **WHEN** `toolbar` is destroyed and recreated
- **THEN** `content` SHALL keep its session and profile state
- **AND** the recreated `toolbar` SHALL attach to the same shared environment without a new profile directory

### Requirement: Overlay and titlebar geometry SHALL be projected per webview and updated on layout commits

Window-level overlay facts are unchanged: the `windowControlsOverlay` declaration is a window-level fact, Windows `AppWindowTitleBar.LeftInset`/`RightInset`/`Height` remain the safe-area authority read synchronously on the HWND-owning thread, and the existing overlay initialization-order laws keep holding. On top of those facts, the page-bridge `getTitlebarAreaRect()` SHALL report the safe-area rect in the receiving webview's own viewport coordinates: the intersection of the window overlay region with that webview's current layout rect, translated into view-local space; a webview that does not intersect the overlay region SHALL receive an empty rect. A window whose single webview fills the client area SHALL report exactly the values a full-window webview reports today — existing single-webview windows keep their geometry.

Projection SHALL be recomputed inside the layout commit transaction (after frames are applied) and on overlay metric changes (scale factor, style, or system metric changes); affected bridged webviews SHALL receive `geometrychange` push events. Custom drag regions SHALL be declared in view-local coordinates and translated into window coordinates through the declaring webview's current layout rect; a layout commit SHALL re-register active regions under the new rects, so no stale translation survives a layout change. Windows non-client hit-testing and drag routing SHALL resolve against whichever child webview actually occupies the titlebar region under the cursor.

#### Scenario: A view outside the titlebar region gets an empty safe area

- **GIVEN** a window with a frameless titlebar overlay and a layout placing webview `content` entirely below the overlay region
- **WHEN** `content`'s page calls `getTitlebarAreaRect()`
- **THEN** it SHALL receive an empty rect and SHALL NOT render titlebar padding

#### Scenario: The titlebar view gets view-local coordinates that track layout changes

- **GIVEN** webview `bar` occupying the top strip intersecting the caption-button region at window coordinates `{x: 0, y: 0, width: 800, height: 44}`
- **WHEN** its page calls `getTitlebarAreaRect()`, the host then commits a layout moving `bar` down by 20 logical pixels
- **THEN** the first call SHALL return the caption-button exclusion translated into `bar`'s local space
- **AND** the layout commit SHALL recompute the projection and push a `geometrychange` event to `bar` with the shifted local rect

#### Scenario: Full-window single webview keeps today's geometry

- **GIVEN** a frameless overlay window whose only webview fills the client area (the default layout)
- **WHEN** its page measures the titlebar area before and after this change's implementation
- **THEN** the reported rect SHALL equal the window-level values a full-window webview reports today
