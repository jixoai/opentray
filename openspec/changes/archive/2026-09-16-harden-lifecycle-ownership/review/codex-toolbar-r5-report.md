# OpenTray `harden-lifecycle-ownership` R5 GO Review

## Verdict

**GO - 9.0/10.**

**GO：可进入用户走查与 0.27.5 发布。**

R4 的六项要求均已核销，没有新的发布阻塞。R5 提交 `2e9aea54` 只修改了 R4 复核涉及的 Rust 回归断言、生成入口 shutdown wiring 和日志队列实现/测试；工作树保持只读，既有未跟踪文件 `.agents/documents/d19-extension-event-port-design.md` 未触碰。

## Verification

Independently reproduced on the current Darwin host:

- `pnpm --filter @create-opentray/core exec vitest run src/log-queue.test.ts --reporter=dot`: **1 file, 15 tests passed**.
- `pnpm --filter @create-opentray/core exec vitest run src/entry-bootstrap.test.ts src/toolbar-carrier.test.ts --reporter=dot`: **2 files, 14 tests passed**.
- `pnpm --filter @create-opentray/core typecheck`: passed.
- `git diff --check 2e9aea54^..HEAD`: passed.

The brief-supplied create-core full baseline (**17 files / 225 tests**), Rust extension-events result (**12/12**), repository vision tests, and platform checks were not rerun independently in this pass. No native GUI or Windows acceptance is claimed; those remain supplied evidence. The targeted independent gates cover the changed queue and generated-entry behavior.

## R4 Closure Matrix

### 1. Concurrent drop accounting - CLOSED

`packages/create/packages/core/src/log-queue.ts:120-128,146-195` separates pending drops from each carrier's in-flight reservation. Commit moves a snapshot into its own reservation; only that carrier retires or returns it. The exact R4 held-append, 8 KiB commit, 262,144-byte whole drop, two concurrent flushes, cap refill, and fresh 1,024-byte drop repro is now a regression test at `log-queue.test.ts:202-236`; it emits exactly one marker per episode and preserves the later marker.

### 2. Failed/timed-out output append semantics - CLOSED

`appendOutputBounded` gives each output append a 5-second wall-clock bound, and rejection/timeout returns the carrier's raw bytes to the counted pending total (`log-queue.ts:132-145,182-195`). The contract is now explicitly lossy-by-design: diagnostic child output may be lost, but each such loss is counted and reported by a later successful marker. Rejecting and hanging append tests cover recovery and bounded flush (`log-queue.test.ts:239-253,324-340`).

### 3. Marker-inclusive cap - CLOSED

`commitOutputBuffer` budgets marker bytes before submission and evicts whole oldest chunks when marker plus buffered/in-flight payload would exceed `OUTPUT_CAP_BYTES` (`log-queue.ts:155-180`). The exact 31 x 8 KiB in-flight case, 8,242-byte drop, and marker-only carry are tested at `log-queue.test.ts:255-277`; submitted payloads remain within the declared marker budget.

### 4. Single giant chunk - CLOSED

The source contract names the transient bound as `cap + largest single chunk` and defines whole-chunk drop for input larger than the cap (`log-queue.ts:209-218` and the top-level intent contract). Tests cover both `262145` bytes dropping with the exact marker and `262144` bytes being retained (`log-queue.test.ts:279-293`).

### 5. Shutdown/quiescence barrier - CLOSED

`beginOutputShutdown()` absorbs post-shutdown chunks into pending loss accounting without scheduling new output commits (`log-queue.ts:197-205`). The command entry invokes it before `killCommand()` (`entry-template.ts:550-567`), and the generated-template assertion checks that ordering (`entry-bootstrap.test.ts:667-678`). `flushLogQueue` performs at most eight re-snapshot/commit/await rounds plus a final bounded carrier, while each output append has a timeout (`log-queue.ts:227-251`). Tests cover a chunk arriving during drain, post-shutdown chunks, repeated/idempotent flush, and hung append recovery (`log-queue.test.ts:295-340`).

The brief explicitly retains the pre-existing milestone-chain behavior: milestone append has no wall-clock timeout and can still hold an exit flush if the underlying milestone append never settles. That is outside this child-output patch and is recorded rather than upgraded to a new blocker.

### 6. Stable ExtCommand error evidence - CLOSED

The implementation still maps `SessionMismatch` to `session-mismatch` and preserves the request ID (`broker.rs:431-448,559-567`). The formerly incomplete test now matches `request_id == "req-ext-app-a-tray-a"`, the stable code/message, no events on either session, and a subsequent owner dispatch with pushed events (`crates/opentray-bin/src/extension_events.rs:782-818`). This closes the R4 evidence gap and covers owner state survival.

## Boundary decisions

- Independent milestone and child-output chains remain acceptable: milestone order is strict, cross-channel order is intentionally unspecified, and each append is a separate append-mode write.
- A timed-out append that later succeeds may conservatively over-count; this is documented and cannot under-count the loss episode.
- A producer that continues after the bounded shutdown-drain budget may have its final marker arrive too late to be persisted; this is the declared bounded lossy-output contract.
- R2 P2 residuals remain recorded: release owner-lock TOCTOU and unattributed multiple-legacy-carrier ambiguity.
- The shell-server output ring's per-record bound remains the declared out-of-scope existing risk.

## Release decision

No R5 blocker remains in the reviewed scope. Proceed to user walkthrough and the 0.27.5 release gates, preserving the supplied-evidence boundary for Rust, Windows, native GUI, and repository-wide tests.
