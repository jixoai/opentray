## 1. Alignment / Investigation

- [x] 1.1 Confirm root cause: `TrayOptions.icon` required on broker + uncorrelated error frame → hang.
- [x] 1.2 Confirm a title-only tray is a valid platform status item on macOS/Linux/Windows.

## 2. BDD Contract

- [x] 2.1 Scenario: `createTray({ trayId, title })` without an icon resolves to a tray handle.
- [x] 2.2 Scenario: a malformed `create-tray` frame rejects the originating request with a typed error.
- [x] 2.3 Scenario: an uncorrelated error frame (no requestId) rejects all pending requests.

## 3. Implementation

- [x] 3.1 Make `TrayOptions.icon` optional in `opentray-spec/model.rs`.
- [x] 3.2 Make `TrayProjection.icon` optional in `opentray-core/backend.rs`; thread through kernel projection.
- [x] 3.3 Update `opentray-backend-tray-icon` projection + native runtime to handle a missing icon (title-only tray).
- [x] 3.4 Add `frame_error::extract_request_id` and use it in unix + windows transports so deserialization errors carry the originating `requestId`.
- [x] 3.5 Fix `LocalBrokerConnection` to `rejectAll` on an unmatched error frame.
- [x] 3.6 Make `TrayOptions.icon` optional in the TS `@opentray/spec` package.

## 4. Verification

- [x] 4.1 Rust test: a `create-tray` frame without an icon deserializes successfully.
- [x] 4.2 Rust test: `extract_request_id` recovers the requestId from a malformed frame.
- [x] 4.3 TS test: `createTray({ trayId, title })` without an icon resolves (regression for issue #3).
- [x] 4.4 Full suites green: `cargo test` (16 binaries, 0 fail), `vitest` (81/81), `tsc --noEmit` clean.

## 5. Self-Review

- [x] 5.1 The core intent — `createTray` never hangs — holds: icon is optional and errors correlate.
- [x] 5.2 Documented gaps: none for this fix; macOS/Windows process-title and kernel cleanup remain from the prior change.
