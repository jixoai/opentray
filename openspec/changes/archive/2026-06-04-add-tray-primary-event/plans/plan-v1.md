# Intent Document

## Current Round

- Round: 1
- Status: research-plan
- Previous plan backup: none

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Rename after intent realignment: `bun run openspec:vision -- rename <old-change> <new-change>`
- Write abnormal-exit handoff: `bun run openspec:vision -- handoff <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 对了，我想补充一种设计，也在你这个worktree 分支直接做了：
> TrayItem 新增一种底层按钮按钮类型，叫做primaryEvent（至于接口设计上你要怎么设计，你自己决策）
>
> 这个事件的作用：
> 比如我声明了两个MenuButton，其中一个是PrimaryMenuButton，点击会触发PrimaryButton。
> 那么就意味着，如果在windows上，左键点击tray托盘图标，等于直接点击了这个primaryButton。这样就可以做到快速打开 webview窗口的效果。
> 同时也不影响在macOS上使用，因为它仍然是一个menubutton，在macOS上，仍然是点击打开菜单，然后点击这个menu打开窗口。
> 还有一种特性，就是如果一共只有一个MenuButton，还是PrimaryMenuButton，那么在macOS上，效果就是不用显示菜单，而是直接触发PrimaryMenubutton的事件。这样做的好处，是开发者可以自己用webview技术开发自己的菜单栏。或者它就是一个单应用程序，那么完全可行。
>
> ---
>
> 我这段话很重要，涵盖了一些新的应用场景，使用openspec vision推进开发。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Add a tray item primary-event design in the same worktree branch. | This change must be scoped to the existing worktree and OpenSpec workflow. |
| 2 | User | `TrayItem` needs a low-level button capability called `primaryEvent`; interface design is delegated to the implementer. | We need choose a public shape that preserves menu semantics and does not fork event routing. |
| 3 | User | If there are two menu buttons and one is primary, Windows left-clicking the tray icon should behave as clicking that primary button. | Native tray activation must be able to route to a selected menu item without showing the menu. |
| 4 | User | macOS with multiple menu buttons should remain normal: click opens menu, then user clicks the menu item. | macOS must not lose normal menu behavior in the common multi-item case. |
| 5 | User | If there is exactly one menu button and it is primary, macOS should direct-trigger the item without showing the menu. | A single-action tray can become a fast launcher for a WebView-built menu or single-app window. |
| 6 | User | The feature enables fast opening of a WebView window and page-owned menus. | The acceptance demo should use `primaryEvent` to open the WebView control window quickly. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/spec/src/index.ts` | Public menu items are currently `item`, `check`, `radio`, `separator`, and `submenu`; tray events already include `menuClick`. | `primaryEvent` can be an additive menu-item role without inventing a second event family. |
| `crates/opentray-spec/src/model.rs` | Rust `MenuItem::Item` is the click-capable plain button variant serialized with camelCase fields. | A `primaryEvent` boolean can round-trip through the protocol without breaking existing item shape. |
| `crates/opentray-core/src/kernel.rs` | Kernel projections copy `Menu` through to backend adapters and route only `MenuClick` to the owning session. | Primary activation should compile into a normal `MenuClick`, preserving session ownership law. |
| `crates/opentray-backend-tray-icon/src/projection.rs` | The tray-icon backend already compiles stable native menu ids and a route table from `(spaceId, trayId, itemId)`. | The backend can add a primary route table without asking core or the daemon to understand menu internals. |
| `crates/opentray-backend-tray-icon/src/native.rs` | `tray-icon` exposes stable tray icon ids, `menu_on_left_click`, and native tray click events for macOS/Windows. | Native runtime can suppress menu-on-left-click for direct primary activation where the platform rule allows it. |
| `crates/opentray-bin/src/main.rs` | macOS broker currently subscribes only to native menu events, not tray icon click events. | The broker composition must add generic tray-icon event ingress for primary activation, still routed through backend/kernel law. |
| `packages/cli/src/smoke/daemon-tray.ts` | The human smoke already has a WebView `Show HTML` menu action. | It can mark that action as primary and test the new fast-open behavior without adding a new demo package. |
| `openspec/specs/broker-daemon/spec.md` | Native backend events must route through the kernel and only reach the owning session. | Primary activation must produce a broker-originated event frame only for the tray owner. |
| `openspec/specs/kernel-runtime/spec.md` | Kernel must stay independent from concrete backends and extension packages. | No `webview` or Windows-specific branch belongs in `opentray-core`. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending; user explicitly asked to continue in this worktree without merging main workspace. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Pending |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed yet |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/client-sdk/spec.md` | The public SDK exposes menu-backed tray creation and broker events. | Extend with a primary menu item role. |
| `openspec/specs/kernel-runtime/spec.md` | Kernel owns Space / Tray / Session ownership and backend projection law. | Extend projection state only; do not add platform click policy to kernel. |
| `openspec/specs/backend-adapters/spec.md` | Backend adapters convert kernel projections into native surfaces and report capability absence honestly. | Extend tray-icon backend projection with primary activation routing. |
| `openspec/specs/broker-daemon/spec.md` | Native events are broker-originated event frames and must route only to the owning session. | Extend with tray primary activation event ingress. |
| `openspec/changes/enrich-webview-window-macos-capabilities/*` | WebView windows are opened through extension commands from menu events. | Reuse the existing WebView action as the primary fast-open example, without coupling tray law to ext-webview. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `primaryEvent` | A normal menu item that also acts as the tray icon's primary activation target. | Primary tray click target. |
| `PrimaryMenuButton` | Developer-facing idea: a menu button with a primary role. | A menu item marked primary. |
| `左键点击tray托盘图标` | Windows-style primary tray activation gesture. | Click the tray icon to fire the primary action. |
| `仍然是一个menubutton` | The item must remain visible and clickable in the normal menu path. | Do not replace it with a hidden command. |
| `不用显示菜单，而是直接触发` | Single primary item on macOS should be direct activation. | One-action status apps should feel immediate. |
| `自己用webview技术开发自己的菜单栏` | App may use tray icon only as launcher and render the menu in a WebView. | A primary action can open a custom WebView UI instead of native menu chrome. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/cli/src/smoke/daemon-tray.ts` | Can a primary menu item quickly open the WebView demo while staying a normal native menu item? | Keep and extend. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should `primaryEvent` be a separate `MenuItem` type or a role flag on `type: "item"`? | A separate type follows the user's words, but a role flag better preserves the fact that it remains a normal menu button. | Use `type: "item", primaryEvent: true` as the public contract. |
| Should disabled primary items still activate from tray icon click? | Disabled menu state should remain authoritative. | Disabled primary items do not become direct activation targets. |
| If multiple items are marked primary, which wins? | Duplicate primary declarations should not create nondeterministic native behavior. | First enabled primary item in menu traversal order wins; docs should discourage duplicates. |

## Intent

### Surface Intent

Add a primary tray action so a developer can keep a normal native menu item while also making tray icon activation trigger that same item. On Windows this enables left-click fast open; on macOS it preserves menu behavior unless the menu is a single primary item, where direct activation is the better one-action app behavior.

### Underlying Drive

The user is moving OpenTray from "system tray menu demo" toward "desktop entry launcher for richer extension UIs". A primary action lets a tray contribution become a launcher for a WebView-owned menu, status window, or single application without forcing all platforms to use the same tray interaction convention.

### Final Visible Effect

The operator can run the daemon tray smoke, click the tray icon in the platform's primary-action case, and see the same event they would have received by selecting the marked menu item. The existing `menuClick` event handler opens the WebView window; no app code needs a second `trayPrimaryClick` handler unless a later feature proves it necessary.

## Platform Diagnosis

- Current platform laws: `MenuItem` is public protocol data, kernel derives backend projections, backend/native runtime compiles menu ids, broker routes native events through kernel session ownership.
- Does this fit as a regular atom: yes, if primary activation compiles into existing `menuClick` routing.
- Does this require law upgrade: yes, but narrow: menu item projection gains a primary role and native tray click ingress can route to that role.
- Breaking update stance: additive field on `type: "item"`; no protocol version bump unless validation shows incompatible wire parsing.
- User confirmations still required: none before implementation; the user delegated interface shape.

## Reverse-Inferred Design

### Interaction / Visual Story

A developer marks `Show Window` as the primary menu item. On Windows, the user left-clicks the tray icon and the WebView window opens immediately; right-click still exposes the native menu. On macOS with several items, clicking the menu bar item still opens the native menu and the user can choose `Show Window`. On macOS with exactly one primary item, clicking the menu bar item fires it directly, so the app can use WebView for its own menu or window surface.

### Interface Shape

- `MenuItem` plain button variant gains `primaryEvent?: boolean`.
- The item still serializes as `type: "item"` and still emits `menuClick` with the same `itemId`.
- The public handler stays:
  - `frame.type === "event"`
  - `frame.event.type === "menuClick"`
  - `frame.event.itemId === primaryItemId`
- Backend capability metadata is not needed yet because unsupported platforms can retain normal menu behavior.

### Data Shape

- Menu declaration: zero or more `item` entries may carry `primaryEvent: true`, but only the first enabled one is used as the primary target.
- Kernel projection: carries the full `Menu`; no platform gesture policy enters kernel state.
- Tray-icon backend projection: compiles primary item id into a native tray-icon-id to menu-id route.
- Native runtime state: tracks which tray icons should direct-trigger primary action on left click for the current platform.
- Broker event: still `TrayEvent::MenuClick`.

### Architecture Shape

- `@opentray/spec` owns the public TypeScript protocol field.
- `opentray-spec` owns the Rust protocol model field.
- `opentray-core` copies menu state through projection and keeps routing `MenuClick`; it does not interpret Windows/macOS click conventions.
- `opentray-backend-tray-icon` owns menu projection, stable native tray icon ids, primary route table, and platform-specific menu-on-left-click choices.
- `opentray-bin` owns event-loop ingress for native tray icon clicks and routes direct primary activation through the existing backend/kernel/session path.
- `packages/cli` demo owns the WebView fast-open example.

Forbidden couplings:

- no `if ext == "webview"` in tray law
- no new `trayPrimaryClick` public event unless a future product story proves a distinct event is necessary
- no core-level Windows/macOS branch
- no hidden native-only command that bypasses `menuClick`

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Separate item type vs role flag | The user named `primaryEvent` but delegated interface design. | Use role flag for normal-menu preservation. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should non-plain menu item variants such as check/radio be allowed as primary? | Check/radio primary action could mutate UI state unexpectedly when tray icon is clicked. | Only plain `type: "item"` supports `primaryEvent` in this change. |
| Should Linux get primary activation now? | `tray-icon` documents Linux tray icon events as unsupported, and Linux desktop standards differ. | Linux keeps normal menu behavior until a Linux backend has real event evidence. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Add a new public `trayPrimaryClick` event | It would split application handlers even though the user wants primary activation to equal clicking a menu button. |
| Put Windows/macOS click policy in `opentray-core` | Core owns session/projection law, not platform gesture semantics. |
| Make `primaryEvent` a hidden tray-level command | It would violate the user's requirement that it remains a normal menu button on macOS. |
| Make every single-item menu direct-trigger on macOS | The direct behavior should be opt-in via `primaryEvent`, not surprising for existing menus. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 3
- Custom exit condition from intent: specs, protocol types, Rust model, backend projection, native macOS ingress, and daemon tray/WebView smoke example all prove a primary menu item remains a normal `menuClick` while direct tray activation works where the platform rule allows it.
