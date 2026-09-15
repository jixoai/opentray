# OpenTray `harden-lifecycle-ownership` R3 Review

## Verdict

**NEEDS-WORK** — **7.5/10**, up from R2 **6.5/10** (+1.0).

The two R2 fixes improve the actual race behavior, but the release gate is not
clear: foreign extension dispatch is not exposed with the required stable error
code, and the new serialized log queue has no bounded policy for sustained PTY
or pipe output.

## P1-1: Legacy `Destroy` owner bypass

### Behavior: PASS

`Kernel::ext_command` and `ext_command_with_host` now require the transport
`session_id` and call `require_owned_tray`
(`crates/opentray-core/src/kernel.rs:317-345`). `BrokerKernel` forwards the real
session id (`crates/opentray-core/src/broker.rs:415-448`). A repository-wide
search found no remaining extension-command caller that omits this argument;
the only remaining `require_tray` use is the ownership helper itself. Owner
dispatch still reaches the extension registry, while a foreign session is
rejected before extension code or native legacy `Destroy` runs.

The revised EventPort tests correctly separate non-owner rejection from owner
routing (`crates/opentray-bin/src/extension_events.rs:764-824`). The rejected
case observes no event on either session, and the owner case retains mirrored
and pushed routing.

### Protocol: NOT CLOSED (P1)

`KernelError::SessionMismatch` falls through `kernel_error()` to
`ServerFrame::Error { code: "kernel-error" }`
(`crates/opentray-core/src/broker.rs:549-560`). The R3 delta requires a
consumable session-mismatch error (`openspec/changes/harden-lifecycle-ownership/specs/kernel-runtime/spec.md:27-34`), and existing broker tests already use the stable `session-mismatch`
code for app ownership failures. Consumers cannot safely distinguish this
authorization failure by parsing the human message.

Required fix: map `KernelError::SessionMismatch` to code `session-mismatch`,
then add an exact-code `ExtCommand` broker test asserting request correlation,
zero extension dispatch, and unchanged owner state.

## P1-2: Generated `app.log` ordering and durability

### Normal path: PASS

Both generated entries embed the same serial queue
(`packages/create/packages/core/src/log-queue.ts:30-50`). Each append is chained
after the previous append; `write.catch(() => {})` keeps the tail alive after a
failed write while an awaiting caller still receives the original rejection.
Thus fire-and-forget writes have a rejection handler, and awaited milestone
writes remain failure-visible. The toolbar carrier uses the same sink through
`options.event` (`packages/create/packages/core/src/toolbar-carrier.ts:66-90`).

All explicit generated-entry exits flush the tail before `process.exit`: yield,
connection-dead, quit, and top-level startup failure in both templates
(`entry-template.ts:277-300,544-587`; `url-entry-template.ts:133-155,239-270`).
The randomized append-jitter test passed and verifies the seven-record healthy
narrative with no duplicates (`entry-bootstrap.test.ts:369-425`).

### Heavy output: NOT CLOSED (new P1 residual)

PTY, stdout, and stderr chunks are each submitted as one append
(`packages/create/packages/core/src/entry-template.ts:198-223`). The queue has
no byte/record cap, coalescing, drop policy, or backpressure. A sustained noisy
child can therefore accumulate an unbounded chain, delay later bootstrap
records, and make exit-time `flushLogQueue()` latency/memory consumption
unbounded. The current jitter test does not exercise this case.

Required fix: define a bounded output policy (chunk coalescing plus a byte cap,
or an explicitly lossy output channel separate from milestone records) and add
a stress test proving milestone ordering and bounded shutdown behavior under
heavy PTY/pipe output.

## d19 EventPort compatibility

No semantic conflict was found. d19 binds asynchronous event sources to the
owner session and preserves pushed-by-owner routing; it does not require a
foreign session to issue commands against another session's tray. The R3
kernel delta strengthens command admission at the Core boundary, while the
owner-dispatch test preserves d19's mirrored/pushed event behavior. The prior
cross-session command test represented the older, now superseded admission
assumption rather than an EventPort routing law.

## Standards / residual findings

- The new queue implementation is internally consistent, but the generated
  `entry-template.ts` and `url-entry-template.ts` intent inventories now list
  eight and seven orthogonal intents, respectively, exceeding the project-wide
  five-intent limit in `AGENTS.md`.
- `extension_events.rs` retains judgement-level duplicated delivery/error-log
  logic between `deliver` and `deliver_bound`; not a release blocker.
- R2-scoped P2 residuals remain recorded and were not upgraded: owner-lock
  release TOCTOU and unattributed legacy-carrier ambiguity.

## Verification

Independently run:

- `pnpm --filter @create-opentray/core exec vitest run src/entry-bootstrap.test.ts src/toolbar-carrier.test.ts` — **2 files, 13 tests passed**.
- `git diff --check 456b8e4d..HEAD` — passed.
- Static call-surface and error-mapping inspection across Core, broker, bin, and
  both generated templates — completed.

The brief-supplied `mbx test -p opentray-core -p opentray-bin`, WebView 169-test
run, Windows target check, and create-core 16-file/209-test baseline were
treated as supplied evidence, not independently reproduced. Rust was not run
in this review because the machine was not in a Herdr-managed pane and swap
was already critically full; no native GUI or Windows acceptance is claimed.

## Release decision

**Do not publish yet.** Close the stable `session-mismatch` mapping/test and
bound or explicitly separate high-volume child-output logging, then rerun the
Rust and platform gates. The R2 behavioral fixes are otherwise directionally
correct.
