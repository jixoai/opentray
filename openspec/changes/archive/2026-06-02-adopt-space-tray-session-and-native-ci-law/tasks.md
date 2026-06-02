## 1. Alignment / Investigation

- [x] 1.1 Confirm the latest `plans/plan.md` reflects the relevant code survey, existing OpenSpec survey, GitHub Marketplace Actions research, and user Q&A.
- [x] 1.2 Confirm the current repo truth: public TS API still uses `Surface`, daemon/session health still exposes lease vocabulary, and `.github/workflows/release.yml` already has a native artifact matrix but lacks recorded Marketplace Action selection law.
- [x] 1.3 Confirm with the user whether `Surface` should be renamed to `Space` everywhere, including Rust kernel/protocol field names, or only public TypeScript/docs first. Decision: new public API/protocol/docs use `Space`; Rust keeps explicitly internal `Lease` and backend `SurfaceProjection` compatibility where they are still implementation details.
- [x] 1.4 Confirm with the user whether `SpaceOptions` should use `id` or `spaceId` as the primary input field. Decision: input uses ergonomic `id`; refs/events/health use explicit `spaceId`.
- [x] 1.5 Confirm whether alpha compatibility aliases such as `createSurface` may remain temporarily, and if so what deprecation wording is acceptable. Decision: keep deprecated aliases only as migration shims that delegate to `createSpace`.
- [x] 1.6 Confirm whether every CI target must use native GitHub hosted runners, or whether a documented fallback is acceptable for unavailable ARM runners. Decision: native runner matrix is the default law; cross-build remains documented fallback only for future daemon-only or non-GUI atoms.
- [x] 1.7 Confirm each task checkbox will be updated only by the agent that completed and verified that task in the current working context.

## 2. BDD Contract

- [x] 2.1 Add or update TypeScript SDK tests proving `createSpace` resolves a broker-created `SpaceRef`.
- [x] 2.2 Add or update TypeScript SDK tests proving deprecated `createSurface` aliases, if retained, delegate to the same request path and do not create a second concept.
- [x] 2.3 Add or update protocol/spec tests proving `SpaceOptions` uses the approved identity field and does not require `appId` as the primary identifier.
- [x] 2.4 Add or update daemon health tests proving active connections are reported as sessions and PID/endpoint/package/protocol metadata remain visible.
- [x] 2.5 Add or update event-routing tests proving tray events route by `(session authority, spaceId, trayId, itemId)` and do not broadcast unknown native events.
- [x] 2.6 Add or update release workflow tests or static checks proving release native artifacts are staged from GitHub Actions artifacts, not local build outputs.
- [x] 2.7 Add or update workflow/static checks proving Rust setup/cache/artifact transport use maintained Actions and do not rely on hand-rolled install/cache/artifact shell code.
- [x] 2.8 Add or update package validation checks proving daemon and extension artifacts are staged into separate platform package atoms.

## 3. OpenSpec Gate Before Apply

- [x] 3.1 Run `bun run openspec:vision -- validate adopt-space-tray-session-and-native-ci-law`.
- [ ] 3.2 Run `bun run openspec:vision -- commit-check adopt-space-tray-session-and-native-ci-law --phase research-plan` before product-code work starts. Not recoverable in this working tree because implementation already started before this checkpoint.
- [ ] 3.3 Commit the ready OpenSpec artifacts for this change before implementation, unless the user explicitly asks to continue without committing. Not performed because the user asked to continue implementation directly.

## 4. Implementation - Space / Tray / Session Law

- [x] 4.1 Update `@opentray/spec` TypeScript public types from `Surface*` toward `Space*` and from public `Lease*` exposure toward `Session*` according to the confirmed migration scope.
- [x] 4.2 Update Rust `opentray-spec` and `opentray-core` naming according to the confirmed migration scope without weakening ownership checks.
- [x] 4.3 Update broker transport frame handling so create/default commands and returned refs use space vocabulary where the approved protocol scope requires it.
- [x] 4.4 Update `packages/cli` SDK exports to provide `createSpace`, `SpaceHandle`, `SpaceRef`, and session-oriented health surfaces.
- [x] 4.5 Implement deprecated compatibility aliases only if approved; mark them clearly and route them through the new space API.
- [x] 4.6 Update daemon health output and structured health frames so the public connection list is session-oriented while any remaining lease id is diagnostic only.
- [x] 4.7 Update examples, README content, and user-facing skill/docs so humans validate `Space / Tray / Session`, not `Surface / Lease`.
- [x] 4.8 Add concise intent comments only at critical migration points where an internal `Lease` name remains to explain why it is not public law.

## 5. Implementation - GitHub CI Native Binary Law

- [x] 5.1 Select the final Rust setup/cache Action shape: either `actions-rust-lang/setup-rust-toolchain` with cache enabled or `dtolnay/rust-toolchain` plus `Swatinem/rust-cache`.
- [x] 5.2 Update `.github/workflows/release.yml` so native build jobs use the selected maintained Rust setup/cache Actions.
- [x] 5.3 Keep `actions/upload-artifact` and `actions/download-artifact` as the cross-job artifact transport for native binaries.
- [x] 5.4 Add any required platform dependency setup for WebView builds while keeping the daemon and extension artifact paths independent. Current macOS WebView build uses platform frameworks through crate dependencies; Linux and Windows extension artifacts are explicit unsupported-runtime stubs in this stage.
- [x] 5.5 Add workflow checks or scripts that reject release staging from local native build outputs.
- [x] 5.6 Keep `opentray-bin` and `opentray-ext-webview` build/staging independent; do not reintroduce WebView linkage into the daemon.
- [x] 5.7 Update release-pipeline docs/spec notes to explain rejected Actions: Tauri app build Actions, GitHub Release binary upload Actions, and default `cross` for WebView GUI artifacts.

## 6. Verification

- [x] 6.1 Run targeted TypeScript tests for SDK/protocol naming changes.
- [x] 6.2 Run targeted Rust tests for kernel/session/event routing changes.
- [x] 6.3 Run workflow/static tests for native artifact staging and Action selection.
- [x] 6.4 Run `pnpm run build` after implementation changes that affect published TypeScript packages.
- [x] 6.5 Run `cargo build --release -p opentray-bin -p opentray-ext-webview` only as local smoke evidence, not as release input.
- [x] 6.6 On macOS, inspect local linkage with `otool -L` to verify the daemon still does not link WebView runtime while the WebView dynamic library does.
- [x] 6.7 Run `git diff --check`.
- [x] 6.8 Run `bun run openspec:vision -- validate adopt-space-tray-session-and-native-ci-law`.
- [x] 6.9 Run `bun run openspec:vision -- check adopt-space-tray-session-and-native-ci-law`.

## 7. Self-Review Loop

- [x] 7.1 Generate `review/self-review.md` comparing implementation against `plans/plan.md`.
- [x] 7.2 Generate `review/self-review.html` or an equivalent structured evidence artifact only if this change introduces visual/interaction evidence that needs presentation.
- [ ] 7.3 If the review updates OpenSpec artifacts or reopens tasks, commit those artifact changes before the next apply loop.
- [x] 7.4 If the review enters a real loop, run `bun run openspec:vision -- review-state adopt-space-tray-session-and-native-ci-law` to persist iteration and recurrence state. Not needed: review exited without loop.
- [x] 7.5 If review cannot exit normally, run `bun run openspec:vision -- handoff adopt-space-tray-session-and-native-ci-law` and commit the handoff evidence before returning to user discussion. Not needed: review exited normally.
- [ ] 7.6 If review exits normally, run `openspec archive adopt-space-tray-session-and-native-ci-law` and commit the archive result.

## 8. Git Evidence

- [ ] 8.1 Commit OpenSpec artifacts before product-code work starts.
- [ ] 8.2 Commit implementation and matching completed task checkboxes together.
- [ ] 8.3 Commit self-review OpenSpec updates before any additional apply loop.
- [ ] 8.4 Commit archive output after normal archive.
