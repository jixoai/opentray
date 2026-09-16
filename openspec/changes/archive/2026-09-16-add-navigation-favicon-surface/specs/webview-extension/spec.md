# webview-extension delta

## MODIFIED Requirements

### Requirement: Webview navigation SHALL be per-view with push URL and title events

Each webview SHALL expose `navigate` (explicit content replacement for that webview only, consistent with the content-replacement law), plus `back` and `forward` over the webview's native session history. URL and title changes SHALL be delivered to the host facade as push events (`urlChange`, `titleChange`), and focus transitions as `focused` edge events, for that webview.

Event wire contract: the unified per-view event family is `kind ∈ { urlChange, titleChange, focused, geometryChange, loadState, navigationAction, faviconChange }` (geometryChange carries the overlay safe-area projection and is specified with the overlay requirement; loadState carries the per-view navigation lifecycle; `navigationAction` and `faviconChange` are specified with the webview-navigation and webview-favicon capabilities). Every event frame SHALL carry `{ owner: {appId, trayId, sessionId}, windowId, webviewId, kind, seq, payload }` — the owner tuple rides the frame so session-scoped ids never collide across sessions; `seq` is a per-view monotonically increasing sequence number. Payload DTOs are frozen field-level: `{ url: string }` for `urlChange`, `{ title: string }` for `titleChange`, `{ focused: boolean }` for `focused` (edge semantics: gained or lost), for `geometryChange` `{ rect: { x: number, y: number, width: number, height: number } | null }`, and for `loadState` `{ phase: "started" | "finished" | "failed", url: string, errorCode?: number, progress?: number }` (progress ∈ [0,1], omitted when the platform cannot report it — consumers render an indeterminate affordance) — view-local logical pixels, `null` meaning no intersection with the overlay region; this rect is field-isomorphic to the page-bridge `overlay.geometrychange` payload (same fields, same null rule, same units — the two surfaces serialize the same projection value in their respective envelopes). Subscription follows the facade handle's listeners, materialized as explicit wire subscribe/unsubscribe frames (fixture-frozen in the codec tests). Events are pure push with no replay: current values are read through the facade query commands `getUrl()`, `getTitle()` and — for webviews with favicon observation enabled — `getFavicon()`, which return `(value, seq)`; consumers subscribe first, then query, and discard events whose `seq` is not greater than the queried `seq`. `focused`, `geometryChange`, and `loadState` have no query — consumers track edges and projection updates. The native implementation SHALL push these events from native page-load, title, focus, and layout-projection callbacks directly onto the event channel — reusing the 16 ms window-event drain polling loop as the observation mechanism for these events is prohibited. On broker disconnect, pending event delivery stops and listeners observe the disconnect through the existing connection lifecycle, not through synthetic events.

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
