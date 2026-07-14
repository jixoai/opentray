## 1. Alignment / Investigation

- [x] 1.1 Record the failed Darwin release jobs and locate the mismatch between the macOS `WindowCapabilities` constructor and DTO definition.
- [x] 1.2 Confirm this is a non-breaking completion of the existing common `resizable` contract, not a new platform feature.

## 2. BDD Contract

- [x] 2.1 Scenario: Given macOS reports WebView capabilities When the DTO is serialized Then it includes the required common `resizable: true` field.
- [x] 2.2 Scenario: Given the Darwin WebView release artifact compiles When its capability constructor is checked Then no platform-only DTO field is missing.

## 3. Implementation

- [ ] 3.1 Run `bun run openspec:vision -- validate fix-macos-resizable-capability`, commit this plan, spec, and tasks before product code.
- [ ] 3.2 Add the missing macOS `WindowCapabilities.resizable` field beside the existing common resize capability.
- [ ] 3.3 Add focused macOS source-level coverage for the serialized common capability field where the local test surface can reach it.
- [ ] 3.4 Update the durable agent law for common native capability DTO parity.
- [ ] 3.5 Commit the implementation, test, task state, and only current-context evidence together.

## 4. Verification

- [ ] 4.1 Run the narrow local Rust test/build surface available on Windows and `git diff --check`.
- [ ] 4.2 Push the repair and confirm the Darwin arm64 and x64 WebView release artifact jobs succeed.
- [ ] 4.3 Confirm the release workflow versions and publishes the pending stable packages.

## 5. Self-Review Loop

- [ ] 5.1 Generate `review/self-review.md` comparing the DTO repair and CI evidence to `plans/plan.md`.
- [ ] 5.2 Generate `review/self-review.html` with release-job evidence.
- [ ] 5.3 Persist review state only if a real unresolved recurrence requires another loop.
- [ ] 5.4 Archive after release evidence and `bun run openspec:vision -- check fix-macos-resizable-capability` pass.
