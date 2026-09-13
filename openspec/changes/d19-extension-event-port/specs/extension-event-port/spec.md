## ADDED Requirements

### Requirement: Extensions SHALL report out-of-dispatch events through the owned Extension EventPort

The dynamic extension host SHALL offer an optional, versioned EventPort capability: one optional exported symbol (`opentray_ext_attach_event_port_v1`) that the loader resolves after required ABI symbols and invokes once, transferring an immutable port value `{ abi_version, struct_size, port_data, try_submit }`. The extension MAY copy that value and call `try_submit(port_data, { tray_id, data_json, class, coalesce_key })` from any thread at any time; the call SHALL never block on native UI, transport I/O, or core dispatch, never call back into extension code, and never dereference extension memory after it copies the bounded input bytes.

Port identity SHALL be host-bound: the hub keys every source by `{ generation, owner_session_id, app_id, instance_name }` — all host facts. A submitted record carries only the tray route and extension-defined JSON; the hub SHALL validate on drain that the tray is live and owned by the source before emitting an `ext-event` frame, and SHALL drop with structured diagnostics otherwise. Phase 1 has no retain/release and no detach: port state lives until broker process exit, and revocation changes the source to `REVOKED`, after which submits return `EXT_ERR_PORT_CLOSED` without queue mutation. The lifecycle is exactly `PENDING → OPEN → REVOKED` (open on LoadExt ACK; revoke before session cleanup, instance deinit/reload, or broker shutdown). A source-slot limit SHALL be enforced with a structured rejection before attach.

Absence of the optional symbol SHALL mean legacy behavior (events flush with command responses); an extension exporting a partial or version-mismatched port surface SHALL be rejected as `event_port_abi_incompatible`, never silently downgraded. The host SHALL report which delivery mode is active (direct EventPort vs legacy flush) as capability diagnostics.

#### Scenario: Idle native callback reaches the facade without any command

- **GIVEN** a loaded extension attached to an EventPort and a shown webview whose session is open
- **WHEN** a native WebView callback fires while no command is in flight anywhere
- **THEN** the record SHALL be queued by `try_submit`, the host loop SHALL be woken (coalesced), and the consuming Node facade SHALL receive the ext-event frame without any drain or command occurring

#### Scenario: Forged identity is unexpressible

- **GIVEN** an extension holding an attached port
- **WHEN** it submits a record
- **THEN** the record SHALL carry only a tray route and data — app id, instance name, and session come from the host-bound source key
- **AND** a route to a removed or foreign tray SHALL be dropped with a source-tagged diagnostic, never delivered

#### Scenario: Revocation precedes session cleanup

- **GIVEN** an open source with queued records
- **WHEN** the owning session closes
- **THEN** the hub SHALL atomically mark the source `REVOKED` before session cleanup runs, discard queued records, and subsequent submits SHALL return `PORT_CLOSED` without mutation
- **AND** no frame SHALL be delivered after the session close on either the old or a recycled same-name generation

### Requirement: EventPort ingress SHALL be bounded, fair, and class-semantically honest

Every source SHALL have bounded queues (records and bytes) with broker-global caps, drained round-robin in bounded quanta per wake so one extension cannot starve others; all budgets SHALL be compile-time constants. Every record SHALL declare one of three classes at submit: `Latest(key)` (replaces the pending same-key record; state truth with query/sequence resync in the extension contract), `Edge` (never silently discarded — a full queue returns `EXT_ERR_BACKPRESSURE` and the producer owns bounded retry), or `BestEffort` (drops newest with a metric and returns success). The generic channel SHALL NOT assign product classes; each extension's contract SHALL freeze its event-class table in its contract fingerprint. Ordering SHALL be per-source submit linearization (except explicit Latest replacement), with no cross-source total order, and command-response events SHALL keep the existing response barrier.

#### Scenario: Latest coalescing converges URL truth

- **GIVEN** a full per-source queue and a pending `urlChange` for webview `content`
- **WHEN** a newer `urlChange` for the same webview arrives
- **THEN** the pending record is replaced, `EXT_OK` is returned, and the consumer converges to the latest URL (a sequence gap triggers the contract's `getUrl(value, seq)` resync)

#### Scenario: Edge records are never silently dropped

- **GIVEN** a full per-source queue
- **WHEN** an Edge-class record (e.g. loadState failed) is submitted
- **THEN** the call SHALL return `EXT_ERR_BACKPRESSURE` without queue mutation, and the extension's bounded retry contract governs redelivery

#### Scenario: A noisy source cannot starve others

- **GIVEN** two extensions with queued records and a drain wake
- **WHEN** the hub drains
- **THEN** records SHALL be taken round-robin in bounded quanta per source, and global byte/record caps SHALL apply

### Requirement: The legacy 16 ms window-event drain SHALL be retired only after full push parity

`drainWindowEvents` polling (native queue, facade interval, listener-count timer) SHALL be deleted only after every member of the legacy polled event family has a subscribed native EventPort producer and macOS/Windows idle-path evidence shows zero native drain commands for a shown retained window. Permission-message draining is a separate request/reply mechanism and SHALL NOT be migrated or removed by this change. `ExtHostContext.send_event` during dispatch SHALL be unified into the same hub ingress scheduled at the existing post-response barrier.

#### Scenario: Zero idle drain commands on a retained window

- **GIVEN** a shown, retained app-mode window on macOS and Windows
- **WHEN** it stays idle while native callbacks (navigation/title) occur
- **THEN** the facade SHALL receive those events via the port
- **AND** broker-side drain-command counters SHALL read zero for the migrated families

#### Scenario: send_event unification preserves the response barrier

- **GIVEN** a command dispatch during which the extension calls `send_event`
- **WHEN** the dispatch returns
- **THEN** the response frames SHALL be written before those events are delivered, matching the legacy ordering contract
