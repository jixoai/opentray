# Intent Document

## Current Round

- Round: 3
- Status: implemented and targeted-verified
- Previous plan backup: `plans/plan-v3.md`

## Original User Input

> Implement the plan.

Earlier requirement-bearing inputs for this round:

> Platform-specific interfaces should be strict. Portable interfaces should be lenient, with documented fallbacks instead of throwing for every unavailable option. Developers can still observe errors through event APIs.

> `TrayHandle.setTitle` is required. Event authority should follow a single trusted source principle and come from a real broker connection. Placement support must include `tray`, `cursor`, `screen-center`, `screen-top`, `screen-right`, `screen-bottom`, `screen-left`, `screen-top-left`, `screen-top-right`, `screen-bottom-left`, and `screen-bottom-right`, plus `placementMargin`. Put this capability in WebviewExt.

> Do not mutate or inject user HTML. Skills should remind users to use overlay-related APIs for drag areas. Do not prescribe CSS recipes; explain best practices and reasons so users can decide. Scenario examples should cover most common demand and leave unusual combinations to users.

> Add missing `navigator.opentrayWindow.show()` / `hide()` page APIs on Windows and macOS. Rename the broad review demo to a specialized `example:placement`. Make placement continuous by default with `watch` / `unwatch` / `once` / `applyOnce`, add edge snapping placements, keep the one-shot algorithm based on `anchorBound + windowBound + viewport`, and leave a future `positionTry` TODO. During Windows resize, reuse the white-block host-surface cleanup technique because hide/show clears similar resize residue.

Follow-up review and implementation input:

> Review the recent Windows-focused adaptation commits and then align macOS with the newly added and changed interfaces.

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | `TrayHandle` needs `setTitle`; dynamic tray state is a key interface. | Add title mutation beside menu/icon/tooltip. |
| 2 | User | Event APIs must follow single trusted principle and come from the real broker connection. | Split request-only transport from eventful connection/handles. |
| 3 | User | Placement needs `tray`, `cursor`, `screen-center`, all screen edges/corners, and `placementMargin`. | Add generic placement kit in WebView extension. |
| 4 | User | Do not add a special `createWebviewPanel`; teach composition through skills and expose general utilities. | Build `WebviewPlacementKit`, not a panel atom. |
| 5 | User | Do not pollute user HTML; remind users to use overlay APIs for drag areas. | Skills guide decisions, not DOM mutation. |
| 6 | User | Do not prescribe CSS; explain best practices and reasons. | Scenario guidance uses principles and snippets, not fixed CSS recipes. |
| 7 | User | Page window API needs reversible `show` / `hide`; placement should be continuous by default and support edge snapping; Windows explicit resize should reuse the white-block cleanup path. | Add page visibility verbs, redesign placement watch semantics, and refresh Win32 host surface after `resizeTo`. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/cli/src/client.ts` | `TrayHandle` has `getBounds`, extension verbs, and `destroy`, but no dynamic setters or tray-scoped listeners. | SDK lacks the consumer-facing atoms seen in the Pomodoro demo. |
| `packages/spec/src/index.ts` | Protocol already has `set-tray-menu/icon/tooltip` but no `set-tray-title`; `trayClick`/`trayDoubleClick` lack `trayId`. | Dynamic title and reliable tray-scoped event filtering need protocol changes. |
| `crates/opentray-core/src/kernel.rs` | Kernel already owns tray options and syncs projections. | Title mutation fits current tray law as a normal atom. |
| `packages/ext-webview/src/index.ts` | Page-side APIs include move/resize/screen/tray, but host-side `WebviewWindowHandle` lacks move/resize. | A host placement kit needs host geometry commands. |
| `skills/opentray/*` | Consumer skill is still API-list oriented. | Needs scenario cards and decision guidance. |
| `cargo test -p opentray-ext-webview` | Native WebView tests failed to compile because the macOS `NavigatorWindowBridge` fixture was missing new IPC and size-constraint fields. | macOS parity could not be claimed until the native extension test gate passed. |

### User Language System

| User phrase | Working meaning |
| ----------- | --------------- |
| Platform-specific interfaces are strict; portable interfaces are lenient | Native substrate errors stay explicit; portable helpers may choose documented fallback. |
| Single trusted source principle | Do not synthesize event authority from request-only handles. |
| Do not mutate user HTML | OpenTray should not inject app UI structure or CSS. |
| Scenario examples cover common demand | Skills should teach common composition patterns and leave unusual combinations to users. |

## Intent

### Surface Intent

Make the SDK and skills usable for real tray apps such as a lightweight Pomodoro panel without forcing users into raw broker frames, handwritten event filtering, or ad hoc placement math.

### Final Visible Effect

A consumer can create a tray, mutate its menu/title/tooltip/icon, listen to tray-owned events from the tray handle, mount WebView, and place a window near tray/cursor/screen positions through a general placement utility. Skills explain which atoms to compose for common desktop surfaces without rewriting the user's HTML.

## Platform Diagnosis

- Current platform laws: Space owns aggregation, Tray owns contribution/state/events, WebView extension owns native window capabilities.
- Fits as regular atom: dynamic tray state and title mutation fit current tray projection law.
- Requires law upgrade: eventful tray handles require a trusted event source boundary; placement needs a host-side WebView geometry atom.
- Breaking update stance: allowed. Additive wire changes are preferred, but event payloads may become stricter by requiring `trayId`.
- User confirmations still required: none for this implementation round.

## Reverse-Inferred Design

### Interface Shape

- `TrayHandle` exposes dynamic state setters and broker-backed event helpers.
- Request-only handles remain possible, but event helpers require an eventful connection.
- `@opentray/ext-webview` exports `WebviewPlacementKit`, which resolves one-shot placements and watches continuous placements using injected tray/screen/cursor authorities.
- Skills teach scenario decisions and show concise source snippets, not hidden DOM/CSS rewrites.

### Architecture Shape

- `opentray-core` remains generic and sees only tray projection changes.
- `@opentray/ext-webview` owns placement utilities because the utility composes WebView geometry with tray/screen/window atoms.
- `opentray` SDK owns broker event filtering because the broker event stream is its public connection law.
- Consumer skills are documentation atoms, not runtime behavior.
- Windows resize artifact cleanup belongs to the WebView extension's Win32 substrate. It must reuse host-surface refresh, not hide/show, maximize, or WebView rebuilds.
- macOS keeps the same page command channel as Windows, but Windows-only repair commands must parse and authorize as no-ops rather than becoming fake macOS behavior.

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement tasks.
- [x] 5. Self-review against intent and decide whether to loop.
- [x] 6. Follow-up macOS alignment review and native test repair.

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| `createWebviewPanel(...)` | It hardens one scenario instead of exposing composable placement/window atoms. |
| Auto-inject drag areas or CSS into user HTML | It violates user ownership of UI structure and would create hidden behavior. |
| Tray-scoped events on request-only transports | It fakes authority and breaks the single trusted principle. |
| Raw `connection.onEvent(...)` as the normal consumer story | It leaks broker frames into application code. |

## Exit Conditions

- TypeScript and Rust protocol tests cover tray title/event shape.
- SDK tests cover setters and tray-scoped events.
- WebView facade tests cover placement resolving/applying.
- WebView facade tests cover continuous watch, edge placement, and page-side `show` / `hide` typing.
- Windows runtime code records and reuses the host-surface resize cleanup path.
- Skills explain scenario composition and avoid DOM/CSS pollution guidance.
- `pnpm --filter opentray example:placement` is the reviewable demo entrypoint.
- `cargo test -p opentray-ext-webview` covers macOS bridge parity after Windows interface expansion.
