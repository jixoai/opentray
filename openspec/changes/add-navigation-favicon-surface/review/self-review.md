# add-navigation-favicon-surface — Self Review

## What this change delivers

Three per-view capabilities for `ext-webview`, closing the two gaps recorded in
`skills/opentray/references/multi-webview.md` Known limits v1 (no native favicon
surface; no fine-grained navigation events or veto):

1. **`navigationAction` event (Edge class)** — one push per native navigation
   decision point, before the load surfaces as `loadState` phases. Payload
   `{ url, navigationType, isUserInitiated? }` with a six-value enum
   (link/form/backForward/reload/redirect/other). Platform projections are
   documented truth, not promises: Windows maps `IsRedirected` exactly and
   projects unredirected user-initiated navigations as `link` (link/form are
   not separable there); macOS maps `WKNavigationAction.navigationType` with
   no redirect distinction (server redirects surface as `other`) and omits
   `isUserInitiated` (WKNavigationAction carries no such attribute).
2. **Declarative navigation rules** — `createWebview({ navigationRules })` or
   `setNavigationRules()`, `{ pattern, action: "block" }` entries evaluated
   synchronously on the platform UI thread inside the navigation delegate (no
   IPC round-trip, so the veto is race-free). A blocked navigation cancels
   before it starts and reports `loadState failed` with the stable code
   `WEBVIEW_NAVIGATION_BLOCKED_ERROR_CODE = 4500001` (outside both the
   WebView2 `WebErrorStatus` range and WebKit domain codes). Glob semantics
   are one shared definition (`*` matches any character run including
   separators; everything else literal) with twin implementations in TS
   (RegExp) and Rust (star-backtracking), pinned by the same table-driven
   tests on both sides.
3. **Native favicon surface** — `createWebview({ favicon: true })` opts a view
   into `faviconChange` (Latest class, `<webviewId>/favicon` coalesce key,
   same-href dedupe with no seq burn) plus the `getFavicon()` `(value, seq)`
   query pair and facade gap resync. The page-side observer gate widened from
   `iconSyncPageToNative` to `favicon || iconSyncPageToNative`; a bridgeless
   view gets a self-contained observe-only script (MutationWatcher over the
   icon link elements reporting through the private sync namespace) that
   exposes no bridge surface — the arbitrary-content default survives the
   opt-in.

Wire/contract face: event family 5 → 7 kinds; `create-webview` grows
`favicon`/`navigationRules` options; new `get-webview-favicon` and
`set-webview-navigation-rules` commands and the `get-webview-favicon-result`
frame (all in the shared fixture suite with TS+Rust builders); contract
fingerprint bumped to `opentray-ext-webview-contract-6` with the two event
classes, coalesce key, and state-resync rule registered.

Platform mechanics worth recording:

- macOS `decidePolicyForNavigationAction` upgraded from pure pass-through to
  observe-then-veto inside the outermost `LoadStateNavigationDelegate`. A
  blocked navigation answers `Cancel` directly (never reaches the wrapped
  delegate chain) and emits the terminal `failed` frame itself — WebKit does
  not call `didFail*` for a policy-cancelled navigation.
- Windows `NavigationStarting` maps `IsRedirected`/`IsUserInitiated`, applies
  the rule veto through `SetCancel(true)`, and records the navigation id in a
  blocked-id set; WebView2 still fires `NavigationCompleted(OperationCanceled)`
  for a cancelled navigation, and the completed handler swaps that platform
  status for the stable blocked code exactly once per blocked id. A blocked
  navigation never emits `started` and never seeds the pending-url slot.
- Empty patterns reject with `invalid_payload` at both entry points
  (create option and set command) on both platforms; the facade also rejects
  locally before any frame is sent.

## Evidence chain

- Contract twins: `@opentray/spec` 135 (webview suite 56) and
  `opentray-spec` 52 green, including the shared glob table (8 cases, both
  sides), payload guards (unknown navigationType / non-boolean flag / empty
  href reject), rule DTO serde freeze, and the untagged-order-sensitive
  frame round-trips.
- Platform cores: `opentray-ext-webview` macOS 182/182 — new unit tests for
  navigationAction subscription gating + projection serialization,
  faviconChange Latest dedupe/query-pair semantics (empty href never reaches
  state), rule evaluation + stable failed code, and the bootstrap gating
  shapes (observe-only script has no bridge surface; `favicon` flag bakes
  `requestedFaviconObserver`; iconSync stays independent).
- Full batteries: macOS workspace Rust 379 passed / 0 failed
  (`--no-fail-fast`; one `opentray-bin` app-launch test flaked under parallel
  load and passed isolated); Windows real host (LAN ssh, same commit
  `1418c156`) ext-webview 189/189 + spec 52/52; JS packages all green
  (ext-webview 79 incl. two new facade suites, spec 135, create 319 with one
  load-flake re-verified isolated, cli/packaging/webui/icon/plugin packages).
- Black-box smoke (`/tmp/navfav-smoke`: source-tree release broker + freshly
  built dylib deployed into the platform package + freshly packed SDK
  tarballs + isolated HOME): 10/10 assertions PASS on macOS —
  `navigationAction` arrives for both programmatic (`other`) and user link
  (`link`) decisions; the blocked link produces `failed` with errorCode
  4500001, no `started` frame, and the page never navigated; the dynamic
  favicon swap produced `faviconChange` a→b and `getFavicon()` converged to
  the new href; the subsequent allowed navigation finished normally with
  progress 1, proving the veto does not trap later navigation.
- Repo baselines: `bun test scripts/openspec/vision-driven.test.ts`,
  `openspec schema validate vision-driven`, `pnpm -r list --depth -1` (run at
  change creation; unchanged since — no dependency edits in this change).

## Deviations from plan

- None in scope. Task 2.4's "resolve absolute href" happens page-side (the
  observer reports the DOM `link.href` property, which is absolute by
  definition; `getAttribute` fallback is only used when `href` is unset) —
  recorded here because the plan wording implied native-side resolution.

## Residuals (recorded, non-blocking)

- `navigationAction` has no query pair (Edge class by design); a consumer
  attaching mid-session sees only future decisions. Same contract as
  `loadState`.
- macOS cannot attribute redirects (`other`) or user-initiated gestures
  (omitted) — documented platform truth in the spec deltas, not a defect to
  fix here.
- Rules are per-view, evaluated in declaration order, first block wins; there
  is no allowlist/denylist composition or rule priorities in v1 (spec delta
  freezes `action: "block"` as the only action).
- The blocked-id set on Windows lives for the controller's lifetime and is
  not cleared on session teardown (entries are u64 navigation ids; stale
  entries can only cause a future NavigationCompleted to report the blocked
  code if WebView2 reuses the id, which it does not within one controller).

## Codex review

- **R1: NEEDS-WORK 5.5/10** (`review/codex-r1-report.md` mirrors
  /tmp/navfav-codex-report.md). All three P1s confirmed real and fixed in
  the R1 round (commit `5118542e`):
  - Windows blocked-navigation failure URL could be empty or misattributed
    (the completed handler read the shared pending-url slot). Now each
    blocked id carries its URL in a bounded (64) ring and the completion
    reports that URL with the stable code.
  - `getFavicon()` lacked capability gating and returned a non-spec wire
    shape. Now `value: { href } | null` (explicit null = not observed) and
    views created without `favicon: true` reject with the new typed
    `favicon_disabled` code (registry 10 → 11, frozen on both sides).
  - The TS glob escape built a broken character class, leaving `.` (and
    most metacharacters) unescaped — `example.org` matched `exampleXorg`.
    Rewritten with the standard metacharacter class; adversarial table
    (12 new cases) mirrored in TS and Rust.
  - P2 fixes riding the same round: favicon hrefs resolve to absolute
    http(s) against the view's tracked URL before emission (shared pure
    resolver, 15-case table; `data:`/`blob:`/`file:` never reach the
    wire); NavigationId read failures log diagnostics and take documented
    safe paths; the facade gap-resync delivery is mutually exclusive by
    kind with a regression test.
  - P3 fixes: event-family comment lists all seven kinds,
    `WebviewNavigationRuleAction` carries its contract doc, contract-6
    `stateResync` text matches the wire shape.
  - Process finding recorded for the bias log: one intermediate commit
    compiled locally only through a stale build-cache product; the Windows
    host caught it (`BLOCKED_RING_CAP` unresolved). The amended candidate
    compiles and passes on both platforms.
- **R2: 7.0 NEEDS-WORK** — favicon resolver had to be a standard URL
  parser, not hand-rolled splicing; the Windows ring's eviction/getter
  semantics still leaked. Fixed in the R2 round (url crate
  `Url::parse + join` with a 27-case table; `BlockedNavigationRing`
  abstraction with eviction compensation).
- **R3: 7.8 NEEDS-WORK** — the Windows decision chain had to be
  action-first (the id read preceded the navigationAction push, so a
  getter failure could swallow it), and eviction compensation needed
  tombstones for exactly-once terminals. Fixed in the R3 round.
- **R4: 8.2 NEEDS-WORK** — completed-side getter failures could drop a
  stable terminal; tombstone expiry could re-open one. Fixed with FIFO
  orphan attribution + an OperationCanceled defense (both later replaced).
- **R5: 8.0 NEEDS-WORK** — the heuristics themselves were the problem:
  FIFO identity fabrication without a WebView2 ordering contract, a
  lifetime `ever_blocked` flag swallowing legitimate user cancels, a
  WebView2 status constant inside the platform-neutral layer. Fixed by
  the unified rewrite: the stable terminal emits at the DECISION POINT on
  both platforms, and `CancelLedger` (bounded tombstones + one
  outstanding-cancellation counter) only decides completion suppression —
  never emits, never fabricates.
- **R6: 8.6 NEEDS-WORK** — the pending-counter window could still swallow
  an ordinary failure interleaved with an outstanding cancellation. Fixed
  by identity-precise suppression: a readable id answers only against the
  tombstones; the counter backs off to id-unreadable completions only; an
  evicted tombstone's very late completion passes through (one redundant
  frame beats mis-suppression — the R6 trade), pinned by interleave
  twins.
- **R7: GO 9.2/10** (`review/codex-r7-report.md`) — "identity-precise
  收紧满足 R6 最小修复要求：可读 completion id 只查 tombstone，未知可读
  id 不消费 pending；pending 仅处理不可读 id 的 completion。R6 的普通交错
  失败被吞问题已闭合，R5 的五个 P2 均不再构成代码阻塞。" Independent
  gates: spec 56/56, ext-webview 34/34, both tsc, OpenSpec strict,
  diff-check. Verified artifacts: Windows 196/196 + 52/52, black-box
  11/11 with the instant-terminal chain. Remaining P3s (this round):
  stale comment synced; fake-COM handler-level fixtures recorded as a
  follow-up evidence gap (the ledger twins carry the semantics); release
  tasks executed below.

Score trajectory: 5.5 → 7.0 → 7.8 → 8.2 → 8.0 → 8.6 → **9.2 GO**.

Process note for the bias log: the review loop also caught one locally
compiling-but-broken intermediate commit (the build cache had run a stale
product; the Windows host caught `BLOCKED_RING_CAP` unresolved) —
cross-platform compile evidence is part of every round since.
