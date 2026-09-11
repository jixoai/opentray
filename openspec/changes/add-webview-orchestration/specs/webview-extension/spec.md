## MODIFIED Requirements

### Requirement: Webview lifecycle SHALL be scoped to surface tray and lease

The webview extension SHALL associate each window session with its owning App/Tray/Session identity — the owner tuple `(appId, trayId, sessionId)` — plus the owning lease. Every window session, webview, layout document, and message channel created by the extension SHALL be tagged with this owner tuple in protocol frames and native state, and cleanup SHALL be keyed by it: a session-close callback SHALL destroy exactly the webviews, layouts, and channels whose owner tuple matches that session, and SHALL NOT touch state owned by any other live session. A tray scope SHALL own at most one active WebView window session per extension instance: creating a second window session for the same tray SHALL fail at creation with the typed error `tray_session_active` before any window state exists. A window session SHALL host one or more webview instances as sibling native views inside the window, addressed by webview id unique within the window session; the session SHALL remain valid as webviews are created and destroyed within it. Lease cleanup SHALL hide or destroy all webview state owned by the disconnected client without affecting webview state owned by other leases.

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

#### Scenario: A second session for the same tray is a typed rejection

- **GIVEN** a tray with an active WebView window session
- **WHEN** a caller creates another window session for that same tray
- **THEN** creation SHALL fail with the typed error `tray_session_active`
- **AND** the existing session, its webviews, and its layout SHALL remain untouched

#### Scenario: Session cleanup is scoped to the closing session only

- **GIVEN** two live sessions of the same app on distinct trays share a broker, each hosting a multi-webview window
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

The webview facade SHALL expose `createWebview` (parent window session, unique webview id, url or html content, optional per-webview bridge policy), `destroyWebview`, and `listWebviews` on the window handle, and a per-webview `focus()` command raising that webview to native focus within its window. A webview created inside a window SHALL be a sibling native child view (macOS: NSView subview; Windows: child HWND) — never a separate OS window. Webview ids SHALL be unique within their window session. The page bridge SHALL expose the owning webview's id as a read-only property.

Per-webview bridge policy: `createWebview` SHALL accept an optional declarative bridge policy whose DTO is frozen as the boolean field set `{ webviewId, messageChannels, navigatorWindow, navigatorScreen, nativeApi }` — every field defaults to false, and omitting the policy entirely means all fields false (no bridge). A child webview without an explicit policy never exposes the bridge to its pages — the arbitrary-content webview is bridgeless by default, and trusted webviews (such as a toolbar) opt in explicitly (for the toolbar carrier: `{ webviewId: true, messageChannels: true }`). The policy is bootstrap-immutable for that webview's lifetime, mirroring the session compatibility law.

Style exclusivity is one rule with one error: a window in a translucency-affecting style (frameless or material today; any future per-view transparent backing) SHALL NOT host multi-webview composition. The guard SHALL fire with the typed error `multiwebview_unsupported_style` at three checkpoints, before any state changes: (1) creating a second webview in such a window, (2) applying a frameless or material style mutation to a window that already hosts more than one webview, and (3) committing a layout in which any participating view carries a transparency-affecting style. Opaque stacking of webviews across layers of a framed window SHALL be supported. Every capability field introduced by this requirement (webview id, bridge policy, focus command, typed error) SHALL be serialized by both platforms' capability DTOs — Darwin release-grade builds are the cross-platform compiler gate.

#### Scenario: Two webviews compose one window

- **GIVEN** a framed webview window session
- **WHEN** the caller creates webviews `toolbar` (bridge policy on) and `content` (no policy) and applies a two-row layout
- **THEN** both SHALL render as sibling views inside the same OS window
- **AND** destroying `toolbar` SHALL leave `content` and its page runtime alive in the same session

#### Scenario: The bridge is opt-in per child webview

- **GIVEN** webview `content` created without a bridge policy, showing an arbitrary cross-origin site
- **WHEN** its page probes for the webview id property or channel APIs
- **THEN** none SHALL be exposed (every bridge field defaults to false)
- **AND** webview `toolbar` created with `{ webviewId: true, messageChannels: true }` in the same window SHALL expose exactly those bridge surfaces

#### Scenario: Translucency-affecting styles and multi-webview are mutually exclusive at every checkpoint

- **GIVEN** a framed window hosting webviews `a` and `b`
- **WHEN** the host applies a material or frameless style mutation to the window
- **THEN** the mutation SHALL fail with the typed error `multiwebview_unsupported_style` and the framed style SHALL remain
- **WHEN** instead a second webview is created inside an already-material or frameless window
- **THEN** creation SHALL fail with the same typed error before any child state exists
- **AND** opaque cross-layer overlap in a framed window SHALL commit and render normally

#### Scenario: Per-webview focus raises one view without touching siblings

- **GIVEN** webviews `toolbar` and `content` in one window with `content` holding native focus
- **WHEN** the host calls `focus()` on the `toolbar` webview handle
- **THEN** `toolbar` SHALL become the keyboard-focused view inside that window
- **AND** `content`'s page runtime and geometry SHALL be unaffected

#### Scenario: The page bridge knows its own webview id

- **GIVEN** a webview whose page bridge is enabled by its explicit bridge policy
- **WHEN** page code reads the webview id property
- **THEN** it SHALL observe the same opaque id the host facade uses to address this webview

### Requirement: Webview navigation SHALL be per-view with push URL and title events

Each webview SHALL expose `navigate` (explicit content replacement for that webview only, consistent with the content-replacement law), plus `back` and `forward` over the webview's native session history. URL and title changes SHALL be delivered to the host facade as push events (`urlChange`, `titleChange`), and focus transitions as `focused` edge events, for that webview.

Event wire contract: the unified per-view event family is `kind ∈ { urlChange, titleChange, focused, geometryChange }` (geometryChange carries the overlay safe-area projection and is specified with the overlay requirement). Every event frame SHALL carry `{ owner: {appId, trayId, sessionId}, windowId, webviewId, kind, seq, payload }` — the owner tuple rides the frame so session-scoped ids never collide across sessions; `seq` is a per-view monotonically increasing sequence number; payloads are `{url}` for `urlChange`, `{title}` for `titleChange`, `{focused: boolean}` for `focused` (edge semantics: gained or lost), and `{rect}` for `geometryChange` (the view-local safe-area rect after projection). Subscription follows the facade handle's listeners, materialized as explicit wire subscribe/unsubscribe frames (fixture-frozen in the codec tests). Events are pure push with no replay: current values are read through the facade query commands `getUrl()` and `getTitle()`, which return `(value, seq)`; consumers subscribe first, then query, and discard events whose `seq` is not greater than the queried `seq`. `focused` and `geometryChange` have no query — consumers track edges and projection updates. The native implementation SHALL push these events from native page-load, title, focus, and layout-projection callbacks directly onto the event channel — reusing the 16 ms window-event drain polling loop as the observation mechanism for these events is prohibited. On broker disconnect, pending event delivery stops and listeners observe the disconnect through the existing connection lifecycle, not through synthetic events.

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

#### Scenario: Focus transfer emits both edges with full frame identity

- **GIVEN** webviews `toolbar` and `content` in one window, `content` holding native focus, and the host subscribed to both views' `focused` events
- **WHEN** the host calls `focus()` on the `toolbar` webview handle
- **THEN** `content` SHALL receive `focused: false` and `toolbar` SHALL receive `focused: true`
- **AND** both event frames SHALL carry the correct owner tuple, window id, webview id, and per-view sequence numbers that increased monotonically
- **AND** the delivery path SHALL not depend on any polling interval

#### Scenario: Query plus sequence resolves the subscription race

- **GIVEN** a webview that has already navigated before the host subscribes
- **WHEN** the host subscribes to `urlChange` and then calls `getUrl()`
- **THEN** the query SHALL return the current URL with its sequence number
- **AND** any `urlChange` event whose `seq` is not greater than the queried `seq` SHALL be discardable as stale without missing a real change

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

Projection SHALL be recomputed inside the layout commit transaction (after frames are applied) and on overlay metric changes (scale factor, style, or system metric changes); affected bridged webviews SHALL receive `geometryChange` push events as members of the unified per-view event family (same frame schema, sequence numbers, subscription mechanism, and no-polling guarantee as urlChange/titleChange/focused; payload is the view-local safe-area rect). Custom drag regions SHALL be declared in view-local coordinates and translated into window coordinates through the declaring webview's current layout rect; a layout commit SHALL re-register active regions under the new rects, so no stale translation survives a layout change. Windows non-client hit-testing and drag routing SHALL resolve against whichever child webview actually occupies the titlebar region under the cursor.

#### Scenario: A view outside the titlebar region gets an empty safe area

- **GIVEN** a window with a frameless titlebar overlay and a layout placing webview `content` entirely below the overlay region
- **WHEN** `content`'s page calls `getTitlebarAreaRect()`
- **THEN** it SHALL receive an empty rect and SHALL NOT render titlebar padding

#### Scenario: The titlebar view gets view-local coordinates that track layout changes

- **GIVEN** webview `bar` occupying the top strip intersecting the caption-button region at window coordinates `{x: 0, y: 0, width: 800, height: 44}`
- **WHEN** its page calls `getTitlebarAreaRect()`, the host then commits a layout moving `bar` down by 20 logical pixels
- **THEN** the first call SHALL return the caption-button exclusion translated into `bar`'s local space
- **AND** the layout commit SHALL recompute the projection and push a `geometryChange` event (unified event family) to `bar` with the shifted local rect

#### Scenario: Full-window single webview keeps today's geometry

- **GIVEN** a frameless overlay window whose only webview fills the client area (the default layout)
- **WHEN** its page measures the titlebar area before and after this change's implementation
- **THEN** the reported rect SHALL equal the window-level values a full-window webview reports today
