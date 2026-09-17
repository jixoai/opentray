# Batch E — GUI real-machine acceptance (win32 leg)

Date: 2026-09-18. Host: real Windows machine `gaubeehonor` (Windows
10.0.26200.9457, AMD64, interactive session 1 + ssh service session 0),
branch `add-ext-dialog-sound`. Probe binary commit: `f98da29b`
(`crates/opentray-ext-dialog/examples/acceptance_probe_windows.rs`, new —
built `--release` on the host, 19.9s cold / ~2-5s incremental, exit 0).
Probe surface: the real exported extension ABI
(`opentray_ext_command_v2` / `opentray_ext_attach_deferred_completion_port_v1`
/ `opentray_ext_session_closed` / `opentray_ext_poll_owner_v1` /
`opentray_ext_init` / `opentray_ext_deinit`) with the probe main thread as
the broker dispatch thread; every dismissal is the production close vector
(session close -> WM_APP dispatcher -> worker-thread native dismissal); a
110s watchdog force-exits the process (killing any modal with it) if a
step wedges.

Raw machine evidence on the host (gaube user %TEMP% =
`C:\Users\gaube\AppData\Local\Temp`):

- `extdlg-probe\acceptance-evidence-windows.json` — the canonical clean
  matrix run (session 0, pickers skipped per the finding below):
  `status: PASS`, `runSeconds: 3.209`.
- `extdlg-probe\acceptance-evidence-windows-session1-crash.json` — the
  interactive-session (session 1) run frozen at the picker crash.
- `extdlg-probe-run*.log`, `extdlg-probe-diag*.log`, `extdlg-probe-s1.log`
  — full stdout/stderr captures incl. the worker entry-evidence lines.

## Commands and exit codes (host, via ssh)

```text
cargo build --release -p opentray-ext-dialog --example acceptance_probe_windows   # exit 0 (x4 incremental rebuilds all exit 0)
# matrix, full (sessions 0 and 1, two s0 runs): process dies 0xC0000005 (-1073741819)
#   at the FIRST picker dismissal — the P0 finding below (5/5 runs, deterministic)
OPENTRAY_DIALOG_PROBE_SKIP_PICKERS=1 acceptance_probe_windows.exe                 # MATRIX exit 0 — 10 PASS + 1 SKIPPED, ~3.2s
OPENTRAY_DIALOG_PROBE_PICKER_DIAG=1 (hold 700ms)                                  # exit -1073741819 (window B)
OPENTRAY_DIALOG_PROBE_PICKER_DIAG=1 OPENTRAY_DIALOG_PROBE_PICKER_HOLD_MS=2500     # exit -1073741819 (window B)
# session-1 scheduled-task run (schtasks /it, real logged-on desktop):            exit -1073741819 at the same point
# host-side baseline (Mac): cargo check -p opentray-ext-dialog --target x86_64-pc-windows-msvc --examples  # Finished, exit 0
```

## Which comctl6 path fired

The live `getBackend` DTO (through the real ABI, Immediate disposition)
reported `platform:"win32", taskDialog:false, commandLinks:false,
expander:false, suppression:true, packageSemantics:false,
mixedFileDirectorySelection:false, addToRecentControl:true` — the cargo-
built probe host has no RT_MANIFEST, so `TaskDialogIndirect` does not
resolve under the process-default activation context and **the MessageBox
fallback is the live message-dialog surface** (`worker N entered native
modal (MessageBox-entry)` for all 9 message dialogs; severity icons and
the OK/OK-Cancel/Yes-No-Cancel position sets ride `MessageBoxW`). The
TaskDialog/TDN_CREATED surface itself therefore did NOT fire in this host
process; what IS proven live on the fallback branch: the MessageBox-entry
Accepted handshake, the typed `dialog_capability_unavailable` gate for
TaskDialog-exclusive requests, the suppressed:false honest degradation,
and the fallback's WM_CLOSE dismissal mapping through cancelId. The
comctl6 branch (TDN_CREATED handshake, command links, expander) remains
broker-manifest-only evidence (see "Remains open").

## Acceptance matrix results (canonical run: 10 PASS, 1 SKIPPED, exit 0)

```
== acceptance probe (win32): PASS ==
  backend-dto                        PASS  getBackend Immediate; live DTO recorded (above)
  message-show-dismiss               PASS  3-button defaultId=1 cancelId=2: show answers
                                      Deferred with handle echo (entry handshake wait ~1ms);
                                      one getBackend Immediate while open; session close ->
                                      exactly ONE terminal {response:2, suppressed:false}
                                      (WM_CLOSE -> IDCANCEL -> cancelId; P0-6 mapping)
  busy-rejection                     PASS  second show same scope: synchronous EXT_ERR_REJECTED,
                                      zeroed Immediate disposition, typed
                                      {category:"dialog_session_busy", details.kind:"owner",
                                       appId/trayId/sessionId echo}; first dialog completed
                                      {response:1}; trespasser produced ZERO terminals
  interleave-while-open              PASS  5/5 getBackend Immediate while a dialog open,
                                      max latency < 1ms (the STA worker never blocks dispatch)
  message-severity-x3                PASS  info+warning+error each completed {response:0}
  suppression-fallback-flag          PASS  suppressionLabel terminal {response:0,
                                      suppressed:false} — MessageBox cannot render the
                                      checkbox; false is the documented degradation
  pickers-cancel-session-close       SKIPPED (finding P0 below; crash-isolation run)
  capability-gate                    PASS  fallback branch: 4-button AND commandLink shows
                                      reject synchronously, zeroed disposition, typed
                                      {category:"dialog_capability_unavailable",
                                       details:{kind:"feature", platform:"win32"}}; zero
                                      port submits for both rejected handles (native-side
                                      envelope evidence; the caller-facing spelling is the
                                      facade vitest gate, cited)
  sta-worker-lifecycle               PASS  poll_owner reports nothing scheduled while a
                                      dialog is open (win32 law); after the terminal a
                                      same-scope re-show is ACCEPTED again (worker slot
                                      self-release observed through the public ABI, retry
                                      loop ~1 busy answer); deinit with no live workers
                                      returned in < 3s (Clean settlement)
  port-accounting                    PASS  acceptedDeferred=9, portSubmitCalls=9,
                                      portSubmits=9, unique handles, set-equal;
                                      busyRejections=1; ZERO submits for all 3
                                      synchronously rejected handles (review supplement 1)
  deinit-with-live-modal             PASS  second instance, live modal accepted; deinit
                                      RETURNED (close-all + bounded join): host log
                                      "deinit joined 1 dialog worker(s), leaked 0, module
                                      pin applied: false"; the worker submitted exactly ONE
                                      cancel-branch terminal {response:0, suppressed:false}
                                      from its own thread inside the join
```

Honest platform difference recorded in-probe: darwin's deinit-with-live-modal
submits ZERO terminals (owner thread tears down); win32's deinit posts
close-all and JOINS the worker, whose own thread settles its one terminal —
both laws held exactly as designed on their platforms.

## FINDING P0 — picker dismissal access-violates the process (5/5, both session classes)

The first `pickFile` dismissal kills the process with 0xC0000005
(-1073741819) every time; `pickFile`-multiple and `pickDirectory` never got
a turn. Diagnosis chain (all through the probe's diagnostic mode, logs
cited above):

1. **Not inside `IFileDialog::Show` itself**: entry evidence
   (`worker 0 entered native modal (IFileDialog::Show-entry)`) fires, then
   "window A" — a 700ms and a 2500ms hold with NO close in flight —
   survives in full. Show's pump is stable.
2. **The fault is the close projection**: immediately after
   `opentray_ext_session_closed` posts the WM_APP close ("window B"), the
   process dies before any terminal. The only native code executing is the
   worker's dispatcher WndProc ->
   `close_from_worker_thread` (`src/windows/worker.rs`) ->
   `close_on_worker_thread` (`src/windows/file_dialog.rs`) ->
   `IFileDialog::Close(HRESULT(0))`, reentered from a WndProc dispatched by
   Show's own pump, on a dialog with no `IFileDialogEvents` sink advised.
3. **Not an initialization race**: 700ms and 2500ms holds both crash.
4. **Not a session-0 artifact**: reproduced identically in the REAL
   interactive desktop session (session 1, via an `/IT` scheduled task,
   `explorer.exe` session — the session class the real broker runs in).
   Message boxes visibly presented and dismissed there (entry wait ~2ms,
   dismissal ~420ms — dialogs really render in session 1).
5. MessageBox-family close via the SAME dispatcher (EnumThreadWindows +
   WM_CLOSE) is clean: 9+ live dismissals across runs, zero faults.

Contract citation (learn.microsoft.com, IFileDialog::Close): "An
application can call this method **from a callback method or function**
while the dialog is open." Our call site is outside that contract — an
unrelated message-only window's WndProc, reentrant inside the modal pump.

**Impact:** any picker left open when a session closes (or the broker
deinits) kills the whole broker process on Windows. Not probe-only: this
is the production `session_closed`/`shutdown` vector.

**Recommended fix (product code, out of this batch's probe file surface):**
dismiss the file dialog with the already-proven MessageBox arm mechanism —
enumerate the worker thread's non-dispatcher windows
(`EnumThreadWindows`, same as `close_message_box_on_worker_thread`) and
post `WM_CLOSE` (the common dialog cancels: `Show` returns
`ERROR_CANCELLED` -> the existing null branch) — or `Advise` an
`IFileDialogEvents` sink and `Close` from a callback. Re-run this probe
without `OPENTRAY_DIALOG_PROBE_SKIP_PICKERS` to verify (the case is
already written; it must produce exactly one `null` terminal per picker).

## Not drivable on a healthy host (cited, per batch instructions)

- The 3s entry-abandon timeout and the failed-pin non-returning deinit park
  need a STALLED worker; owned by `state.rs` `settle_shutdown` tests:
  `failed_pin_with_leaked_workers_blocks_the_unload_path`,
  `successful_pin_defers_cleanup_to_process_exit`,
  `clean_shutdown_never_consults_the_pin_seam`. The live paths that ARE
  observable were exercised: normal worker exit + slot self-release, and
  the Clean-settlement deinit (joined 1 / leaked 0 / no pin consulted).
- comctl6 TaskDialog surface (TDN_CREATED Accepted handshake, command
  links, expander rendering) requires an RT_MANIFEST host (the broker);
  this probe host honestly degrades and proved the gate + fallback side.

## Process accounting

Every probe invocation terminated (exit codes captured via PowerShell
`$LASTEXITCODE`; the first `cmd` capture showed a parse-time `%ERRORLEVEL%`
artifact — corrected for all recorded runs). Post-run `tasklist` filtered
locally: no `acceptance_probe_windows` / `opentray` / `cargo` / `rustc`
processes remain (only unrelated `HnTrustCircleService.exe` matches the
filter). The session-1 scheduled task `extdlg-s1` was deleted
(`schtasks /delete /f`, success) and its wrapper `run-probe-s1.cmd`
removed from the worktree. No daemons or servers started; the crashing
runs' modals died with their processes (process death closes owned
windows). Windows worktree left at `f98da29b`; Mac commits:
`702a5b65`, `e1ad9994`, `bc665b63`, `f98da29b` (probe + evidence).
