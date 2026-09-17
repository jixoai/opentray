# Batch E — GUI real-machine acceptance (darwin leg)

Date: 2026-09-17/18 (host time). Host: macOS (darwin, arm64), live WindowServer
GUI session, branch `add-ext-dialog-sound`, HEAD `5c25f86f` before this batch.
Probe: `crates/opentray-ext-dialog/examples/acceptance_probe.rs` (new) —
drives the FULL dialog matrix through the real exported extension ABI
(`opentray_ext_command_v2` / `opentray_ext_poll_owner_v1` /
`opentray_ext_session_closed` / deferred completion port / `opentray_ext_init`
/ `opentray_ext_deinit`) with owner-thread dispatch and synthetic dismissal
events. Raw machine evidence: `/tmp/extdlg-probe/acceptance-evidence.json`.

## Commands and exit codes

```bash
cargo test -p opentray-ext-dialog                  # 35 passed; 0 failed (exit 0)
cargo run -p opentray-ext-dialog --example acceptance_probe   # PASS, exit 0 (4/4 runs stable, ~9.2s each)
cargo run -p opentray-ext-dialog --example modal_probe        # PASS 2/2 cases + ffi-end-to-end, exit 0 (re-verified this batch)
cargo check -p opentray-ext-dialog --target x86_64-pc-windows-msvc          # Finished, exit 0
cargo check -p opentray-ext-dialog --target x86_64-pc-windows-msvc --examples  # Finished, exit 0
# PATH prefix for cross target: $HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin
cargo clippy -p opentray-ext-dialog --all-targets  # 12 warnings == pre-change baseline (12); zero new
```

New crate test (review supplement, count-not-presence):
`tests::mixed_session_close_counts_zero_terminals_and_spares_other_sessions`
— stress 5/5 green, full suite 2x green after.

## Acceptance matrix results (all PASS)

```
== acceptance probe (darwin): PASS ==
  backend-dto                          PASS   # getBackend Immediate; darwin DTO frozen:
                                         commandLinks:false, expander:false, taskDialog:false,
                                         suppression:true, packageSemantics:true,
                                         mixedFileDirectorySelection:true, addToRecentControl:false
  message-3button-default-interleave   PASS  steps=116 endedBy=button-code(1001)
                                         terminal {response:1, suppressed:false}  (defaultId=1, non-first button)
                                         getBackendAnsweredWhileStepping: 5 (Immediate, darwin DTO)
  message-escape-cancel                PASS  steps=126 endedBy=forced-stop(-1001)
                                         terminal {response:2} == cancelId 2 (total non-button mapping)
                                         escKeyEndedDialog: false  -> FINDING below
  message-severity-x3                  PASS  info+warning+error each completed response 0
  suppression-flag                     PASS  first show suppressed flag live-read (false — keyboard
                                         toggle unreachable unattended); second show fresh checkbox
                                         (suppressed:false; state reported, never persisted)
  pickers-cancel                       PASS  pickFile-single(filters txt,md) / pickFile-multiple
                                         (filters:[] = all-files ABI normalization) / pickDirectory —
                                         all cancel-class stop -> terminal value null
  picksavepath-confirm                 PASS  cancel fallback -> null (Return unreachable unattended);
                                         canonicalization covered by cited unit + facade tests
  busy-rejection                       PASS  second show same scope: synchronous EXT_ERR_REJECTED,
                                         zeroed Immediate disposition, typed error
                                         {category:"dialog_session_busy", details.kind:"owner",
                                          sessionId:"e2e-busy"}; first dialog completed response 1;
                                         rejected show produced ZERO terminals
  session-close-revoke                 PASS  close while picker open: EXT_OK, exactly ONE
                                         cancel-branch (null) terminal, owner retired (no deadline)
  port-accounting                      PASS  REAL port counts (supplement #1):
                                         acceptedDeferred=13, portSubmitCalls=13, portSubmits=13,
                                         unique handles, set-equal; busyRejections=1
  deinit-with-live-modal               PASS  second instance: accepted 1 live modal, deinit ->
                                         portSubmits=0, event loop dequeues events after teardown
```

## Review supplements (batch B impl review R1)

1. **REAL port counts** — satisfied twice:
   - Real machine: the acceptance probe hosts the deferred completion port and
     counts every submit across the whole mixed run: 13 accepted deferred
     operations -> exactly 13 port submissions, 13 submit calls, unique
     handles, set-equal (`port-accounting` case above).
   - Crate level: new test `mixed_session_close_counts_zero_terminals_and_spares_other_sessions`
     (lib.rs) — a counting port across a mixed 3-record table proves
     already-settled records contribute ZERO submissions, closing one session
     spares the other session's records, and repeat close is a no-op.
2. **Non-returning deinit evidence** — the park loop is
   `#[cfg(target_os = "windows")]` in `opentray_ext_deinit` (no STA workers on
   darwin to leak). The decision is owned by the existing `settle_shutdown`
   tests: `failed_pin_with_leaked_workers_blocks_the_unload_path`,
   `successful_pin_defers_cleanup_to_process_exit`,
   `clean_shutdown_never_consults_the_pin_seam` (cited, not duplicated — per
   batch instructions). The darwin-side deinit boundary IS exercised live:
   `deinit-with-live-modal` (teardown without terminals, healthy loop after).

## Findings for the orchestrator (darwin)

- **P2 — keyboard ESC is dead on ABI-built alerts.** `build_alert`
  (src/macos/mod.rs) assigns `keyEquivalent("")` to every non-default button,
  which clears AppKit's automatic Escape binding on the cancel-titled button.
  Diagnostic matrix (temporary probe, 2026-09-17): a raw NSAlert with the auto
  binding intact dismisses via a real synthetic ESC keyDown (code
  1000+cancelIndex, repeatable); the same alert shape with build_alert's
  explicit assignment does NOT dismiss on ESC. Title-bar close / forced stop
  still map totally to cancelId (mapping law unaffected). Suggested follow-up:
  assign `"\u{1b}"` to the `cancelId` button instead of `""`.
- **Environmental keyboard boundary (not a product defect):** on this
  unattended agent session the app never becomes active
  (`activateIgnoringOtherApps` and the macOS 14+ async `activate()` both
  refused; `NSApp.isActive == false`, alert never key window), so synthetic
  Return / Tab / Space key events produce no effect in any configuration.
  ESC-with-auto-binding is the one delivering key path. Consequences for this
  batch: default-button evidence rides the button-activation return code
  (`stopModalWithCode(1000+idx)` — the internal mechanism real button clicks
  route through), suppression true-positive and save-panel confirmation were
  not synthetically reachable (documented in-probe, covered by cited tests).

## Adversarial race spot — cited, not duplicated (batch A owns these)

- Duplicate-terminal settle / one-shot CAS:
  `crates/opentray-core/src/operations.rs` —
  `settlement_is_a_one_shot_cas_for_the_matching_owner`,
  `ingress_validation_accepts_live_duplicates_but_rejects_foreign`.
- Wrong-owner / stale generation:
  `foreign_owners_and_pending_sessions_cannot_settle`,
  `stale_generation_submits_drop_without_settling`,
  `forged_and_retired_handles_are_unknown`.
- Wrong-owner purge: `purge_session_removes_pending_and_settled_operations`;
  broker-side zero-terminal close delivery:
  `crates/opentray-bin/src/deferred_port.rs` —
  `closing_session_drain_delivers_zero_terminal_frames_for_that_session`,
  `open_vs_revoke_never_resurrects_the_open_phase`,
  `submit_vs_revoke_never_mutates_the_queue_after_revoke`,
  `revoke_closes_the_submit_channel_permanently`.
- Facade commandLink degradation gate (typed rejection + zero dispatch
  frames): `packages/ext-dialog/src/index.test.ts` — "gates commandLink on
  the backend snapshot before dispatch (MessageBox fallback)".

## Remains Windows-only (for the orchestrator to relay)

- Real STA worker entry: COM `COINIT_APARTMENTTHREADED` worker bodies,
  `TDN_CREATED`-honest TaskDialog Accepted evidence, `IFileOpenDialog` /
  `IFileSaveDialog` real pickers (confirm + ERROR_CANCELLED), MessageBox
  position-mapped fallback.
- `dialog_worker_limit_reached` under real COM (cap-1/cap/cap+1 live), and
  real same-scope `dialog_session_busy` from the worker registry (registry
  cores are unit-tested cross-platform; live GUI behavior needs Windows).
- Join/pin diagnostics on a real leaked worker: 2s join, the
  `GetModuleHandleExW(FROM_ADDRESS)` self-pin, and the non-returning deinit
  park under `UnloadDecision::BlockUnload`.
- comctl32 v6 activation-context capability probe in a packaged
  (RT_MANIFEST) broker; commandLink/expander real rendering; win32 DTO
  projection from the live probe.
- The darwin P2 ESC finding above may warrant a cross-platform dismissal
  regression test once fixed.

## Process accounting

All processes started by this batch were short-lived children of the cargo
commands above (`cargo`, `rustc`, the two example binaries); every command
completed and returned its exit code inline. No daemons, servers, or
background processes were started; nothing to kill (verified with `ps` after
the final run — no `acceptance_probe`/`modal_probe`/cargo processes remain).
