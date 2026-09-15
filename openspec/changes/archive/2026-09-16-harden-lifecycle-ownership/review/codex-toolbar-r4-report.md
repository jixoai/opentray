# OpenTray `harden-lifecycle-ownership` R4 Review

## Verdict

**NEEDS-WORK - 6.5/10.** R3 的两个修复方向都已经进入代码，但发布前的证据和边界仍未闭合；本轮不能写成“无阻塞，可进入用户走查与 0.27.5 发布”。

## Scope and evidence

Review target:

- `80f671d2` - stable `session-mismatch` mapping.
- `ccac43c7` - bounded/coalescing generated-entry child-output channel.
- Parent baseline: `0f69dcbe`.

Working tree remained read-only. The only pre-existing worktree item was the untracked `.agents/documents/d19-extension-event-port-design.md`; it was not touched.

Independently reproduced on the current Darwin host:

- `pnpm --filter @create-opentray/core exec vitest run src/log-queue.test.ts --reporter=dot`: **1 file, 7 tests passed**.
- `pnpm --filter @create-opentray/core exec vitest run src/entry-bootstrap.test.ts src/toolbar-carrier.test.ts --reporter=dot`: **2 files, 14 tests passed**.
- `pnpm --filter @create-opentray/core typecheck`: passed.
- `git diff --check 0f69dcbe..HEAD`: passed.

The brief-supplied `mbx` Rust totals, Windows target check, and full create-core baseline were not independently rerun. No native GUI or Windows acceptance is claimed.

## Findings

### P1: Required ExtCommand regression proof is incomplete

The implementation is correct at the dispatch boundary:

- `crates/opentray-core/src/broker.rs:431-448` passes `Some(request_id)` into `kernel_error()` for a rejected `ExtCommand`.
- `crates/opentray-core/src/broker.rs:559-567` maps `KernelError::SessionMismatch` to the stable `session-mismatch` code and includes session/app/tray identity in the message.

The required test does not prove the full contract. `crates/opentray-bin/src/extension_events.rs:782-801` matches `ServerFrame::Error` with `..`, so it never checks that the response carries `req-ext-app-a-tray-a`. It checks that no `ext-event` is observed, but does not snapshot/assert that the owning app/tray/extension state is unchanged. The test comment claims request correlation, but the assertion does not bind it.

This is an evidence blocker rather than an observed mapping failure. Fix with an exact `request_id` match and a before/after owner-state assertion (or an equivalent registry/backend/extension dispatch counter), then rerun the broker tests.

### P1: Concurrent drop-marker commits corrupt drop accounting

`packages/create/packages/core/src/log-queue.ts:87-107` snapshots `outputDroppedBytes` into `carriedDrops` but leaves the global counter reserved until the append succeeds. A second `commitOutputBuffer()` can therefore carry the first snapshot plus new drops before the first carrier lands. The first success subtracts its old snapshot; the second success subtracts the combined snapshot, producing a negative residual and suppressing later markers.

I reproduced this with a held `appendFile` harness: submit an 8 KiB commit, queue a 262,144-byte dropped chunk and flush twice while the first writes are held, then release; after refilling the cap and dropping another 1,024 bytes, no new marker is emitted. The landed output contains two `262144` drop records and then loses the later marker. This is reachable whenever output is noisy while an output append is slow and repeated flush/threshold commits occur.

Fix by reserving the carried count separately (for example, `outputDroppedBytesPending` plus `outputDroppedBytesInFlight`), or by allowing only one drop-marker carrier in flight and merging subsequent drops into the pending counter. Add a repeated/concurrent flush regression test.

### P1/P2: Failed output appends silently lose child payloads

At `log-queue.ts:96-109`, a rejected output append only decrements `outputInFlightBytes`; the payload text is not requeued or counted as dropped. The output tail intentionally swallows the rejection, so `flushLogQueue()` can resolve while those child-output bytes are gone. The marker counter is retained only for cap drops, not for a failed payload.

If child output is explicitly lossy, this can be accepted only after documenting that contract and counting failed bytes in the same readable drop accounting. If app.log is expected to preserve all observed child output, this is a P1 durability bug. In either case, add a rejection/recovery test so the behavior is deliberate rather than silent.

### P2: The advertised 256 KiB cap is not inclusive of drop metadata

`log-queue.ts:114-120` enforces `outputBufferedBytes + outputInFlightBytes <= OUTPUT_CAP_BYTES` on raw chunks. `commitOutputBuffer()` then prepends `[log-queue] dropped N output bytes\\n` at `:89-95` and adds the full payload to `outputInFlightBytes`. A full-cap in-flight queue followed by a dropped chunk can therefore submit a marker payload above 256 KiB. The marker is small, but the implementation does not satisfy a literal hard cap over all submitted output bytes.

The fix is to budget marker overhead or define the cap as raw child bytes plus a separate bounded diagnostic allowance. Add an exact-cap test.

### P2: Single-giant-chunk and flush-boundary contracts are underspecified

The cap loop drops a single chunk larger than 256 KiB as one whole chunk, which is a coherent lossy policy, but there is no named maximum-single-chunk constant or test covering that boundary. The call temporarily holds the incoming string before dropping it, so the actual transient memory bound is `cap + incoming chunk`, not a strict 256 KiB bound.

`flushLogQueue()` at `log-queue.ts:129-136` commits once and awaits the current `logQueueTail`/`outputTail` snapshots. It does not close output ingestion or loop until the queues are quiescent. Child pipe/PTY callbacks can arrive after the snapshot while `killCommand()` and the flush are racing; those chunks can schedule a later timer/commit after the flush resolves and before `process.exit()`. A permanently hanging `appendFile` also has no wall-clock timeout. The current stress test proves bounded behavior under finite jitter, not a hard quiescence or timeout guarantee.

Fix by marking shutdown before kill, rejecting/absorbing new output after that point, and draining in a bounded loop (with a defined append timeout/fallback). Add tests for a chunk during flush, repeated flush, a giant chunk, and a hanging/rejected append.

## R3 closure assessment

### R3-1 stable error code

**Implementation: PASS. Evidence: NOT CLOSED.** The kernel mapping and request propagation are present, and the existing core tray-bounds test checks the stable code and request ID. The required extension-dispatch test still omits the request-ID and unchanged-owner assertions, so the exact R3 gate remains open.

### R3-2 bounded child-output channel

**Normal-path behavior: PASS.** The output path is separate from milestones, coalesces at 8 KiB or 50 ms, applies a pre-submit cap, and the focused tests cover coalescing, threshold commit, cap stress, chain independence, and milestone ordering. Cross-channel order is intentionally unspecified (`log-queue.ts:68-71`); that is an acceptable patch-boundary tradeoff because each local append is one write and milestone order remains strict.

**Release boundary: NOT CLOSED.** Drop-marker accounting under concurrent commits is incorrect, the cap does not include marker overhead, output-write failure semantics are silent, and flush is not a true quiescence barrier. These are reachable edge paths, not merely missing prose.

## Preserved residuals and out-of-scope risk

- Keep the R2 P2 residuals recorded: release owner-lock TOCTOU and unattributed multiple-legacy-carrier ambiguity.
- The shell-server output ring's per-record bound remains the declared out-of-scope existing risk; it is not promoted into this R4 decision.

## Required next checks

1. Strengthen the foreign `ExtCommand` test with exact request correlation and unchanged owner state.
2. Make drop-marker accounting single-carrier/reservation-safe and test repeated/concurrent flushes.
3. Decide and encode failed-output durability (retry, or explicit/countable lossy drop).
4. Define/test marker-inclusive cap and maximum-single-chunk behavior.
5. Add a shutdown barrier and bounded flush test for output arriving during flush; rerun the supplied Rust and platform gates.

## Release decision

**Do not publish 0.27.5 yet.** The implementation is materially improved over R3, but the P1 evidence gap and reachable output-accounting race prevent a GO verdict.
