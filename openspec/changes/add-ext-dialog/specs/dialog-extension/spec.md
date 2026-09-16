## ADDED Requirements

### Requirement: The dialog extension SHALL expose a session-scoped native dialog capability

`@opentray/ext-dialog` SHALL attach through the tray/session contract as `attachDialog(tray, options?)`, returning a capability whose methods dispatch broker commands scoped by a broker-injected `CommandScope { appId, trayId, sessionId, instanceGeneration }`. The capability SHALL expose `messageDialog`, the `alert`/`confirm` sugars, `pickFile`, `pickDirectory`, and `pickSavePath`, plus an asynchronous `getBackend(): Promise<DialogBackendCapabilities>` (the extension loads lazily; a synchronous truth property is not expressible). Linux targets SHALL be rejected by the facade with a typed `dialog_platform_unsupported` error before any broker connection.

Show commands SHALL complete through the DeferredOperation transaction: the broker issues an opaque operation handle only during command invocation (a tagged command disposition of immediate-or-deferred), answers `ExtCommandAccepted { requestId, operationId }`, and delivers exactly one `ExtOperationTerminal { operationId, payload }` frame whose payload is a frozen discriminated union — `{ kind: "result", value }` resolves the promise, `{ kind: "error", error: TypedExtensionError }` rejects it — covering user dismissal, escape, system close, session-close revocation (cancel-branch result, indistinguishable from user cancellation), and presentation failures alike. The native completion channel SHALL be a new optional, versioned DeferredCompletionPort ABI symbol following the EventPort lifetime pattern (immutable host-owned state, version/struct_size checks, bounded-copy submit with `EXT_ERR_PORT_CLOSED`/`EXT_ERR_INVALID_HANDLE`/oversize returns, opened only after LoadExt ACK, revoked before session/instance cleanup); it SHALL NOT reuse the scoped `ExtHostContext` and SHALL NOT masquerade as an EventPort event. The broker SHALL settle completions on the owner loop with a one-shot CAS (duplicate terminal frames, wrong-owner completions, and stale-generation completions are dropped statelessly with diagnostics) and route terminal frames only to the still-matching session writer. Because the dialog extension emits no EventPort events, no terminal-versus-event ordering is claimed. A transport close SHALL reject every local pending operation with the shared generic `extension_transport_closed` error (core client carries no extension-specific branch; the ext-dialog facade maps it to the public `dialog_transport_closed` code).

#### Scenario: A deferred dialog completes exactly once, between ordinary commands

- **GIVEN** a shown message dialog and two ordinary commands issued after it
- **WHEN** the dialog is dismissed while those ordinary commands are in flight or settled
- **THEN** the terminal frame SHALL settle the show promise exactly once with the result payload, the two ordinary commands SHALL complete normally, and a duplicated terminal frame for the same operationId SHALL be ignored

#### Scenario: Session-close revocation is indistinguishable from user cancellation

- **GIVEN** a shown dialog whose owning session is still open
- **WHEN** the session closes while the dialog is pending
- **THEN** the extension SHALL submit the cancel-branch result (cancelId branch for message dialogs, `null` for pickers) as the terminal payload after revocation and before extension cleanup, and the pending promise SHALL resolve identically to a user cancellation

#### Scenario: Disconnect rejects pending operations locally

- **GIVEN** a pending dialog operation and a transport that closes after acceptance
- **WHEN** the connection dies
- **THEN** the Node pending-until-final state machine SHALL reject the operation with a typed `dialog_transport_closed` error without waiting for a broker frame

#### Scenario: Linux invocation is rejected before broker dispatch

- **GIVEN** the facade running on a `linux-*` target
- **WHEN** any capability method is called
- **THEN** the call SHALL reject with typed `dialog_platform_unsupported` without connecting to or dispatching through the broker

### Requirement: The runtime model SHALL stay single-session; isolation is same-session multi-tray/multi-mount

This change SHALL NOT expand the caller-scoped single-session broker runtime. The broker-injected `CommandScope` keys extension instance state, busy tracking, and deferred operations; isolation acceptance SHALL cover one session's multiple trays and multiple mounts of the same extension, plus separate app instances as independent broker processes. Concurrent same-tray multi-session scenarios SHALL NOT appear in this contract (a shared multi-session broker would be an independent runtime change).

#### Scenario: Same session, two trays, one dialog each

- **GIVEN** one caller session with two trays, both attached to the dialog extension
- **WHEN** each tray shows a dialog concurrently
- **THEN** both operations SHALL be accepted and complete independently, and closing one's owning scope SHALL not withdraw the other's dialog

### Requirement: Message dialogs SHALL resolve force-dismissal through the cancel button

`messageDialog` SHALL accept `message`, `detail`, `buttons`, `defaultId`, `cancelId`, `severity`, and `suppressionLabel`. `buttons` SHALL be non-empty; `defaultId` and `cancelId` SHALL be valid button indices or the call SHALL reject with typed `dialog_invalid_options` before any state change. Close, escape, and any system dismissal SHALL resolve to `cancelId` when defined, otherwise to button index `0`; implementations SHALL guarantee this mapping natively (macOS escape keyEquivalent on the cancel button; win32 `TDF_ALLOW_CANCELLATION` enabled by default for every closable dialog, independent of `cancelId`). When the platform cannot observe the dismissal reason, the call SHALL reject with typed `dialog_dismissal_unavailable` rather than fabricate a success. When `suppressionLabel` is present the dialog SHALL show the suppression checkbox and the result SHALL report its final state as `suppressed`; the extension SHALL NOT persist that state. `alert` SHALL be the `["OK"]` button set and `confirm` SHALL be `["OK","Cancel"]` with `defaultId: 0` and `cancelId: 1` returning `response === 0`.

#### Scenario: Forced close maps to the cancel branch

- **GIVEN** a message dialog with buttons `["Save","Cancel","Discard"]` and `cancelId: 1`
- **WHEN** the user closes the dialog via the title bar or escape
- **THEN** the promise SHALL resolve with `response: 1`

#### Scenario: Suppression state is reported, not remembered

- **GIVEN** a message dialog with `suppressionLabel` and a checked suppression checkbox at dismissal
- **WHEN** the same dialog is shown again later in the same process
- **THEN** the result of the first call SHALL report `suppressed: true` and the second showing SHALL start unchecked — persistence is the application's own state

### Requirement: Pickers SHALL return absolute paths or a typed cancellation

`pickFile`, `pickDirectory`, and `pickSavePath` SHALL resolve `null` on user cancellation and absolute paths (`~` expanded) on confirmation. Path canonicalization SHALL be frozen per shape (R2 P1-4): existing selections realpath; a `pickSavePath` leaf that does not exist canonicalizes the existing parent then lexically joins the leaf — full realpath is never claimed for nonexistent targets. `pickSavePath` results SHALL NOT be guaranteed to exist. `filters` SHALL be extension-based (dot-free, case-insensitive), mapped to `UTType(filenameExtension:)` on darwin and `COMDLG_FILTERSPEC` on win32; omitted or empty filters SHALL mean all files. `multiple: true` SHALL return at least one path on confirmation. Platform picker options (darwin `allowsOtherFileTypes: false` default and its filter interaction, win32 `defaultExtension`, win32 `strictFileTypes`, `createDirectories` degradation) SHALL be covered by deterministic scenarios per platform.

#### Scenario: Save path with a nonexistent leaf canonicalizes the parent

- **GIVEN** a save confirmation into `~/Docs/new-name.png` where `new-name.png` does not exist
- **WHEN** the result is returned
- **THEN** the parent directory SHALL be realpath-canonicalized and the leaf lexically joined; no existence claim is made about the result

#### Scenario: Cancellation is null, never an empty selection

- **GIVEN** a multi-select file picker opened with two files checked
- **WHEN** the user presses cancel
- **THEN** the promise SHALL resolve `null`, not an empty array

### Requirement: Platform namespaces SHALL be strictly validated typed surfaces

Platform-specific options SHALL be expressed only through the structured `options.darwin` / `options.win32` namespaces (design-reference §2), never as unnamespaced platform fields in the common options. A namespace that does not match the current platform SHALL reject with typed `dialog_platform_namespace_mismatch` carrying the offending namespace and current platform; unknown fields in any namespace or common option SHALL reject with typed `dialog_invalid_options`; a namespace-specific feature whose backend capability is unavailable (e.g. `commandLink` without TaskDialog support) SHALL reject with typed `dialog_capability_unavailable`. Silent ignore and silent downgrade SHALL NOT occur.

#### Scenario: A win32 namespace on darwin is rejected, not ignored

- **GIVEN** the facade running on darwin
- **WHEN** `messageDialog` is called with `win32: { buttonStyle: "commandLink" }`
- **THEN** the call SHALL reject with typed `dialog_platform_namespace_mismatch` naming the `win32` namespace and the `darwin` platform

#### Scenario: Command-link hints require command-link style

- **GIVEN** the facade running on win32 with TaskDialog support
- **WHEN** `buttonHints` is supplied while `buttonStyle` is `"standard"`
- **THEN** the call SHALL reject with typed `dialog_invalid_options`

### Requirement: Every platform build SHALL serialize the DialogBackendCapabilities DTO

The native extension SHALL embed and report a `DialogBackendCapabilities` DTO (platform, taskDialog, commandLinks, expander, suppression, packageSemantics, mixedFileDirectorySelection, addToRecentControl), exposed through the asynchronous `getBackend()` which loads the extension, requests the DTO, and returns an immutable snapshot. The DTO schema SHALL live in shared `@opentray/spec` and the opentray-spec crate with an exhaustive serialization fixture; CI SHALL explicitly run compile/type/test for BOTH darwin and windows targets and compare the same complete DTO fixture across both platform constructors — a single-target compile proves nothing (no cross-compilation causality is claimed).

#### Scenario: Runtime truth overrides static expectation

- **GIVEN** a win32 environment where the comctl32 v6 context is unavailable and dialogs fall back to MessageBox
- **WHEN** the facade awaits `getBackend()`
- **THEN** `taskDialog` and `commandLinks` SHALL report `false`, and a `commandLink`-styled call SHALL reject with `dialog_capability_unavailable` rather than silently rendering standard buttons

### Requirement: A modal dialog SHALL NOT stall tray event delivery

While any dialog is open, the broker SHALL keep dispatching tray events for the same session's other trays and mounts, evidenced by transport/request timelines rather than window screenshots. On macOS the dialog SHALL run through a modal-session stepping state machine (`Created → Presented → Stepping → Dismissed | Revoked`) driven by a broker-owned scheduler: `poll_owner` returns `Done(terminal) | Pending { next_deadline, wake_reason }`, the broker owns one coalesced `DialogPollDue(generation)` user event and idles via `ControlFlow::WaitUntil(min deadline)`; native AppKit callbacks may only advance deadlines (no broker pointers, no unbounded self-wakes); revocation removes the schedule before `endModalSession`; stale due events fail generation checks; and a bounded per-loop poll quota (at most 4 owners, one modal step each) prevents menu/transport starvation. The extension SHALL NOT name or hold any winit `UserEvent`/`EventLoopProxy`, and a bare `runModal` from command dispatch is prohibited. On win32 each active `(appId, trayId, sessionId)` SHALL own a bounded dedicated COM STA worker — never the winit owner loop thread — with frozen numeric contract (worker cap 8, worker-limit rejection `dialog_worker_limit_reached` before any queuing, worker startup/entry timeout 3 s producing a typed `dialog_presentation_failed` terminal, join timeout 2 s, per-worker `WM_APP` close dispatcher); `Accepted` on win32 SHALL mean honestly that the worker entered the native modal call (TaskDialog presentation evidenced by the `TDN_CREATED` callback; `IFileDialog::Show` has no documented pre-return shown signal), never that a queued request was presented. UI-affine native instances SHALL live in an owner-thread registry; the blanket `ExtensionInstance: Send` / `unsafe impl Send` assumption SHALL be removed or proven never-moved, with only copyable request data and the host-owned thread-safe port shim crossing threads. At most one dialog SHALL be active per `(appId, trayId, sessionId)`; a second concurrent show for the same scope SHALL reject with typed `dialog_session_busy` before native presentation. The macOS owner-loop probe SHALL precede ordinary dialog implementation and SHALL cover wake starvation, exit races, and step/menu-frame interleaving.

#### Scenario: Another tray stays alive while a dialog is open

- **GIVEN** one app with two trays, one showing a modal message dialog
- **WHEN** the user opens and clicks the other tray's menu
- **THEN** the menu interaction SHALL be dispatched and its handler resolved while the dialog remains open

#### Scenario: Same-session second dialog is a typed rejection

- **GIVEN** a session with an open directory picker
- **WHEN** the same session calls `pickFile`
- **THEN** the call SHALL reject with typed `dialog_session_busy` and no second native dialog SHALL appear

### Requirement: The facade package SHALL embed platform binaries under the pack-size law

`@opentray/ext-dialog` SHALL ship all platform libraries inside the facade package at `platforms/<target>/` through a new SDK `kind: "embedded"` native artifact. The embedded resolver SHALL canonicalize the facade root and the candidate library path and SHALL reject any path escaping the facade package (`path-outside-facade`), missing targets (`target-unsupported`), invalid manifests (`manifest-invalid`), and unreadable libraries (`library-unreadable`) as structured typed errors; traversal strings and symlink escapes SHALL both be unexpressible. Identity SHALL be resolved from the facade version plus `contract.json` AND a root-contained embedded staging manifest (`platforms/manifest.json`: per-target relative path, SHA-256, buildIdentity, facade version, contract fingerprint) shipped with the pack — in an implementable order: the resolver SHALL verify the manifest's containment, hash the selected library, and pass the expected SHA-256 and buildIdentity through `LoadExt`/`ExpectedExtensionIdentity`; the broker SHALL re-hash the resolved path before dynamic load; the native embedded manifest (an exported symbol inside the library) SHALL be verified only after `Library::new` and strictly before `init`. The residual hash-then-load TOCTOU window SHALL be documented as a known boundary; CI closure SHALL re-hash packed bytes as the release authority, and adversarial coverage SHALL replace real library bytes, not JSON claims. The release build graph SHALL register the dialog component with a full-matrix staging rule: all four targets must match the current facade version and contract fingerprint before `platforms/` is written, and missing, stale, or hash-mismatched targets SHALL fail the release. The workspace pack-size audit SHALL produce real evidence via `npm pack --json --pack-destination` (stat of the generated `.tgz`, npm/pnpm versions, packlist, per-target hashes, then unpacking that same tarball for per-target resolver/loader identity checks on each target runner; `--dry-run` is a development warning only), warn at ≥ 2 MB (an explicit Owner split decision is required before the next embedded release), and fail beyond 3 MB (the package must be split into `@opentray/<name>-<os>-<arch>` per-platform packages). Already-published per-platform packages are not retroactively affected.

#### Scenario: Embedded artifact resolves one library per target from the facade package

- **GIVEN** the installed `@opentray/ext-dialog` facade on `darwin-arm64`
- **WHEN** the SDK resolves the dialog extension artifact
- **THEN** it SHALL return the real path of `platforms/darwin-arm64/libopentray_ext_dialog.dylib` with expected identity `{ extensionName: "dialog", artifactSetVersion: <facade version>, contractFingerprint: "opentray-ext-dialog-contract-1", sha256: <staging-manifest hash for the target>, buildIdentity: <staging-manifest build identity> }`, and the `LoadExt` frame SHALL carry those sha256/buildIdentity fields for broker-side re-hash and post-load manifest verification

#### Scenario: The size gate fails an oversized embedded package

- **GIVEN** a package embedding platform binaries whose npm-pack compressed size is 3.5 MB
- **WHEN** the pack-size audit runs in CI
- **THEN** the audit SHALL fail with the measured size, requiring a split into per-platform packages
