# webview-favicon delta

## ADDED Requirements

### Requirement: Webviews SHALL expose opt-in favicon observation with push events and a resumable query

A webview SHALL accept a `favicon: boolean` observation flag at creation, default `false`. When enabled, the host observation layer SHALL run the existing page-layer favicon observer (MutationObserver over `link[rel~=icon]` href/rel mutations plus document-ready) regardless of bridge policy; for a bridgeless webview the injected script SHALL contain the favicon observer only — no bridge namespaces, no webview id, no channel surface — so observation grants the host data and the page nothing. Observed changes SHALL push one `faviconChange` frame per settled value with payload `{ href }`, where `href` is resolved against the document URL into an absolute https/http address by the native side before emission. Frames carry `{ owner, windowId, webviewId, seq }`, classify as Latest on the EventPort (coalesce key `<webviewId>/favicon`), and are producer-gated on subscription. A `getFavicon()` query SHALL return the `(value, seq)` pair with `value: { href } | null`; the subscription race rule (subscribe, query, discard stale `seq`) applies unchanged.

#### Scenario: A dynamic favicon change reaches the host

- **GIVEN** a bridgeless content webview created with `favicon: true` and a subscribed host
- **WHEN** the page script swaps its `<link rel="icon">` href at runtime
- **THEN** exactly one `faviconChange` frame arrives with the newly resolved absolute `href`
- **AND** `getFavicon()` returns the same value with a `seq` not greater than the pushed frame's.

#### Scenario: Bridgeless observation grants the page nothing

- **GIVEN** a webview created with no bridge policy but `favicon: true`
- **WHEN** its bootstrap executes in the page
- **THEN** the page exposes no id surface, no channel surface, and no bridge command namespace
- **AND** the only observable behavior is the favicon observation traffic to the host.

#### Scenario: Default stays silent

- **GIVEN** a webview created without the `favicon` flag
- **WHEN** its page changes favicons repeatedly
- **THEN** no favicon frames are pushed and `getFavicon()` is not exposed for that view's capability set.
