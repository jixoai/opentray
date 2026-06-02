## ADDED Requirements

### Requirement: Official extension runtime ownership SHALL stay inside the extension artifact

The daemon SHALL treat official dynamic extensions as self-contained runtime atoms. For an official extension, command payload parsing, native runtime setup, and returned event payload shape SHALL live inside the extension library artifact rather than the daemon binary.

`opentray-core` and `opentray-bin` SHALL know only the generic extension ABI and scoped dispatch law. They SHALL NOT keep official-extension-specific command parsers or native runtime builders.

#### Scenario: Daemon forwards WebView command bytes without product parsing

- **GIVEN** a client sends an `ext-command` for `ext: "webview"`
- **WHEN** the daemon dispatches that command through the dynamic extension ABI
- **THEN** it forwards the scoped envelope to the loaded library without parsing `show`, `hide`, `navigate`, `evaluate`, or `postMessage` fields itself
- **AND** the returned scoped events come from the extension library rather than a daemon-side WebView adapter.

### Requirement: Native runtime linkage SHALL belong to the owning extension artifact

When an official extension needs a platform-native runtime such as WebKit or `wry`, that dependency SHALL link into the extension artifact rather than the broker binary. The broker MAY retain generic host callbacks for future privileged facilities, but the regular WebView path SHALL NOT require an official-extension-specific daemon capability to create its runtime.

#### Scenario: macOS linkage shows WebKit on the extension dylib

- **GIVEN** macOS release artifacts are built for the daemon and the official WebView extension
- **WHEN** their linkage tables are inspected
- **THEN** the `opentray` binary does not link `WebKit.framework`
- **AND** `libopentray_ext_webview.dylib` does link `WebKit.framework`.

## MODIFIED Requirements

### Requirement: Dynamic extension ABI SHALL be stable and C-compatible

The extension ABI SHALL use `extern "C"` functions and C-compatible structures for dynamic libraries. Rust-specific types SHALL NOT cross the dynamic library boundary. JSON command payloads MAY be used inside ABI functions to keep the binary ABI stable while TypeScript/Rust schemas evolve.

The ABI SHALL be strong enough for an official extension to own its entire native runtime internally. The daemon SHALL NOT pass Rust event-loop, window, backend, WebView, or official-extension-specific parser objects across the ABI boundary in order to make a released extension function.

#### Scenario: Dynamic library exports required symbols

- **GIVEN** an extension shared library is loaded
- **WHEN** the extension host validates it
- **THEN** it requires init, command, and deinit symbols
- **AND** it rejects the library with a structured error if any required symbol is missing.
