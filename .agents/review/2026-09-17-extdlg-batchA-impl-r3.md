# OpenTray `add-ext-dialog` Batch A implementation review R3

- Review point: `69f14692` (`HEAD`), surgical follow-up to R2 only
- Scope: R2 residual P1, typed-error `details` language and DeferredPort ingress evidence
- Verdict: **NO-GO for Batch B**
- Score: **8.6/10**

## Conclusion

The new deferred-terminal validation is correct on the TypeScript side and on
the Rust `TypedExtensionError` / FFI `ExtensionErrorDetail` side. In
particular, the Rust custom deserializer reads a raw `Value`, so an explicit
`null` cannot be folded into `None`; a missing field still uses `serde(default)`.
The DeferredPort parser therefore rejects null, scalar, array, and string
details before queue insertion. The TS predicate and parser produce the same
acceptance language, and the relevant Rust/TS tests pass.

One P1 remains: Rust's synchronous `ServerFrame::Error.details` is still a
bare `Option<Value>` at `crates/opentray-spec/src/protocol.rs:447-460`. It does
not use `deserialize_details_object`, so Rust sync frames still deserialize
`details: null`, scalar, or array while deferred terminal errors reject them.
The claimed one-language contract is therefore not yet three-sided/isomorphic.

The new DeferredPort test also does not by itself prove zero queue mutation:
`session_operation_count() == 1` measures the operation registry, not the
port queue, and remains `1` both before and after a queued malformed record
would be drained. The implementation path is correctly ordered and returns
before `push_back`, but the requested regression evidence should drain or
inspect the queue after malformed submits, then assert it is empty before the
valid submit.

## Evidence

### Closed portion of R2 P1

- TS `isTypedExtensionError()` now requires absent or `isRecord(details)`;
  `isExtOperationPayload()` delegates to it. The added test covers
  `null`, `1`, string, array, and boolean against both predicates and terminal
  parsing (`packages/spec/src/index.ts:885-908`,
  `packages/spec/src/index.test.ts:650-670`). An independent probe confirmed
  only missing/object details pass for both sync and deferred parsers.
- Rust `deserialize_details_object()` deserializes `Value` directly and
  rejects every non-object (`crates/opentray-spec/src/ext.rs:86-119`). Both
  `TypedExtensionError` and `ExtensionErrorDetail` use it with `default`, and
  the five-shape adversarial test includes explicit null
  (`crates/opentray-spec/src/ext.rs:124-158,514-547`).
- Deferred ingress returns `EXT_ERR_REJECTED` for malformed details before the
  queue push, and accepts a subsequent object-details payload
  (`crates/opentray-bin/src/deferred_port.rs:680-727`).

### Remaining P1: Rust sync frame is not wired to the shared validator

The sync frame field remains:

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
details: Option<Value>,
```

That is a distinct serde path from the repaired typed-error DTO. Existing Rust
tests cover a valid object and missing details, but no invalid sync-frame
null/scalar/array cases. Applying the shared custom deserializer (or a shared
validated details type) to this field and adding the same adversarial round
trip closes the actual residual P1.

### Test-evidence gap: queue mutation

The ingress test's registry count assertion proves the operation was not
retired, but cannot prove no `VecDeque` entry was appended. Add an explicit
`hub.drain(DEFERRED_DRAIN_MAX_RECORDS).is_empty()` assertion after the four
malformed submissions (before the valid payload), then assert the valid
payload drains exactly once.

## Verification

- `pnpm --filter './packages/spec' exec vitest run`: **149/149 passed**.
- `mbx test -p opentray-spec -j 2`: **62/62 passed**.
- `mbx test -p opentray-bin -j 2 -- --test-threads 2`: **110 unit + 3 app_launch + 2 backend_composition passed**.
- Independent TS probe: sync and deferred parsers agree for absent, object,
  null, number, string, array, and boolean details.
- `git diff --check 4a4a182d..69f14692`: clean.

## Decision

**Batch B: NO-GO.** Finish the Rust synchronous `ServerFrame::Error`
deserializer wiring and strengthen the ingress queue assertion. The previously
deferred/FFI null-folding bug is closed; the existing `unsafe impl Send for
DynamicExtensionInstance` remains the separately documented Batch B 3.3
owner-thread prerequisite and is outside this surgical review.
