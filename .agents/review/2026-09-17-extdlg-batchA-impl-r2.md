# OpenTray `add-ext-dialog` Batch A implementation review R2

- Review range: `0479d465..4a4a182d` (12 commits), at `4a4a182d`
- Role: implementation-only re-review against the frozen design reference sections 5.1, 5.2, 5.5, 5.7, 6.1, 6.4, and 7.5; task items 2.1-2.6; R7 P1-3/P1-4.
- Verdict: **NO-GO for Batch B**
- Score: **8.5/10**

## Executive conclusion

R1 P0-1 and P1-1 through P1-9 are substantively closed. The public SDK now exposes an immediate/terminal discriminated result; the port uses a lifecycle mutex, closes before cleanup and drain, has a bounded re-wake path, and the real C shared-library matrix proves V1 is not called as V2. Protocol v2, embedded four-target staging, per-operation opaque handles, and synchronous typed errors are also implemented and tested.

One material R1 follow-up remains: the promised typed-error `details` discriminated JSON-object schema is enforced for synchronous `ServerFrame::Error`, but not for deferred terminal errors. Thus a malformed extension terminal can cross the FFI/serde/TS parser as `details: null`, a scalar, or an array. The same public `TypedExtensionError` has two incompatible acceptance languages. This contradicts design section 7.5 and prevents Batch B from relying on the typed error contract.

## R1 closure ledger

| R1 item | R2 result | implementation evidence |
|---|---|---|
| P0-1 public deferred SDK | Closed | `packages/cli/src/client.ts:59-61,374-407` returns `ExtensionRequestResult`; `index.test.ts:60-137` covers result, typed terminal rejection, and immediate arms. |
| P1-1 open/revoke/enqueue race | Closed | `deferred_port.rs:119-139,214-230,249-272` linearizes phase, session and queue with one mutex. Barrier-only races at `:923-1067` have no sleeps, run 64/32 rounds, and assert post-revoke closure/accounting. |
| P1-2 close delivery | Closed | `drain_deferred_terminals` purges before drain at `deferred_port.rs:557-627`; both owner loops pass closing session (`main.rs:913-926`, `unix_transport.rs:288-299`); regression `:1078-1175` proves zero closing-session terminals and survivor delivery. |
| P1-3 portless V2 | Closed | `dynamic_extension.rs` rejects V2 Deferred absent a port; stub and real-library tests include `portless_v2_deferred_is_a_typed_capability_rejection`. |
| P1-4 sync typed error | Partially closed; remaining P1 below | FFI/core/frame/Node propagation is present, legacy error bytes are retained, and socket/high-level tests cover `BrokerServerError`. Deferred payload validation remains non-isomorphic. |
| P1-5 real ABI matrix | Closed on this Unix host | `dynamic_extension.rs:1872-2077` compiles four `cc -shared` fixtures, loads through `libloading`, proves V1 convention, V2 preference, neither rejection, and real C-to-Rust port submit. Windows evidence remains separately required. |
| P1-6 four embedded targets | Closed | exported exact target matrix and `Record` typing plus per-cell tests enforce no missing/extra staging entries. |
| P1-7 opaque handles | Closed | `operations.rs:137-146,194-213` uses fresh keyed random u64 with zero/collision redraw under table lock; test covers 64 distinct/non-arithmetic handles. |
| P1-8 stranded drain | Closed | `deferred_port.rs:516-536,626` re-wakes after every incomplete drain; deterministic 3 ports x 30 test exhausts the 64-record quantum. |
| P1-9 Ready protocol mismatch | Closed | `local-broker.ts:383-389` rejects version mismatch before identity comparison; dedicated test present. |
| P2 operationId / zero-length free | Closed | both parsers require 16 lowercase hex; dynamic loader centralizes non-null owned-buffer freeing and tests zero-length allocations. |

## P1: deferred typed-error details parser is not frozen or isomorphic

### Evidence

- The contract says `details` is a discriminated union frozen in `@opentray/spec`, shared by Rust/server/Node, and every code needs a wire round-trip and `instanceof`/details test: `design-reference.md:416-424`. Repository docs additionally specify that a present `details` is a JSON object and never `null`: `packages/spec/README.md:25`.
- Synchronous frames correctly enforce this: `packages/spec/src/index.ts:842-850` permits only absent or `isRecord(details)`; tests reject null/scalars/arrays at `index.test.ts:852-864`.
- Deferred frames do not: `isTypedExtensionError()` at `packages/spec/src/index.ts:886-889` checks only code/message, and `isExtOperationPayload()` delegates to it at `:892-904`. Consequently terminal payloads accept `details: null`, `1`, `[]`, or a string.
- Rust has the same gap. `TypedExtensionError.details` and `ExtensionErrorDetail.details` are unconstrained `Option<serde_json::Value>` in `crates/opentray-spec/src/ext.rs:93-117`; `ExtOperationPayload` derives serde without a validating deserializer in `crates/opentray-spec/src/protocol.rs:476-481`. Thus DeferredPort's `serde_json::from_slice::<ExtOperationPayload>` admits the same invalid values before queueing (`deferred_port.rs:195-207`).

### Impact

A malformed native extension can settle an accepted operation with a terminal error that the synchronous path would reject as invalid wire data. Node constructs `ExtensionOperationError` carrying the malformed value, while a matching synchronous error cannot cross the parser. This violates the single TypedExtensionError contract and leaves facade error branching untrustworthy.

### Verifiable repair

1. Define one JSON-object `details` validation/type in both specs (or a per-code discriminated schema when the dialog error codes land), and use it in `isTypedExtensionError` as well as `ServerFrame::Error`.
2. Add Rust custom deserialization/validation for `TypedExtensionError` and FFI `ExtensionErrorDetail`, so `null`, scalar, and array fail on both synchronous and deferred terminal payloads.
3. Add paired TS and Rust adversarial round trips for `ext-operation-terminal.payload.error.details`, plus a DeferredPort ingress test proving invalid details returns `EXT_ERR_REJECTED` without queue mutation.

## Deferred Batch B prerequisite (not newly scored as Batch A regression)

`crates/opentray-bin/src/dynamic_extension.rs:440` still has `unsafe impl Send for DynamicExtensionInstance`, and `crates/opentray-core/src/extension.rs:66` requires `ExtensionInstance: Send`. The frozen section 5.5 owner-thread decision makes the Batch B UI-affine implementation responsible for removing this blanket mobility or proving no native instance moves threads. Do not treat this Batch A review as that proof.

## Independent verification

- `mbx test -p opentray-spec -j 2`: **61 passed**.
- `mbx test -p opentray-core -j 2`: **46 passed**.
- `mbx test -p opentray-bin -j 2 -- --test-threads 2`: **109 unit + 3 app_launch + 2 backend_composition passed**. Existing warnings were from vendored `tray-icon` plus existing `owned_envelope_to` dead code; no failure.
- `pnpm --filter './packages/spec' exec vitest run`: **148 passed**.
- `pnpm --filter opentray exec vitest run`: **155 passed**.
- `git diff --check 0479d465..4a4a182d`: passed.

The claimed Windows real-device verification was not available in this review and remains platform-specific evidence.

## Decision

**NO-GO for Batch B.** Close the P1 typed-details parser isomorphism and its ingress/round-trip adversarial tests first. After that closure, the remaining `Send` issue must be addressed as Batch B task 3.3's owner-thread admission condition.
