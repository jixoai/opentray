# OpenTray `add-ext-dialog` Batch A implementation review

- Review scope: `439b9200..0479d465` (11 commits, 31 files)
- Review role: implementation-only review; R1-R7 design review is treated as the frozen contract
- Contract sources read: `design-reference.md` sections 5.1, 5.2, 5.5, 5.7, 6.1, 6.4, 7.5; tasks 2.1-2.6; R7 P1-3/P1-4
- Verdict: **NO-GO for Batch B**
- Score: **3.8/10**

## Executive conclusion

The Rust registry and the low-level Node transport contain much of the intended
DeferredOperation scaffolding, but the public SDK path cannot consume a successful
deferred operation. Several lifecycle and wire-contract gaps also remain. The checked
boxes in tasks 2.1-2.6 therefore overstate implementation closure. Batch B should not
start until the P0 and the blocking P1 items below are fixed and covered by tests.

## P0 blocking findings

### P0-1: public deferred SDK path rejects its own terminal frame

- Evidence: `packages/cli/src/local-broker.ts:527-547` deliberately resolves an accepted
  request with an `ext-operation-terminal` frame. The public implementation at
  `packages/cli/src/client.ts:334-351` still requires `ext-command-result` and throws on
  every successful deferred terminal. `commandExtension()` delegates to that method at
  `packages/cli/src/client.ts:331-332`.
- Reproduction: `bun -e 'import { createTrayHandle } from "./packages/cli/src/client.ts"; const t={request: async()=>({type:"ext-operation-terminal",operationId:"0000000000000001",payload:{kind:"result",value:{ok:true}}})}; const h=createTrayHandle(t,"a","t"); h.requestExtension("dialog",{}).catch(e=>console.log(e.message));'`
  prints `expected ext-command-result for opentray-1, received ext-operation-terminal`.
- Impact: a real dialog/sound-style deferred command can be accepted and settled by the
  transport, but the exported `TrayHandle` rejects instead of returning the value. The
  existing `TrayExtension.request()`/`requestExtension()` type is also fixed to
  `ExtensionEnvelope[]` (`client.ts:64,337`), which cannot represent the frozen terminal
  JSON value. This makes the intended Batch C facade unable to use the Batch A API.
- Fix location: define one public result contract for immediate envelopes versus terminal
  values (or expose the terminal frame at the generic client boundary), update
  `requestExtension`, `commandExtension`, and `TrayExtensionContext.request`, and add a
  high-level `createTrayHandle` integration test for result and typed-error terminals.

## P1 blocking findings

### P1-1: DeferredPort phase and revoke/enqueue transitions are not atomic

- `crates/opentray-bin/src/deferred_port.rs:193-201` checks `PENDING`, releases the
  session mutex, then stores `OPEN`. `revoke()` at `:204-206` can set `REVOKED` between
  those operations, after which `bind_session_and_open` writes `OPEN` again.
- `submit_ffi` checks `OPEN` at `:109-113`, parses/validates, then locks and pushes at
  `:166-172`. Revoke can happen after the phase check and before the queue mutation, so a
  post-revoke terminal can still be enqueued. The wake-failure check does not close this
  race.
- This violates the frozen `PENDING -> OPEN -> REVOKED` and "revoke before cleanup;
  later submit never mutates a queue" laws. Existing tests (`deferred_port.rs:597-655`)
  are sequential and cannot expose either interleaving.
- Fix location: use a single lifecycle/queue critical section or a phase CAS plus a
  linearized enqueue check; add barrier-controlled open-vs-revoke and submit-vs-revoke
  race tests asserting no `OPEN` resurrection and no queue mutation after revoke.

### P1-2: close/Exit drains terminals before purging the closing session

- Native loop: `crates/opentray-bin/src/main.rs:903-907` calls
  `drain_deferred_terminals()` before `purge_session()` at `:916`.
- Blocking loop: `crates/opentray-bin/src/unix_transport.rs:280-291` has the same order.
- Section 5.7 ruling #7 requires close to revoke and purge with no terminal delivery. A record
  already queued before Exit can therefore settle and be written to the closing socket
  during the close response path. Revoke prevents new submits but does not remove queued
  records.
- Fix location: purge/suppress the closing session before any deferred drain, and add an
  Exit race regression test proving zero `ext-operation-terminal` frames for that session.

### P1-3: V2 Deferred without a DeferredPort can remain pending forever

- `crates/opentray-bin/src/dynamic_extension.rs:520-547` treats
  `opentray_ext_attach_deferred_completion_port_v1` as optional and accepts an absent
  symbol. But V2 dispatch still returns `Deferred` at `:637-654` without checking
  `self.deferred_port`.
- Such an extension can return the frozen Deferred disposition while no ingress exists
  to submit the only legal terminal. The registry entry and Node promise then remain
  pending indefinitely.
- Fix location: reject a Deferred result when no port is attached (typed capability/ABI
  error), or make the attach capability mandatory for V2-deferred surfaces; test the
  V2-only/no-port path explicitly.

### P1-4: TypedExtensionError is not isomorphic on synchronous error paths

- The contract requires `{code,message,details}` through Rust, server frame, and Node.
  `crates/opentray-spec/src/ext.rs:88-106` still defines the FFI `ExtensionErrorDetail` as
  only `{category,message}`. `crates/opentray-core/src/extension.rs:85-95` likewise has
  `Detailed { category, message }` only.
- `crates/opentray-core/src/broker.rs:607-623` maps that error to
  `ServerFrame::Error` without details, while `crates/opentray-spec/src/protocol.rs:405-410`
  and `packages/spec/src/index.ts:646-709` define the error frame without a details field.
- `packages/cli/src/local-broker.ts:447-452,646-653` turns synchronous server errors into
  a plain `Error`; only deferred terminal errors get `ExtensionOperationError` and details.
- The current round-trip tests cover the deferred payload branch, not the required
  synchronous Rust -> server -> Node factory path. Fix all three wire/runtime layers and
  add `instanceof`, `code`, and `details` assertions for a correlated synchronous error.

### P1-5: real dynamic-library coverage required by R7 P1-3 is absent

- `crates/opentray-bin/src/dynamic_extension.rs:1937-1993` tests the four command-symbol
  cells by passing symbol-name sets to a pure classifier. The disposition tests beginning
  at `:1995` use in-process Rust FFI stubs, not `libloading::Library::new` against four
  actual V1/V2 shared-library fixtures.
- This does not verify exported symbol spelling, ABI layout, calling convention, or that
  the V1 cell is never invoked through the V2 signature. It is exactly the test gap
  called out by R7 P1-3, so the claimed "four-cell loader" evidence is incomplete.
- Fix location: build/load four real shared-library fixtures (V2-only, V1-only, both,
  neither) and assert load diagnostics plus safe dispatch behavior on the native target.

### P1-6: embedded staging does not enforce the required four-target matrix

- `packages/cli/src/native-extension-artifact.ts:361-375` rejects manifest targets that
  are extra and checks only the currently selected target. It does not reject a manifest
  or artifact missing one of the required `darwin-arm64`, `darwin-x64`, `win32-arm64`,
  `win32-x64` entries.
- The fixture in `packages/cli/src/native-extension-artifact.test.ts:36-90` contains only
  `darwin-arm64`; all tests therefore pass without proving the section 6.4 completeness rule. The partial
  target types at `:28-49` also allow an incomplete embedded catalog to be represented.
- Fix location: enforce exact matrix completeness in staging/build (and reject incomplete
  embedded manifests before release), with missing-target tests for each matrix cell and
  pack/unpack receipt coverage.

### P1-7: handle sequence is observable and predictable

- `crates/opentray-core/src/operations.rs:122-184` creates one random base, then issues
  `nonce_base + AtomicU64` for every operation. After observing one handle, subsequent
  handles are predictable increments. This conflicts with the frozen opaque/unguessable
  handle requirement and weakens cross-operation forgery resistance.
- Fix location: generate an independent per-operation unpredictable u64 (CSPRNG or
  keyed derivation with collision handling), and test that issued handles are not a
  deterministic arithmetic sequence. Keep operationId as the exact 16-character wire
  projection.

### P1-8: owner-loop DeferredPort drain can strand queued records

- `crates/opentray-bin/src/deferred_port.rs:409-440` clears `wake_pending`, drains at
  most 64 records across all ports, and returns without re-arming when records remain.
  The queue bound is per port, so multiple ports can leave more than 64 records after one
  wake. If producers stop, no later wake is guaranteed and promises can remain pending.
- `event_hub` already has a budget-exhausted re-wake test/pattern; DeferredPort has no
  equivalent. Fix by rearming while any queue remains and add a multi-port over-quota test.

### P1-9: direct Node handshake accepts a Ready frame with the wrong protocol version

- `packages/cli/src/local-broker.ts:350-372` checks broker artifact identity but never
  checks `frame.protocolVersion === protocolVersion` before accepting the session.
  `packages/spec/src/index.ts:758-770` accepts any numeric Ready version as structurally
  valid. The separate daemon readiness path does not protect callers using a direct
  connection/diagnostic endpoint.
- Fix location: reject the mismatch during `LocalBrokerConnection.init` and add a wrong
  Ready-version test; retain the existing structural parser check and endpoint p2 matrix.

## P2 / additional contract and quality gaps

- `packages/spec/src/index.ts:798-805` and Rust serde at
  `crates/opentray-spec/src/protocol.rs:372-385` validate `operationId` only as a string.
  Empty, uppercase, and non-hex IDs are accepted despite the frozen 16-digit lowercase
  hex wire form. Add a shared parser predicate and adversarial tests.
- `crates/opentray-bin/src/dynamic_extension.rs:992-997,1219-1225` skips freeing
  extension-owned buffers when `ptr != null` and `len == 0`. The disposition cleanup at
  `:1143-1158` has the same condition. This leaks a non-null zero-length owned allocation;
  centralize ownership cleanup and test zero-length/non-null buffers.
- Batch A leaves `unsafe impl Send for DynamicExtensionInstance` at
  `crates/opentray-bin/src/dynamic_extension.rs:383-400` and the blanket
  `ExtensionInstance: Send` at `crates/opentray-core/src/extension.rs:66`. The task note
  defers removal/proof to Batch B 3.3, so this is a documented prerequisite, not a reason
  to claim Batch A's thread-affinity contract is complete.

## Standards / repository-contract findings

- `scripts/check-pack-size.mjs:1` and `package.json:11` introduce a Node/`.mjs` script,
  while the global repository guide requires scripts to be TypeScript (Bun scripts use
  `.sh.ts`). Port this gate to the repository's supported script form or record an
  approved exception.
- New `deferred_port.rs`, `dialog_poll.rs`, and `operations.rs` do not carry the required
  top-level orthogonal-intent/original-request/timestamp headers; `dynamic_extension.rs`
  was substantially changed without an updated intent header.
- New public Rust APIs in `extension.rs`, `kernel.rs`, and `dynamic_extension.rs` lack
  the required rustdoc. New public CLI/spec exports have no corresponding DeferredOperation,
  embedded-artifact, or typed-error documentation in `packages/cli/README.md` and
  `packages/spec/README.md`.
- New comments contain non-ASCII punctuation despite the repository's ASCII-default edit
  rule. `git diff --check` is clean, but that does not satisfy the source-style rule.

## Independent verification

Ran in the reviewed worktree:

- `mbx test -p opentray-spec -j 2`: **59/59 passed**.
- `mbx test -p opentray-core -j 2`: **44/44 passed**.
- `mbx test -p opentray-bin -j 2`: **failed**; 96 unit tests passed, 2 of 3
  `app_launch` tests passed, and `darwin_carrier_cold_launch_executes_the_persisted_vector_once`
  failed because `consumer-started.log` was not created. Re-running only
  `mbx test -p opentray-bin --test app_launch -j 2` reproduced the same failure.
- `pnpm --filter './packages/spec' exec vitest run`: **146/146 passed**.
- `pnpm --filter opentray exec vitest run`: **146/146 passed**.
- `bun test scripts/check-pack-size.test.ts`: **4/4 passed**.
- `git diff --check 439b9200..0479d465`: passed.

The green unit/Vitest gates do not cover the P0 public `TrayHandle` path, the race
interleavings, real dynamic libraries, full embedded target staging, or the failed
Darwin carrier integration test. Windows real-device `cargo test` was not independently
available in this review and must remain separate platform evidence.

## Required closure order

1. Repair the public deferred SDK result contract and add high-level result/error tests.
2. Make DeferredPort open/revoke/enqueue linearizable and change close ordering to purge
   before any drain.
3. Prevent V2 Deferred without a live port; close the synchronous typed-error wire path.
4. Add real four-library symbol fixtures, exact embedded target-matrix enforcement, and
   wrong-ready-version coverage.
5. Replace predictable handles, re-arm bounded DeferredPort drains, then rerun the full
   native and package gates including the currently failing Darwin carrier test.

**Batch B verdict: NO-GO.**
