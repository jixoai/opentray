# smoke6 — 8.3 macOS real smoke: loadState (D24) + auxiliary popup windows (D26)

Date: 2026-09-12 (task 8.3). Driver: `smoke6-driver.ts` (ran from
`packages/ext-webview/` with `bun`; archived here — its relative imports
`../cli/src/…` and `./src/…` refer to that original location).
Evidence: `smoke6-loadstate-popup.ndjson` (timeline + summary asserts).

## Setup

- Fresh isolated `HOME=/tmp/opentray-83-smoke-home` per run.
- Source-built artifacts staged into the workspace via
  `scripts/binaries/stage-local.ts` (`--kind webview` release dylib from this
  branch's `crates/opentray-ext-webview`; broker reused the already-staged
  `packages/darwin-arm64/bin/opentray`).
- Parent process = local HTTP+SSE evidence server + session B
  (`orch.eight3.b`); spawned child = session A (`orch.eight3.a`). The child's
  process exit closes its broker connection, driving real `session_closed`
  cleanup. Window liveness cross-checked with a Swift `CGWindowList`
  (on-screen windows whose owner is `83SmokeA`/`83SmokeB`).
- Each session: one window session (`appMode`), toolbar+content children,
  declarative column layout; content pages open popups themselves
  (`window.open` at +1.2/1.5 s, `a[target=_blank]` synthetic click at +2.6 s)
  and hold SSE streams (`/events?src=…`) so document death (= popup/webview
  teardown) is observable server-side.

## Verified (PASS)

| Claim | Evidence |
|---|---|
| `window.open` opens a session-owned popup | `/a-popup-open.html` + `/b-popup.html` SSE connects, http hits, on-screen NSWindows owned by the carrier app; plain titled window, no toolbar |
| `target=_blank` opens a popup through the same native path | `/a-target.html` SSE + http hit; second concurrent popup in session A |
| Session close closes ALL of that session's popups, not other owners' | child exit → `a-main`, `a-popup-open`, `a-target` SSEs drop in the same instant; B untouched (its popup stays; window count `83SmokeB` remains) |
| Explicit window destroy closes that tray's popups | `win.destroy()` → `b-popup` + `b-second` drop; final on-screen count 0 |
| loadState started/finished with url | `b-main.html`, `b-second.html` frames carry url, per-view seq, `progress:1` on finished |
| loadState failed with errorCode | hang-then-navigate: `didFailProvisionalNavigation` (NSURLErrorCancelled −999) → `failed … errorCode=-999` frame delivered to the facade |
| capability surface | unit-tested in `macos/tests.rs`: `popupWindows: true`, push kinds now include `loadState` |

## Recorded (host-limited or substrate behavior)

- **Dead-port `loadRequest` failures do not call `didFail*` on this macOS 26
  WebKit** — WebKit commits `about:blank` instead (observed as honest
  started/finished `about:blank` frames). Cancellations do deliver
  `didFail` (−999). 8.5's toolbar must treat any terminal phase as
  progress-close; 8.4 must verify Windows `NavigationFailed` coverage itself.
- **Middle-click / right-click menu cannot be driven on this host** (synthetic
  input blocked: osascript assistive access −25211, no cliclick/pyobjc — same
  constraints as smoke2-focus). Both routes funnel into the identical
  `WKUIDelegate webView:createWebViewWithConfiguration:…` callback that
  `window.open`/`target=_blank` exercised; wry's UI delegate being installed
  is what enables WebKit's default context-menu "Open Link in New Window"
  entry.
- **App-activation is machine-blocked** (frontmost pinned elsewhere), so
  app-mode main windows auto-hide on blur; on-screen window counts
  under-report and SSE liveness is the authoritative death signal.
- **Progress frames**: `estimatedProgress` KVO fires natively (observed in an
  instrumented debug build), but local loads complete faster than the 0.05
  throttle + subscription landing, so no intermediate progress frames were
  delivered in these runs; throttle semantics are unit-covered.

## Found & fixed during this smoke (pre-existing, not an 8.3 regression)

Legacy `show()` primary + later orchestration children crashed the broker at
wry `wkwebview/mod.rs:392` (`ns_view.window().unwrap()`): wry's non-child
`build()` **replaces** the window's content view, so OpenTray's cached
`bridge.content_view` was detached and the first `create-webview` aborted the
whole broker process (SIGABRT). Reproduced on the pre-change dylib
(baseline). Fixed in `build_child_webview` by resolving the host view from
the live `session.window.contentView()` (same pattern the layout tracker
already uses). `windowOnly` sugar paths were never affected.

## Operational lesson

Staging a new extension dylib while a same-endpoint broker stays alive keeps
serving the OLD dylib (already-running reuse keys on broker artifact
identity, and the extension is loaded at broker start). Two misleading
mid-investigation runs (no delegate callbacks at all) were stale-broker
artifacts; fresh `HOME` per run is mandatory for dylib-iteration smokes.

## Process recovery

No orphan processes: both smoke brokers exited on their last session close
(`broker-exit` in their logs); nothing holds `/tmp/opentray-83-smoke-home`.
The three unrelated `opentray` processes visible on this host predate this
task and were left untouched.
