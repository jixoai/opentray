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

- R1: pending (`herdr` agent `navfav-codex`, workspace `zcode-opentray-navfav`).
  Result recorded below when the round completes.
