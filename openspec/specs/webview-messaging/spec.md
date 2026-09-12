# webview-messaging Specification

## Purpose
Message channels: targeted, push-based connections between the host facade and bridged pages inside one extension session — an explicit observable lifecycle with byte-exact bounds instead of the Web MessageChannel's silent drops and transfer semantics.

## Requirements

### Requirement: Message channels SHALL be targeted connections without port transfer

The webview extension SHALL provide `createMessageChannel({ target: webviewId })`: the broker creates one channel, the creator holds one endpoint implicitly (the host/entry process is a legal creator), and the target webview receives its endpoint through the `onCreatedMessageChannel` push event. There SHALL be no port handles that callers transfer between contexts. A target SHALL always be a webview; the host cannot be targeted and participates only as creator. Both creator sides are symmetric: the host facade calls the facade method, and a bridged page calls `navigator.opentrayWebview.createMessageChannel({ target })`, which resolves to the creating endpoint after the broker validates scope and bridge access — the target page's `onCreatedMessageChannel` event and the creator's resolution SHALL both be observable, and their relative order across the two sides is unspecified.

An endpoint exposes exactly `post(payload)`, `onMessage(handler)`, `onClose(handler)`, `close()`, `destroy()`, and the channel id. `onClose` is the lifecycle observation surface with a strict cardinality rule: **each endpoint SHALL receive at most one `onClose` per channel** — the first closure transition fires it once with `{ reason }`; every later transition (including `closed → destroyed` tombstone removal) is storage-only and silent to endpoints. Closure notices SHALL NOT be smuggled through `onMessage`, which carries only peer payloads in FIFO order. Channel discovery: `listMessageChannels` SHALL return every channel of the calling session in state `open` or `closed`, including bounded tombstones — the host facade sees all channels of its session; a page sees only channels it participates in. `destroyed` channels SHALL NOT be listed. Channel ids SHALL be opaque and unique within their session scope.

The wire frames are frozen field-level (errors use the typed-code envelope `{ error: { code, message } }`; the owner tuple rides every frame envelope):

- `channel.create` — request `{ target: webviewId }`; response `{ channelId }`; errors `unknown_view`, `bridge_required`, `session_scope`.
- `channel.post` — request `{ channelId, payload: string | JSON value }`; response ok; errors `not_open`, `invalid_payload`, `payload_too_large`, and `queue_overflow` (which also closes the channel — both endpoints observe one `onClose`).
- `channel.close` — request `{ channelId }`; response ok; closing an already-closed channel is an idempotent success.
- `channel.destroy` — request `{ channelId }`; response ok; idempotent; emits nothing to endpoints that already observed a closure.
- `channel.list` — request `{}`; response `{ channels: [{ channelId, state: "open" | "closed", reason?: <close reason, present when closed>, endpoints: [{ side: "creator" | "target", peer: webviewId | "host" }] }] }`. Visibility: the host receives full endpoint descriptors; a page receives its participating channels with endpoint peers reduced to the side label only — peer webview ids are not exposed to pages.
- Push event `channel.created` (to the target webview) — payload `{ channelId }`.
- Push event `channel.closed` (to each endpoint that has not yet observed a closure) — payload `{ channelId, reason }`.

Field-level codec fixtures for this inventory live in `@opentray/spec` and the Rust protocol crate, consumed by both TS and Rust tests.

#### Scenario: Entry connects to its toolbar page

- **GIVEN** a window with webview `toolbar` whose page bridge is enabled
- **WHEN** the entry calls `createMessageChannel({ target: toolbarId })`
- **THEN** the entry SHALL hold a usable endpoint (post / onMessage / close / destroy) immediately
- **AND** the toolbar page SHALL receive exactly one `onCreatedMessageChannel` event with its endpoint
- **AND** neither side SHALL ever hold or transfer the other side's port object

#### Scenario: A page creates a channel to a sibling page

- **GIVEN** bridged pages `a` and `b` in the same extension session
- **WHEN** page `a` calls `navigator.opentrayWebview.createMessageChannel({ target: bId })`
- **THEN** the call SHALL resolve to an endpoint for page `a`
- **AND** page `b` SHALL receive `onCreatedMessageChannel`
- **AND** both endpoints SHALL post and receive symmetrically with the host-created case

#### Scenario: Listing reflects live channels plus bounded tombstones

- **GIVEN** one open channel between the host and webview `a`, and one closed channel between webviews `a` and `b`
- **WHEN** each participant lists its channels
- **THEN** the host SHALL see both channels with their states and close reasons
- **AND** page `a` SHALL see exactly the two channels it participates in
- **AND** a channel that was destroyed SHALL be absent from every list

### Requirement: Channel authority SHALL be session-scoped and page-access-gated

Channel creation SHALL be legal for the host facade without restriction and for pages only within the creating extension session (`(appId, trayId, sessionId)`). Well-formed page input cannot address another session: the page bridge exposes only ids of the caller's own session, so cross-session targets are unexpressible to pages by construction. The broker nonetheless validates every creation attempt — host facade included — against the owner tuple, and rejects a malformed or hostile cross-session target with the typed error `session_scope` before any channel state exists. A channel endpoint SHALL only be delivered to a webview whose page bridge is enabled (its explicit per-webview bridge policy); a target without bridge access SHALL fail channel creation with the typed error `bridge_required`. Arbitrary third-party content pages have no bridge by default and therefore cannot create or receive channels.

#### Scenario: Bridgeless target rejects creation

- **GIVEN** webview `content` showing an arbitrary cross-origin site with no page bridge
- **WHEN** any caller attempts `createMessageChannel({ target: contentId })`
- **THEN** creation SHALL fail with the typed error `bridge_required`
- **AND** no endpoint, event, or channel state SHALL be created

#### Scenario: Cross-session targeting is validated away with zero partial state

- **GIVEN** two live extension sessions of the same app and a caller that submits a creation request whose target id resolves to the other session
- **WHEN** the broker validates the request
- **THEN** creation SHALL fail with the typed error `session_scope`
- **AND** no channel, endpoint, or tombstone state SHALL survive in either session

### Requirement: Channel lifecycle SHALL be an explicit observable state machine

Every channel SHALL progress `created → open → closed(reason) → destroyed`. Closing reasons SHALL be structured values covering at least: `explicit` (an endpoint called `close`), `destroyed` (a participant called `destroy`), `peer_webview_destroyed`, `window_destroyed`, `session_closed`, `document_navigated` (page-side endpoint), and `queue_overflow`. Sending on a non-open endpoint SHALL return the typed error `not_open` and SHALL NOT silently drop the message. Delivery SHALL preserve per-endpoint FIFO order.

`close()` and `destroy()` are distinct APIs, callable by any participant endpoint, under the single-observation cardinality rule above: `close()` is the graceful path — the channel enters `closed(explicit)` and its tombstone remains listed; `destroy()` (also exposed as the facade's `destroyMessageChannel(id)`) is idempotent and a no-op on repeat calls; on a still-open channel it removes the channel state immediately and the endpoints' one `onClose` carries reason `destroyed`; on an already-closed channel it removes the tombstone silently (those endpoints already spent their one observation). The tombstone disappears from lists at once in both cases. The remaining destroy entrances are tombstone-capacity eviction and session close. Tombstone bound: each session retains at most its 32 most recently closed channels, oldest evicted.

Queue bounds (exact): each port queue SHALL hold at most 1000 messages AND at most 1 MiB cumulative payload; the boundary values themselves are legal. Payload byte accounting uses one canonical codec: a string payload counts its raw UTF-8 bytes; a JSON payload counts the UTF-8 bytes of its **RFC 8785 (JCS, JSON Canonicalization Scheme)** serialization — number forms (including `-0`, `1.0`, exponents, and the IEEE-754 safe-integer domain), string escaping, and key ordering (UTF-16 code unit order) are uniquely determined by RFC 8785, so the TS and Rust encoders produce identical bytes for the same value. The encodable value domain is the RFC 8785 domain; posting NaN, Infinity, undefined, or functions SHALL fail with the typed error `invalid_payload` before any accounting. The canonical encoder is verified by a shared fixture directory (`fixtures/canonical-json/`: input values plus expected byte output) consumed by both the TS and Rust codec tests. A single message whose canonical byte length exceeds 1 MiB SHALL be rejected with the typed error `payload_too_large` without entering the queue and without closing the channel. Exceeding either cumulative bound on enqueue SHALL close the channel with reason `queue_overflow`. A page-side endpoint SHALL close with `document_navigated` when its document navigates; the other endpoint SHALL observe the same transition. Messages SHALL NOT be buffered across document navigation.

#### Scenario: Peer teardown closes channels with reason

- **GIVEN** an open channel between the host and webview `toolbar`
- **WHEN** `toolbar` is destroyed via `destroyWebview`
- **THEN** the channel SHALL close with reason `peer_webview_destroyed`
- **AND** a subsequent send from the host endpoint SHALL fail with the typed error `not_open` instead of dropping silently

#### Scenario: close retains a tombstone; destroy removes it silently after close

- **GIVEN** an open channel between the host and webview `toolbar`
- **WHEN** the host calls `close()` on its endpoint
- **THEN** both endpoints SHALL observe exactly one `onClose({ reason: "explicit" })` and the channel SHALL remain listed as a closed tombstone
- **WHEN** the host then calls `destroy()` on the same channel (and calls it again)
- **THEN** the tombstone SHALL disappear from every list while both endpoints receive NO further lifecycle callback (their one observation was already spent)
- **AND** the repeat call SHALL be a no-op
- **WHEN** instead `destroy()` is called on a still-open channel
- **THEN** the endpoints' single `onClose` SHALL carry reason `"destroyed"` and the channel SHALL vanish from every list at once

#### Scenario: Navigation closes the page-side endpoint honestly

- **GIVEN** an open channel whose page-side endpoint lives in webview `toolbar`'s document
- **WHEN** that document navigates to another URL
- **THEN** the page-side endpoint SHALL close with `document_navigated` and pending messages SHALL NOT be replayed into the new document
- **AND** the host-side endpoint SHALL observe the closure

#### Scenario: Queue bounds are exact and reproducible across implementations

- **GIVEN** an open channel whose target endpoint is not consuming messages
- **WHEN** the producer enqueues messages whose canonical byte lengths sum to exactly 1,048,576 bytes (under 1000 messages)
- **THEN** the enqueue SHALL succeed and the channel SHALL remain open
- **WHEN** one more single-byte message is enqueued
- **THEN** the posting call SHALL return the typed error `queue_overflow` and the channel SHALL close with reason `queue_overflow`, observed by both endpoints through `onClose`
- **WHEN** instead exactly 1000 small messages (cumulative under 1 MiB) are enqueued, then one more
- **THEN** the 1000 SHALL succeed and the 1001st SHALL return the typed error `queue_overflow` and close the channel with reason `queue_overflow`
- **AND** a single message whose RFC 8785 serialization exceeds 1 MiB SHALL be rejected with `payload_too_large` while the channel stays open
- **AND** the same value SHALL produce the same byte count in the TS and Rust canonical encoders (verified by the shared `fixtures/canonical-json/` suite, including `-0`, `1.0`, and exponent number forms)

#### Scenario: Tombstones are bounded and evicted oldest-first

- **GIVEN** a session with 32 closed channels retained as tombstones
- **WHEN** a 33rd channel closes
- **THEN** the oldest tombstone SHALL be destroyed and absent from lists
- **AND** the newly closed channel SHALL be listed with its reason

### Requirement: Channel transport SHALL be push-based with typed payloads

A message payload SHALL be a UTF-8 string or an arbitrary JSON value (canonical-encodable per the lifecycle rule); transferables SHALL NOT be part of the protocol. Wire disambiguation is frozen: a payload whose wire JSON value is a string IS a string payload (counted as raw UTF-8 bytes); any other JSON value follows the RFC 8785 canonical byte count. Message delivery SHALL be event-driven push on every hop (page→broker and broker→page); channel traffic SHALL NOT be carried by polling loops. The broker is the transport root: it relays every message and MAY observe payloads — the protocol offers no confidentiality between endpoints against the host application.

#### Scenario: JSON payloads round-trip without string coercion

- **GIVEN** an open channel
- **WHEN** the host posts the JSON value `{"type": "navigate", "url": "https://example.com"}`
- **THEN** the page endpoint SHALL receive the same JSON value without manual parse/stringify by either application layer
