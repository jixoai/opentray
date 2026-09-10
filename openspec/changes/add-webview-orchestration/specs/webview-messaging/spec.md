## ADDED Requirements

### Requirement: Message channels SHALL be targeted connections without port transfer

The webview extension SHALL provide `createMessageChannel({ target: webviewId })`: the broker creates one channel, the creator holds one endpoint implicitly (the host/entry process is a legal endpoint), and the target webview receives its endpoint through the `onCreatedMessageChannel` push event. There SHALL be no port handles that callers transfer between contexts. Channels SHALL be discoverable: `listMessageChannels` on the host facade lists all live channels of the calling session; the page bridge equivalent SHALL list only channels that page participates in. Channel ids SHALL be opaque and unique within their session scope.

#### Scenario: Entry connects to its toolbar page

- **GIVEN** a window with webview `toolbar` whose page bridge is enabled
- **WHEN** the entry calls `createMessageChannel({ target: toolbarId })`
- **THEN** the entry SHALL hold a usable endpoint immediately
- **AND** the toolbar page SHALL receive exactly one `onCreatedMessageChannel` event with its endpoint
- **AND** neither side SHALL ever hold or transfer the other side's port object

#### Scenario: Listing reflects live participation

- **GIVEN** one open channel between the host and webview `a`, and one closed channel between webviews `a` and `b`
- **WHEN** each participant lists its channels
- **THEN** the host SHALL see both channels with their states
- **AND** page `a` SHALL see only the two channels it participates in

### Requirement: Channel authority SHALL be session-scoped and page-access-gated

Channel creation SHALL be legal for the host facade without restriction and for pages only within the creating extension session (`(appId, trayId, sessionId)`): a channel between views of different sessions SHALL be impossible to express, not merely rejected. A channel endpoint SHALL only be delivered to a webview whose page bridge is enabled by the existing page-access policy; a target without bridge access SHALL fail channel creation with a typed error. Arbitrary third-party content pages have no bridge by default and therefore cannot create or receive channels.

#### Scenario: Bridgeless target rejects creation

- **GIVEN** webview `content` showing an arbitrary cross-origin site with no page bridge
- **WHEN** any caller attempts `createMessageChannel({ target: contentId })`
- **THEN** creation SHALL fail with a typed error
- **AND** no endpoint, event, or channel state SHALL be created

### Requirement: Channel lifecycle SHALL be an explicit observable state machine

Every channel SHALL progress `created → open → closed(reason) → destroyed`. Closing reasons SHALL be structured values covering at least: `explicit` (either endpoint closed), `peer_webview_destroyed`, `window_destroyed`, `session_closed`, `document_navigated` (page-side endpoint), and `queue_overflow`. Sending on a non-open endpoint SHALL return a typed error and SHALL NOT silently drop the message. Delivery SHALL preserve per-endpoint FIFO order. Each port queue SHALL be bounded (message count and byte size); exceeding the bound SHALL close the channel with `queue_overflow` rather than grow unbounded. Closed channels SHALL remain queryable as bounded tombstones (id, endpoints, reason) until destroyed. A page-side endpoint SHALL close with `document_navigated` when its document navigates; the host-side endpoint SHALL observe the same transition. Messages SHALL NOT be buffered across document navigation.

#### Scenario: Peer teardown closes channels with reason

- **GIVEN** an open channel between the host and webview `toolbar`
- **WHEN** `toolbar` is destroyed via `destroyWebview`
- **THEN** the channel SHALL close with reason `peer_webview_destroyed`
- **AND** a subsequent send from the host endpoint SHALL fail with a typed error instead of dropping silently

#### Scenario: Navigation closes the page-side endpoint honestly

- **GIVEN** an open channel whose page-side endpoint lives in webview `toolbar`'s document
- **WHEN** that document navigates to another URL
- **THEN** the page-side endpoint SHALL close with `document_navigated` and pending messages SHALL NOT be replayed into the new document
- **AND** the host-side endpoint SHALL observe the closure

#### Scenario: Queue overflow is bounded, not fatal

- **GIVEN** an open channel whose target endpoint is not consuming messages
- **WHEN** the producer exceeds the per-port queue bound
- **THEN** the channel SHALL close with `queue_overflow`
- **AND** the producer SHALL receive the typed close event, not an unbounded memory footprint

### Requirement: Channel transport SHALL be push-based with typed payloads

A message payload SHALL be a UTF-8 string or an arbitrary JSON value; transferables SHALL NOT be part of the protocol. Message delivery SHALL be event-driven push on every hop (page→broker and broker→page); channel traffic SHALL NOT be carried by polling loops. The broker is the transport root: it relays every message and MAY observe payloads — the protocol offers no confidentiality between endpoints against the host application.

#### Scenario: JSON payloads round-trip without string coercion

- **GIVEN** an open channel
- **WHEN** the host posts the JSON value `{"type": "navigate", "url": "https://example.com"}`
- **THEN** the page endpoint SHALL receive the same JSON value without manual parse/stringify by either application layer
