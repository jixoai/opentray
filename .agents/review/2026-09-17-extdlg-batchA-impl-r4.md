# OpenTray `add-ext-dialog` Batch A implementation review R4

- Review point: `dcac4df6` (`HEAD`), surgical follow-up to R3 only
- Scope: R3 residuals: sync-frame details validation and DeferredPort queue evidence
- Verdict: **NO-GO for Batch B**
- Score: **8.8/10**

## Conclusion

Both R3 behavioral residuals are closed in the current working tree.
`ServerFrame::Error.details` now uses the same `deserialize_details_object`
function as `TypedExtensionError` and `ExtensionErrorDetail`; its new test
accepts an object and rejects null, number, string, and array. The DeferredPort
test now drains the queue after malformed submissions (empty), then verifies a
valid object-details terminal drains exactly once with the issued handle.

One commit-integrity blocker remains. `protocol.rs` in `HEAD` references
`crate::ext::deserialize_details_object`, but `git show HEAD:crates/opentray-spec/src/ext.rs`
still declares that function private (`fn`, not `pub(crate)`). The required
visibility change exists only as an unstaged working-tree modification:

```text
 M crates/opentray-spec/src/ext.rs
-fn deserialize_details_object...
+pub(crate) fn deserialize_details_object...
```

Therefore the tested dirty tree is valid, but the claimed fix commit is not
self-contained: a clean checkout of `HEAD` fails Rust privacy checking before
the spec crate can build. Commit the one-line visibility change together with
the protocol change before treating this repair as landed.

## Verification

- `mbx test -p opentray-spec -j 2`: **63/63 passed**, including
  `sync_error_details_share_the_single_object_language`.
- `mbx test -p opentray-bin -j 2 deferred_port::tests`: **12/12 passed**,
  including `malformed_details_in_terminal_errors_reject_ingress_without_queue_mutation`.
  The current source contains 12 DeferredPort tests; the supplied 13/13 count
  appears stale or includes a different filter.
- `git diff --check HEAD^..HEAD` and working-tree diff check: clean.
- The queue assertion is direct (`hub.drain(64).is_empty()` after malformed
  submits; then `len() == 1` and `handle` equality after the valid submit), so
  the R3 evidence gap itself is closed.

## Decision

**Batch B: NO-GO for the current commit.** Functionally this is ready after
the visibility line is included in `dcac4df6` (or a follow-up commit); no new
protocol or queue-semantics defect was found. The previously documented
Batch-B 3.3 owner-thread `Send` prerequisite remains outside this surgical
review.
