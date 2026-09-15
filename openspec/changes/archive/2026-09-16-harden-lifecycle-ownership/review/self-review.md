# harden-lifecycle-ownership — Self Review

## What this change delivers

Six lifecycle-ownership hardenings (D1–D5) plus the walkthrough root-cause round (D6 falsified, D7 delivered), all in service of one Owner symptom: a generated URL app whose toolbar went dead until a Dock activation.

1. **D1 owner-stamped locks** — bundle and launch locks (`packages/packaging/src/owner-stamped-lock.ts`) carry PID+token, validate by read-back, reclaim dead owners with hard-link content-addressed arbitration, and release only on token match. kill -9 anywhere never wedges a start.
2. **D2 owner-typed destroy** — the extension registry, view teardown, and the kernel (`require_owned_tray`) all validate the owner tuple; a late cleanup cannot destroy a newer same-tray session (`DestroyOutcome::{Removed,Vacant,Superseded}`).
3. **D3 connection-death terminal state** — `LocalBrokerConnection.markDead` rejects every pending await exactly once, the orchestration layer cancels resyncs and surfaces `onConnectionDead`, and generated entries exit non-zero instead of serving a dead shell.
4. **D4 appId endpoints** — `callerLabel` derives from `explicit > appId slug > npm_package_name > argv[1]`; display names never become path segments; one app, one endpoint, across every launch method.
5. **D5 bootstrap observability** — seven milestone records through one serial append queue with a bounded, counted, lossy output channel (dual-channel log queue, 256 KiB cap, marker-inclusive).
6. **D7 channel push producer** (the walkthrough root cause) — host-bound channel events and document-navigation closes now push through the extension EventPort at the native ipc handler / navigation hook instead of riding only the next command response; the 16 ms drain had been the accidental pump, and its D19 retirement made idle delivery latency infinite. Channel payloads never drop: the authoritative host outbox retains any record the port cannot guarantee (oversized, retry overflow, revoked/absent port) and the command-response flush remains the fallback. Every exit of postMessage/close/destroy — success, registry typed-error, parameter typed-fail — submits before returning (R6 P1 closure).

D6 (App Nap beginActivity + CreateWebview re-assert) stays as defense-in-depth with corrected comments: the walkthrough never loaded the rebuilt dylib, because `OPENTRAY_EXT_PATH` is ignored for package-declared extensions (facade-resolved absolute node_modules path wins). That environment fact is recorded in `plans/plan.md` and the walkthrough script now deploys the dylib explicitly.

## Evidence chain

- Codex review rounds R1–R7 (`review/codex-toolbar-r{1..7}-report.md`): 5.5 → 6.5 → 7.5 → 6.5 → 9.0 (GO for D1–D6) → 7.4 (R6 NEEDS-WORK: typed-fail submit gap) → **9.5 (R7 GO, no blockers)**.
- macOS: workspace Rust 369/370/370 across rounds (final 370 with the navigation twin), ext-webview 177/177 twice, JS suites green (ext-webview 78, opentray 132, create-core 225, packaging 34), repo baseline 16 tests + schema valid.
- Windows real host (aarch64, LAN ssh): ext-webview 180 → 184 → 186/186 across rounds, including both new twins.
- Owner walkthrough (5.3): navigate/back/forward/reload immediate without Dock activation; toolbar right-click reload restores the address bar and the channel self-heals; toolbar context menu suppressed except text-entry elements.

## Residuals (recorded, non-blocking)

- Release owner-lock TOCTOU and unattributed multi-legacy-carrier ambiguity (R2 P2, unchanged).
- Shell-server output ring per-record bound; milestone chain has no wall-clock timeout (declared bounded-lossy contract).
- Channel messages beyond the hub's 64 KiB single-record cap retain the pre-fix behavior (response-flush only) — documented in the event-port classification table.
- R7 note: the destroy-unknown-id twin exercises destroy's idempotent-success exit, not its `Err` arm; the arm is covered by source construction on both platforms.
