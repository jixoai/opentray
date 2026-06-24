# Self-Review — Collapse Shared Surface and Pin Broker to Caller

## Intent recap

The change had two goals: (1) make an OpenTray-backed broker process
identifiable to its real owner in the task manager so operators do not mis-kill
it, and (2) remove the shared-surface / multi-session aggregation model from the
kernel because it added complexity for a feature whose value did not justify the
cost. The confirmed strategy was a hard break of multi-session aggregation plus
a dedicated per-caller broker process carrying a caller-derived identity,
explicitly rejecting the `lib-*` FFI embedding path.

## What was implemented

### TypeScript (`@opentray/spec` + `opentray`)

- `BrokerEndpointIdentity` gained a `callerLabel` component with sanitization
  (`sanitizeCallerLabel`: lowercase alphanumerics + hyphens, length-capped, neutral
  `opentray` fallback). Endpoint name, state root, unix socket path, windows pipe
  name, and a new `formatBrokerProcessTitle` helper all incorporate it.
- `resolveDaemonPaths` threads the caller label through `stateRoot`, `runtimeDir`,
  `endpoint`, `pidFile`, `lockFile`, `readyFile` — two callers of the same version
  now resolve distinct runtime directories and endpoints.
- New `caller-label.ts` derives the label with the documented precedence
  (explicit > `npm_package_name` > script basename > neutral default).
- `connectLocalBroker` accepts and exposes `callerLabel`; the spawn path injects
  `--caller-label` into the broker CLI args and `OPENTRAY_DAEMON_CALLER_LABEL`
  into the environment.

### Rust (`opentray-spec`, `opentray-bin`, `opentray-core`)

- `BrokerEndpointIdentity::new` takes a caller label; `sanitize_caller_label`
  mirrors the TS side. `DaemonHealth` gained a `callerLabel` field.
- `parse_broker_options` parses `--caller-label` with flag > env > neutral default
  precedence.
- Both transports (`unix_transport`, `windows_transport`) write `callerLabel` into
  `ready.json` and `daemon-health`.
- Single-session enforcement: the native broker (`main.rs`) and the Linux blocking
  broker (`unix_transport.rs`) reject a second connection when a session is already
  initialized, returning `OPENTRAY_BROKER_SINGLE_SESSION`.
- The kernel doc now states the single-session honest pass-through invariant. The
  projection code is unchanged because, with one session enforced at the broker,
  it is already single-owner honest; removing the `LeaseMismatch` machinery was
  judged high-risk/low-payoff and left as vestigial-but-harmless.

## Evidence

- `@opentray/spec` + `opentray`: **80/80 pass** under vitest (excluding the
  unrelated `.worktree` branch copies). New tests cover caller-scoped endpoints,
  sanitization, precedence, and per-caller isolation.
- Rust: **142 tests pass, 0 fail** across the workspace, including 3 new
  `broker_options_*` caller-label parse tests and updated spec identity tests.
- `tsc --noEmit` clean for both `packages/spec` and `packages/cli`
  (including `exactOptionalPropertyTypes`).
- `openspec:vision validate` → valid.

## Gaps and honest limitations

These items remain unchecked in `tasks.md` and are documented here rather than
hidden:

1. **Cross-process e2e (4.3) and process-name e2e on Linux (4.4) were not run.**
   These require spawning two real broker processes on a target platform and
   inspecting `ps`/Activity Manager. They are covered by unit-level evidence
   (distinct endpoints, single-session rejection logic, label parsing) but not by
   a live two-broker run in this session. This is the weakest part of the
   verification.
2. **Process title on macOS/Windows is not set programmatically.** The visible
   process name relies on the spawned argv0 on Linux. On macOS Activity Manager
   reflects the binary file name, which is not renamed here; the caller label is
   instead surfaced via the endpoint, runtime directory, ready.json, and
   daemon-health. A binary-rename strategy for macOS/Windows is documented in the
   plan as a future implementation detail, not completed.
3. **The kernel `LeaseMismatch` / non-owner isolation code was not deleted.** The
   spec removed the aggregation *requirement*; the code is now unreachable in the
   multi-session sense (the broker rejects a second session) but remains as
   defensive ownership checking. A fuller cleanup is possible but deferred to
   avoid a large, risky refactor of the kernel ownership model in this change.

## Verdict

The change achieves its core intent: per-caller broker isolation with
caller-derived identity, removing shared surface as the broker model, with the
FFI path explicitly rejected. The honest gaps are runtime e2e verification and
macOS/Windows process-title renaming, both documented above and in `tasks.md`.
