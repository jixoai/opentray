# Intent Document - OpenTray v0.9 Tray-First API Reset

## Current Round

- Round: 1
- Status: implementation in progress / tray-first public API being applied to CLI, examples, and protocol mirrors
- Previous plan backup: `plans/plan-v10.md`
- User-facing name: `opentray-v0.9`
- OpenSpec change id: `opentray-v0-9`

`opentray-v0.9` was the requested name, but the local `vision-driven` workflow rejects `.` in change ids. The persisted OpenSpec change is therefore `opentray-v0-9`; this document keeps `opentray-v0.9` as the product/design name.

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

> 我觉得是不是可以彻底移除space的概念，只留下createTray入口就好，把createSpace的参数融合到Tray中

> 我的想法是：
> createTray({id:"com.example.build",title:"Build",icon,menu})
>
> 但是我不知道这里面有什么坑

> 后面使用中文作为母语来思考和沟通
>
> 我们现在来整体梳理一下接口设计， 我不打算做任何向下兼容，我希望一步到位设计好。

> title和tooltip的差别是什么？我以为title是hover到tray-icon的时候显示的文本。那tooltip是什么？

> 1. 不希望有共享的概念了，所以底层也要破坏性更新，我目前往这个方向设计，核心目的是希望每个使用opentray的程序，都能隔离自己的tray/borker而不是共享。
> 就是希望opentray这个名字不要再出现在任务栏中。
> 2. 如果title和icon存在重叠，我个人的建议是参考Web响应式的设计，让icon支持一个数组，配置多种响应结果，从而让内核自己选择最合适的结构来展示

> 1. 我还是不理解为什么要有两个id，trayid的意义是什么？你的意思是同一个appid，可以同时exit然后关闭多个tray？
> 2. appearance这个字段改成 icons，然后使用map设计，icon:{'icon-text':...,'icon','text'}

> 你开一个openspec change：opentray-v0.9 我们在此展开详细的讨论和记录

> 你说 app id/name 可以从 package/process/caller 推导。这个虽然很理想，但是怎么做到？开发模式下、被bundle的模式下、被直接打成一个二进制文件的情况下，这些你有考虑过吗？

> 目前你icons的设计我不满意，我觉得可以改，直接移除icons，统一用icon这个字段。
> 首先还是目前这套 `type Icon` 为基础，改成 `type IconImage`，在它的基础上，我们定义一个`type Icons`
> ```
> type Icons = {
>   'icon-only'?:IconImage
>   'text-only'?:string
>   'text'?:string
>   'icon-text'?:IconImage&{text}
> }
>
> type Icon = Icons&IconImage
> ```
>
> 注意我的设计，你会发现 Icons&IconImage 这个类型本身就是魔法。
>
> 简单来说，这个type Icon需要这样处理：
>
> const textIcon = config.icon['icon-text']
> const iconOnly = confifg.icon['icon-only']
> const textOnly = typeof config.icon[text-only]
> const fallbackIcon = pick(config.icon,'type,data,path,width,height,text')??textIcon??iconOnly??textOnly // 伪代码
>
> 然后按照这个顺序： iconOnly/textOnly/textIcon/fallbackIcon 来生效。only模式的特殊在于，必须是“only”才能生效，所以它的优先级最高，但同时最终可以用来做fallback
>
> ---
>
> 如果理解就更新spec

> type SimpleIcon = IconImage&{text?:string}
> type Icon = Icons&SimpleIcon;
> 这样Icons就可以更加纯粹了，不需要text字段

> 对了，title是不是也应该融合到icon字段中。

> 嗯，不做兼容。

> 还有一个问题，就是opentray的启动是js代码，但是启动后opentray用borker在后台运行。那么这里就会有一个矛盾点：
> 启动者可能已经死了，而opentray自身还活着，这时候它的事件发出来，就没有程序能处理了。
>
> 是不是有这个问题？

> 或者我们分成两种模式：一种是直接createTray
> 一种是先createBorker，然后再由这个borker来注册tray。
>
> 后者就是我说的service-worker的模式。前者会更加自由，等于开发者自己维护一套后台服务，或者干脆就没有后台模式。而createBorker等于是我们开箱即用的守护进程。
>
> 我在想这要不要分开两个包，架构上要怎么连接怎么设计。
>
> 如果纯化来说，我们不应该字节耦合service-worker的设计。tray不该管这些。但是后台服务又是非常常见的。
>
> 我们需要讨论

> 所以我打算完全移除broker的概念。让开发者自己去实现后台模式，你觉得呢？

> 哦对了，因为现在tray更纯了，所以二进制分发的时候，我建议分发成 `.node` 文件，而不是现在这种独立的可执行文件。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Asked whether `Space` can be removed completely and whether `createSpace` parameters can be merged into `Tray`. | Treat public `Space` as suspect ontology, not a compatibility concern. |
| 2 | Assistant | Proposed tray-first public API while warning that old `SpaceOptions` must be split by real ownership. | Seeds the investigation axis: tray facts vs caller/session facts vs projection facts. |
| 3 | User | Proposed `createTray({ id: "com.example.build", title: "Build", icon, menu })` and asked for hidden traps. | The primary design target is a single low-ceremony `createTray` entrypoint. |
| 4 | Assistant | Identified the key trap: `id` must not simultaneously mean app id, tray id, daemon id, grouping id, and permission token. | Forces explicit identity law before specs. |
| 5 | User | Required Chinese-native communication and no backward compatibility; wants an up-front v0.9 design. | This is a law-breaking API reset, not incremental cleanup. |
| 6 | Assistant | Proposed public ontology: `Tray` only; `Space`, `Surface`, `Lease` removed from developer path. | Establishes candidate v0.9 platform language. |
| 7 | User | Asked why `title` and `tooltip` both exist; believed tray hover text is `title`. | Need clear display/hover/accessibility vocabulary before locking API fields. |
| 8 | Assistant | Proposed `title = visible short text`, `tooltip = hover/accessibility text`; no tooltip defaults can reuse title. | Candidate display semantics, still open to naming refinement. |
| 9 | User | Confirmed no shared concept even internally; every OpenTray-using program should isolate its own tray/broker; `opentray` should not appear in task manager. Also proposed responsive icon/display candidates. | This upgrades the work from public API cleanup to a bottom-layer destructive rewrite. |
| 10 | Assistant | Proposed `App/Caller` as isolation boundary, `Tray` as atom, private broker per caller, and candidate display projection selection. | Establishes architecture direction: app/caller identity owns broker; tray owns status atom. |
| 11 | User | Challenged the need for two ids and proposed map-shaped display candidates under `icons`, including `icon-text`, `icon`, and `text`. | Identity law and display field naming remain the two active design questions. |
| 12 | User | Asked to create OpenSpec change `opentray-v0.9` for detailed discussion and record keeping. | Create this change as the design SSOT before specs/tasks. |
| 13 | User | Challenged the claim that app id/name can be inferred from package/process/caller, specifically asking about dev mode, bundled mode, and direct single-binary mode. | App identity inference must become a tiered, testable law; explicit declaration may be required for stable release identity. |
| 14 | User | Rejected the separate `icons` field, requested a unified `icon` field, renamed old icon payload to `IconImage`, defined `Icons`, and made `Icon = Icons & IconImage` with `icon-only`, `text-only`, `text`, and `icon-text` candidate keys. | The display candidate container is settled as `icon`; spec must encode the intersection-type "magic" and deterministic selection order. |
| 15 | User | Refined the type to `type SimpleIcon = IconImage & { text?: string }` and `type Icon = Icons & SimpleIcon`, making `Icons` pure by removing the generic `text` field from it. | Update spec so fallback text lives on `SimpleIcon`, while `Icons` only carries explicit mode candidates. |
| 16 | User | Asked whether `title` should also be merged into the `icon` field. | Tray visible text should be treated as icon projection text, not a second top-level source. |
| 17 | User | Confirmed no compatibility. | Specs and tasks must remove old public fields, aliases, and protocol shapes rather than preserving shims. |
| 18 | User | Pointed out that JS starts OpenTray, but the broker runs in the background; if the starter dies while broker lives, broker events have no program to handle them. | v0.9 must define caller death as authority loss: trays/routes/extensions are removed, events are not emitted to nowhere, and broker may only idle/exit. |
| 19 | User | Proposed two modes: direct `createTray`, and `createBorker`/broker-worker mode where a broker registers trays from an independent JS/TS entry similar to service-worker. Also raised whether this should be split into separate packages because tray should not own background service concerns. | Introduce a package/boundary design question: tray capability and managed background runtime are separate atoms that may compose but should not be byte-coupled. |
| 20 | User | Proposed completely removing the broker concept and letting developers implement background mode themselves. | Strongly consider removing public managed broker/worker from v0.9 scope; OpenTray becomes a tray capability/runtime binding, not a daemon framework. |
| 21 | User | Proposed distributing the tray runtime as `.node` native modules instead of standalone executable files because the tray atom is now purer. | Reframe platform packages from broker executable distribution atoms into host-process native binding atoms. This is a second-order break affecting package layout, release artifacts, runtime ownership, and extension loading. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `AGENTS.md` | Current project guide still says `Surface` is broker-owned desktop entry and aggregation boundary; OpenSpec workflow keeps `plans/plan.md` as SSOT. | Shows current local guide lags the user-desired v0.9 direction; this plan must be the active SSOT for the new break. |
| `openspec/specs/kernel-runtime/spec.md` | Current archived law already says a `Space` is scoped to exactly one caller session and the kernel SHALL NOT aggregate trays from multiple sessions. | Shared surface was already collapsed, but `Space` vocabulary remains. v0.9 can finish the ontology cleanup. |
| `openspec/specs/client-sdk/spec.md` | Public SDK still documents `createSpace`, deprecated `createSurface`, and default-space resolution. | v0.9 likely breaks this surface and replaces it with tray-only public creation. |
| `packages/cli/src/sdk.ts` | Top-level exports include `createSpace`, deprecated `createSurface`, `resolveDefaultSpace`, and `createTray`. | Confirms the public API still has space law exposed. |
| `packages/spec/src/index.ts` | Protocol still exposes `SpaceOptions`, `SpaceRef`, `spaceId`, and `create-space` frames. | Removing `Space` is a protocol/data-shape break, not just TypeScript sugar. |
| `openspec/changes/archive/2026-06-24-collapse-shared-surface-and-pin-broker-to-caller/plans/plan.md` | Existing archived decision collapsed shared surface, pinned broker to one caller, rejected FFI embedding, and required task-manager identity to carry caller label. | v0.9 should build on this decision rather than re-litigating shared broker removal. |
| `git status --short --branch` | Worktree started clean on `main...origin/main`. | New OpenSpec artifacts are isolated changes. |
| User question about dev/bundled/single-binary modes | App identity derivation is environment-dependent and can be lossy. | `app.id` cannot be treated as reliably inferable in every deployment form. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Not ready; discussion plan only. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Not started. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Not started. |
| Normal archive | Commit containing `openspec archive <change>` result | Not started. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not needed. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `archive/2026-06-24-collapse-shared-surface-and-pin-broker-to-caller` | One broker serves exactly one caller; broker process identity must be caller-derived; shared surface is removed. | Reuse as confirmed base law. |
| `openspec/specs/kernel-runtime/spec.md` | `Space / Tray / Session` public law; `Space` is one caller-scoped desktop boundary. | Break: remove `Space` as public and likely internal ontology. |
| `openspec/specs/client-sdk/spec.md` | Top-level `createSpace`, `resolveDefaultSpace`, and `createTray` through default space. | Break: make `createTray` the single public creation entrypoint. |
| `openspec/specs/broker-daemon/spec.md` | Caller label isolates broker endpoints and daemon state. | Extend: make caller/app identity the primary isolation boundary for v0.9. |
| `openspec/specs/backend-adapters/spec.md` | Backend consumes `SurfaceProjection`; tray placement is keyed by `(spaceId, trayId)`. | Break or rename: replace `spaceId` with caller/session-owned projection identity or remove if no longer needed. |
| `openspec/specs/extension-host/spec.md` | Extension scope is `surface` plus optional tray. | Break: extension scopes should conserve to caller/session authority plus tray id unless a session-level extension is explicitly justified. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `彻底移除space的概念` | Do not keep `Space` as public or internal law if it no longer carries real ontology. | Remove dead grouping concept. |
| `不打算做任何向下兼容` / `不做兼容` | v0.9 SHALL delete deprecated APIs, protocol fields, aliases, and docs in one break. | No migration shim, no deprecated alias, no old protocol parsing. |
| `启动者可能已经死了，而opentray自身还活着` | Detached broker can outlive the JS caller process. | Broker lifetime must not imply continuing caller authority. |
| `事件发出来，就没有程序能处理了` | Backend/native events after caller death would have no recipient and no valid source-of-action chain. | Drop/diagnose events after session cleanup; do not queue or broadcast. |
| `两种模式：一种是直接createTray ... 一种是先createBorker` | Separate direct tray capability from managed background runtime. | Model direct and managed modes as different runtime atoms. |
| `service-worker的模式` | A background JS/TS entry owns event handlers and tray registration independently of the initial launcher. | Use as analogy only; do not import browser service-worker semantics blindly. |
| `tray不该管这些。但是后台服务又是非常常见的` | Tray is capability ontology; background worker is lifecycle/runtime ontology. | Keep package/boundary separation; compose through explicit contracts. |
| `完全移除broker的概念` | Public API should not teach or expose broker as a product object. | Delete public broker ontology; any native host is implementation detail. |
| `让开发者自己去实现后台模式` | Background service lifecycle belongs to the application, not OpenTray. | Document direct-process lifetime and integration recipes instead of shipping managed broker. |
| `.node 文件，而不是现在这种独立的可执行文件` | Native tray runtime should load into the host JS process rather than spawning a standalone OpenTray daemon executable. | Replace broker binary distribution with native binding distribution if Node remains a first-class runtime target. |
| `一步到位设计好` | Design the target law before coding patches. | Architecture-first reset. |
| `每个使用opentray的程序，都能隔离自己的tray/borker` | The caller/app is the isolation boundary; no shared broker, no shared tray registry. | Private broker per app/caller. |
| `opentray这个名字不要再出现在任务栏中` | Runtime projection must be attributed to the real caller, not the library. | Task manager / OS identity shows host app, not OpenTray. |
| `参考Web响应式的设计` | Caller provides multiple display candidates; runtime chooses by platform capability. | Responsive projection candidates. |
| `icon支持一个数组` / `map设计` | Visual/display candidates should be declarative and selected by capability. | Candidate map or array for tray display. |
| `直接移除icons，统一用icon这个字段` | The public API should not add a second display container; `icon` itself carries image and responsive projection candidates. | Use `icon` as both simple `IconImage` and structured candidate map. |
| `Icons&IconImage 这个类型本身就是魔法` | Intersection type compresses simple and advanced API shapes into one field. | Preserve the type-level compression intentionally; do not split into `display`/`icons`. |
| `SimpleIcon = IconImage&{text?:string}` | Generic fallback image and fallback text belong together as the simple icon shape. | Introduce `SimpleIcon` as the fallback atom above `IconImage`. |
| `Icons就可以更加纯粹了，不需要text字段` | Explicit candidate map should contain only explicit projection modes, not generic fallback text. | Remove `text` from `Icons`; keep `text-only` and `icon-text`. |
| `title是不是也应该融合到icon字段中` | Top-level tray visible text likely duplicates `SimpleIcon.text` / `icon-text.text`. | Fold tray display title into `icon`; remove top-level `title` as source truth. |
| `only模式的特殊在于，必须是“only”才能生效` | Explicit only candidates should outrank generic candidates but can still serve as fallback. | Selection order must respect only-specific priority and fallback law. |
| `title和icon存在重叠` | Visible text and icon can both represent state; platform may choose one or both. | Avoid treating one projection as ontology. |
| `开发模式下、被bundle的模式下、被直接打成一个二进制文件的情况下` | Identity source must survive different JavaScript/runtime packaging shapes. | Do not hide unstable inference behind a stable API promise. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none yet | The current round is interface discussion and record keeping. | Add `demos/` only if API examples need executable type checking before specs. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Is public `id` app identity or tray identity? | If one `id` does both, it becomes an architectural singularity. | Prefer `id` as app/caller identity only if v0.9 intentionally supports one tray per app by default; otherwise derive app identity separately and use `id` for tray identity. |
| Should v0.9 allow multiple tray atoms inside one app/broker? | This decides whether a second visible tray is a first-class atom or unsupported complexity. | Support multiple tray atoms internally, but keep the default API single-tray ergonomic. |
| Should the display candidate field be called `icons`, `display`, or another name? | User rejected separate `icons` and requested unified `icon`. | Settled: field is `icon`; old `Icon` payload becomes `IconImage`; responsive candidates are represented by `Icon = Icons & IconImage`. |
| Should `title` stay as a top-level sugar field? | Top-level `title` duplicates `SimpleIcon.text`, `text-only`, and `icon-text.text`. | Settled: remove top-level `title` as tray display text source for v0.9. |
| What is the exact OS-level proof for "opentray name disappears"? | Task manager naming can mean process title, binary name, tray tooltip, app menu name, or Dock/taskbar identity. | Use the archived caller-pinned broker law as the baseline, then add v0.9 acceptance per platform. |
| Can `app.id/name` be inferred in dev, bundled, and single-binary modes? | If not, the isolation identity must be declared explicitly or the broker boundary becomes unstable. | Inference can be fallback only; stable app identity should be explicit or generated by a build-time manifest. |
| What happens when the caller dies before the broker exits? | A background broker without caller authority must not keep visible interactive effects alive. | Immediate session cleanup; remove trays/extensions/routes; broker may remain only as idle process with no visible/runtime effects. |
| Should direct `createTray` and managed `createBroker`/worker live in one package or separate packages? | Package boundary decides whether tray API is polluted by background lifecycle concerns. | Prefer separate atoms/packages with one convenience re-export only if it does not hide the boundary. |
| What is the authoritative JS/TS event handler in managed mode? | If the launcher exits, events need a living worker entry rather than a dead process. | Managed mode should run an explicit worker entry under Node/Deno/Bun and bind tray/event lifetime to that worker. |
| Should public v0.9 remove `createBroker` entirely? | If OpenTray owns no background mode, `createBroker` should not exist as public law. | Current user direction: yes, remove public broker; developers own background services. |

## Intent

### Surface Intent

Open a v0.9 design change where OpenTray drops `Space` and public `Broker` as user-facing concepts, defines tray-first direct APIs, lets the application own background/service lifecycle, and designs responsive tray display candidates without preserving backward compatibility.

### Underlying Drive

The user is pushing OpenTray away from "shared tray platform" and toward "private desktop status runtime for each app/caller." The desired shift is not a naming cleanup. It is a bottom-layer reset:

```text
old pressure:
shared broker -> Space aggregation -> Tray contribution -> projection

new pressure:
app process/service -> Tray atom -> responsive projection candidates -> native runtime binding
```

The deeper rule is conservation of source: every visible process, tray item, event, and mutation must trace to the real host application, not to `opentray` as a generic library name or to a ghost `Space` grouping.

This also applies after caller death. If the JS starter process exits, crashes, or disconnects, the broker no longer has an authorized action source for that app's tray. The broker may remain alive as an idle implementation process, but it must not preserve visible tray state or emit events to a dead caller.

The later design discussion considered a managed worker mode, but the current purification direction removes public broker/worker ownership from OpenTray. The action source should be the developer-owned process:

```text
developer-owned foreground process
    or
developer-owned background service
    |
    v
createTray -> event handlers in that process
```

If developers need daemon behavior, they should run their own Node/Deno/Bun service, systemd service, launchd agent, Windows service, PM2 process, or packaged binary. OpenTray should provide tray capability and native runtime binding, not a background-service product law.

This pushes binary distribution in the same direction. A standalone `opentray` executable implies an OpenTray-owned process and therefore reintroduces a broker-shaped ontology through packaging. A `.node` native binding implies the opposite law:

```text
developer-owned JS process
    |
    v
loads platform native tray binding (.node)
    |
    v
native tray projection owned by that process lifetime
```

For Node, `.node` should therefore be the preferred native distribution form for the core tray runtime if v0.9 fully removes public broker ownership. Deno and Bun may still require separate loading adapters or FFI packaging strategy, but those should be runtime adapter questions, not a reason to keep a standalone broker executable as the core product law.

The latest identity question makes one constraint explicit: inferred app identity is convenient but cannot be the only legal source. In dev mode, package metadata may be available. In bundled JavaScript, package metadata is often erased or rewritten. In a direct single-binary distribution, the executable name and embedded metadata may be the only stable source. v0.9 needs a tiered identity law rather than one magic inference path.

### Final Visible Effect

Direct-mode developer can write the main path without learning `Space`:

```ts
await createTray({
  id: "com.example.build",
  icon: {
    type: "file",
    path: "build.png",
    text: "Build",
  },
  menu,
});
```

The operating system does not show a generic `opentray` owner for that program's tray runtime. Each OpenTray-using program owns its own process/service lifetime. Display projection chooses the best available platform structure from declarative candidates rather than forcing every platform into one `title + icon` shape.

Background-mode developer can write a normal app-owned service:

```ts
// service.ts, owned by the app, run by node/deno/bun/systemd/launchd/etc.
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.build",
  icon: { type: "file", path: "build.png", text: "Build" },
  menu,
});

tray.onMenu("quit", () => {
  tray.destroy();
});
```

## Platform Diagnosis

- Current platform laws: archived current law already collapsed shared surface and pins one broker to one caller, but public SDK/protocol/docs still expose `Space`, `spaceId`, `createSpace`, `resolveDefaultSpace`, and surface-derived backend vocabulary. The newest discussion questions whether public `Broker` should exist at all.
- Does this fit as a regular atom: no.
- Does this require law upgrade: yes. This is a destructive public API, protocol, kernel, extension-scope, and docs reset.
- Breaking update stance: full break for v0.9; compatibility shims are forbidden.
- User confirmations still required: identity semantics, multi-tray support, display candidate naming, and platform proof surface for OS identity.

## Reverse-Inferred Design

### Interaction / Visual Story

The developer thinks:

```text
I have an app/tool.
It needs one desktop status presence.
I call createTray.
The tray belongs to my app.
OpenTray disappears as a user-facing owner.
```

For background behavior:

```text
I run my own long-lived process/service.
That process imports OpenTray.
That process calls createTray.
That process owns tray registration and events.
When that process exits, the tray disappears.
```

The operator sees:

```text
Build Monitor process/tray runtime
    not "opentray"

Build tray status
    not a shared bucket of unrelated CLIs
```

### Interface Shape

Candidate public API:

```ts
await createTray({
  id: "com.example.build",
  icon: {
    type: "file",
    path: "build.png",
    text: "Build",
  },
  menu,
});
```

Rejected public managed API for current direction:

```ts
// not v0.9 public law under current direction
createBroker(...)
createWorker(...)
```

Settled responsive projection type direction:

```ts
type IconImage =
  | { type: "rgba"; data: Uint8Array | number[]; width: number; height: number }
  | { type: "encoded"; data: Uint8Array | number[] }
  | { type: "file"; path: string };

type SimpleIcon = IconImage & { text?: string };

type Icons = {
  "icon-only"?: IconImage;
  "text-only"?: string;
  "icon-text"?: IconImage & { text: string };
};

type Icon = Icons & SimpleIcon;
```

The "magic" is intentional: the same `icon` field can be a plain `SimpleIcon`, a responsive candidate map, or both. `icon-only` and `text-only` are explicit only-mode candidates. Generic image fields plus optional `text` live in `SimpleIcon` as fallback material, not in a separate `icons` field and not as a generic member of `Icons`.

Top-level `title` is removed as a tray display text source in the target v0.9 API. The visible tray text belongs to `icon`:

```ts
await createTray({
  id: "com.example.build",
  icon: {
    type: "file",
    path: "build.png",
    text: "Build",
    "text-only": "Build",
    "icon-text": { type: "file", path: "build.png", text: "Build" },
  },
});
```

### Data Shape

Durable facts:

- caller/app identity: owns the broker isolation boundary and OS attribution;
- app process/service identity: owns lifetime, event handlers, and source of action;
- tray identity: owns one status atom if multiple trays are allowed;
- menu item identity: routes user actions;
- `icon` source: caller-authored image/text projection candidates plus `SimpleIcon` fallback facts;
- selected native projection: backend output, not ontology.

Forbidden collapse:

```text
one `id` must not silently mean:
app id + tray id + broker endpoint + permission token + menu namespace
```

Candidate identity source priority:

```text
explicit app identity
    |
    v
build-time embedded OpenTray manifest
    |
    v
runtime package/process inference
    |
    v
development fallback
```

This priority treats inference as fallback, not ontology.

### Architecture Shape

Target law:

```text
caller/app identity
    |
    v
developer-owned process/service
    |
    v
tray registry
    |
    v
display candidate selection
    |
    v
native backend projection
```

Process ownership law:

```text
app process or app service
    owns tray logic
    owns event handlers
    owns background/daemon decision
    closes tray when it exits

OpenTray runtime binding
    owns native projection only
    does not own app lifecycle
```

Native distribution law:

```text
old:
@opentray/<platform> package
    -> bin/opentray executable
    -> detached broker process
    -> IPC protocol to JS caller

new:
@opentray/<platform> package
    -> native tray addon (.node) or equivalent runtime adapter artifact
    -> loaded by app-owned process/service
    -> direct typed binding / internal event bridge
```

The old shape is not just an artifact format. It creates an extra action source: the detached executable. Removing public broker means the release artifact should stop suggesting that the library owns an independent daemon universe.

Likely destructive work areas:

- remove public `createSpace`, `resolveDefaultSpace`, `SpaceOptions`, `SpaceRef`;
- remove, not alias, protocol `create-space`, `default-space`, and `spaceId`;
- collapse extension scope to caller/session authority plus tray identity;
- rename or replace `SurfaceProjection` if it is no longer truthful backend vocabulary;
- make process/task-manager identity caller-derived and verify it per platform;
- bind visible tray/extension/native route lifetime to the caller session, not to the detached broker process;
- remove public `Broker` / `createBroker` / managed worker lifecycle from v0.9 unless a later decision reverses this direction;
- provide docs/examples for developer-owned background services instead of product-owned daemon mode;
- update examples, README, skills, specs, and tests around tray-first API.
- replace platform broker executable packages with native binding packages, likely `.node` for Node-first distribution;
- remove or redesign daemon CLI commands such as `opentray daemon start/stop/health/restart`;
- revisit Deno/Bun support because `.node` is a Node addon format and may require runtime-specific adapter packages or a deliberate Node-first native law;
- revisit dynamic extension loading because the host process, not a detached broker executable, becomes the native capability host.
- define bundler packaging plugins as a separate build-layer atom, with Vite as the first supported adapter.

### Implementation File Map

| Area | Files |
| ---- | ----- |
| Runtime host + lifecycle | `openspec/changes/opentray-v0-9/specs/runtime-host/spec.md`, `packages/cli/src/cli.ts`, `packages/cli/src/daemon/lifecycle.ts`, `packages/cli/src/daemon/paths.ts`, `packages/cli/src/daemon/broker-command.ts`, `packages/cli/src/local-broker.ts`, `packages/cli/src/local-broker.test.ts`, `packages/cli/src/node.ts`, `crates/opentray-core/src/broker.rs`, `crates/opentray-core/src/kernel.rs`, `crates/opentray-bin/src/main.rs` |
| Protocol + SDK | `openspec/changes/opentray-v0-9/specs/kernel-runtime/spec.md`, `openspec/changes/opentray-v0-9/specs/client-sdk/spec.md`, `packages/cli/src/index.ts`, `packages/cli/src/client.ts`, `packages/cli/src/sdk.ts`, `packages/cli/src/index.test.ts`, `packages/spec/src/index.ts`, `packages/spec/src/index.test.ts`, `crates/opentray-spec/src/model.rs`, `crates/opentray-spec/src/protocol.rs` |
| Backend + extension host | `openspec/changes/opentray-v0-9/specs/backend-adapters/spec.md`, `openspec/changes/opentray-v0-9/specs/extension-host/spec.md`, `packages/ext-webview/src/index.ts`, `packages/ext-webview/src/index.test.ts`, `packages/ext-webview/README.md`, `packages/ext-webview/examples/webview-command.ts`, `packages/ext-lynx/src/index.test.ts`, `packages/ext-lynx/README.md`, `packages/ext-lynx/examples/lynx-command.ts`, `packages/ext-badge/src/index.ts`, `packages/ext-badge/src/index.test.ts`, `packages/cli/examples/_support/webview-example-support.ts`, `packages/cli/examples/_support/daemon-lynx-support.ts`, `crates/opentray-core/src/extension.rs`, `crates/opentray-core/src/backend.rs`, `crates/opentray-core/src/broker/tests.rs`, `crates/opentray-bin/src/dynamic_extension.rs` |
| Backend tray projection runtime | `crates/opentray-backend-tray-icon/src/lib.rs`, `crates/opentray-backend-tray-icon/src/projection.rs`, `crates/opentray-backend-tray-icon/src/native.rs`, `crates/opentray-backend-tray-icon/src/runtime.rs`, `crates/opentray-backend-tray-icon/examples/common/mod.rs`, `crates/opentray-backend-tray-icon/examples/runtime_boundary.rs`, `crates/opentray-backend-ksni/src/lib.rs`, `crates/opentray-core/src/broker.rs`, `crates/opentray-core/src/kernel.rs` |
| Packaging plugin + release staging | `openspec/changes/opentray-v0-9/specs/packaging-plugin/spec.md`, `scripts/binaries/artifacts.ts`, `scripts/binaries/stage-local.ts`, `scripts/binaries/stage-release-artifacts.ts`, `scripts/binaries/validate-package-dirs.ts`, `scripts/npm/bootstrap-package.ts`, `scripts/npm/bootstrap-package/manifest.ts`, `scripts/npm/bootstrap-package/workflow.ts`, `packages/darwin-arm64/package.json`, `packages/darwin-x64/package.json`, `packages/linux-arm64/package.json`, `packages/linux-x64/package.json`, `packages/windows-arm64/package.json`, `packages/windows-x64/package.json` |
| Public docs / package READMEs | `README.md`, `packages/cli/README.md`, `packages/spec/README.md`, `packages/darwin-arm64/README.md`, `packages/darwin-x64/README.md`, `packages/linux-arm64/README.md`, `packages/linux-x64/README.md`, `packages/windows-arm64/README.md`, `packages/windows-x64/README.md` |
| Tray-first example migration | `packages/cli/examples/basic-space.ts`, `packages/cli/examples/daemon-tray.ts`, `packages/cli/examples/tray-panel.ts`, `packages/cli/examples/webview-control.ts`, `packages/cli/examples/badge-panel.ts`, `packages/cli/examples/media-query-panel.ts`, `packages/cli/examples/placement-panel.ts`, `packages/cli/examples/_support/webview-example-support.ts`, `packages/cli/examples/_support/daemon-lynx-support.ts` |

### Implementation Notes

- `packages/cli` has already been moved partway to the tray-only public surface; keep the remaining work aligned with the new file map rather than reintroducing `Space`/`Surface` aliases.
- `packages/spec` and `crates/opentray-spec` are the protocol mirror boundary for this change. They must be updated in lockstep with the CLI client, Rust kernel, and tests.
- The example support helpers are part of the protocol proof surface, not throwaway sample code. Their remaining `spaceId` usage must be treated as change scope, not residue.
- The Rust kernel and backend tray-icon runtime are already inside the break radius. Keep `crates/opentray-core/*` and `crates/opentray-backend-tray-icon/*` in the same change scope as the TypeScript mirrors.
- The package manifest and README files above are part of the public naming law. Once the runtime decision settles, their identity wording must be updated in the same round.

No-compatibility law:

```text
removed public concept -> removed export
removed protocol field -> rejected input
removed docs example -> no replacement alias
deprecated alpha name -> deleted, not re-marked deprecated
```

Caller-death law:

```text
caller session disconnects
    |
    v
remove trays + extension state + native event routes
    |
    v
drop or diagnose later native events
    |
    v
broker idles or exits with no visible app effects
```

Developer-owned background law:

```text
developer service alive
    -> tray visible
    -> events route to that service

developer service exits
    -> tray/routes removed
    -> no orphaned events
```

### Secondary Break Impact Audit

Yes, the tray purification creates second-order breaks. The primary break is not `createTray(...)`; it is the removal of a hidden platform owner that many designs currently assume.

```text
public broker removed
    |
    +-- package artifacts stop being daemon executables
    +-- CLI daemon lifecycle stops being public API
    +-- protocol/IPC may become internal or disappear for direct Node binding
    +-- extension host moves into app-owned runtime host
    +-- task-manager identity follows the app process naturally
    +-- visual acceptance changes from broker smoke to host-process smoke
```

Impacted designs:

| Design area | Current assumption | v0.9 pressure |
| ----------- | ------------------ | ------------- |
| Platform packages | `@opentray/<os-arch>` carries `bin/opentray` broker executable. | Package should carry native runtime binding artifacts such as `.node`, plus any required sidecars. |
| Public CLI | `opentray daemon start/stop/restart/health` manages a broker lifecycle. | CLI daemon surface likely disappears or becomes contributor-only/debug-only, not product API. |
| Transport protocol | JS caller talks to detached broker through JSON frames. | Direct binding can use in-process typed API; any frame protocol becomes internal/testing boundary, not public law. |
| Kernel runtime | `Broker` owns app runtime/session and projection. | Host process owns lifecycle; kernel may remain as internal library law but should not expose broker ontology. |
| Backend adapters | Backend receives broker-composed projections. | Backend receives app-process-owned tray projections through native binding host. |
| Extension host | Dynamic extensions attach under broker/space/session scopes. | Extensions attach under app-owned runtime/tray scope; native loading now happens inside or under the host process. |
| Official extensions | Facades currently assume broker-routed commands. | Facades must bind to a tray handle/runtime host without assuming a daemon endpoint. |
| Release pipeline | CI stages daemon executables into platform packages. | CI stages `.node` addons and extension native artifacts; package manifests, artifact graph, and smoke tests change. |
| Examples/docs/skills | Examples start/reuse daemon and teach space/broker lifecycle. | Examples show foreground process or developer-owned service calling `createTray`. |
| OS identity proof | Broker process name must be caller-derived. | Host-process identity becomes the natural proof; no generic `opentray` process should be visible in the normal path. |

This audit also marks `broker-daemon/spec.md` as stale under the current direction. It should be deleted or replaced by an internal runtime-host / native-binding spec before implementation tasks are written.

### App Identity Derivation Matrix

| Runtime shape | Possible source | Stability | Risk |
| ------------- | --------------- | --------- | ---- |
| package dev script (`tsx`, `vite`, `bun run`, `pnpm dev`) | nearest `package.json`, `npm_package_name`, `process.argv`, cwd | Medium | Monorepo cwd and script runner names can point at the workspace/tooling rather than the actual app. |
| direct Node package execution | package metadata and entrypoint path | Medium-high | Works if package files exist at runtime; breaks if packaged files are pruned. |
| bundled JS (`tsdown`, `rolldown`, `esbuild`, `pkg`-like wrappers) | embedded define constants, generated manifest, executable/process path | Low without explicit embedding | Bundler can erase package metadata and collapse multiple sources into one file. |
| direct single binary | binary metadata, executable name/path, explicit embedded manifest | High only with manifest | Executable basename is not a stable reverse-DNS app id and can change after rename. |
| tests/examples | explicit test identity or generated temp identity | High if explicit | Auto inference can make tests order/environment dependent. |

Implication: v0.9 should not promise that `app.id/name` can always be inferred. It can provide best-effort fallback, but stable broker isolation and OS identity require either explicit caller metadata or a build-time manifest mechanism.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Single id semantics | Determines whether `createTray({ id })` names the app, the tray, or both. | Treat this as unresolved; do not write specs yet. |
| Multi-tray support | Determines whether `trayId` exists internally/publicly. | Prefer internal support, public default remains one tray. |
| `icons` map naming | User proposed `icons`, but it contains text projection candidates. | Keep proposal recorded, ask before specs. |
| Display selection priority | Map keys need deterministic platform selection order. | Settled candidate priority: `icon-only`, `text-only`, `icon-text`, then fallback. |
| Platform identity proof | "opentray name disappears" must be testable on macOS/Windows/Linux. | Reuse caller-pinned broker plan as base proof. |
| App identity declaration | Inference is not stable across dev, bundle, and single-binary deployments. | Require explicit app identity for production-stable broker identity; allow inference only for dev ergonomics. |
| Compatibility behavior | User confirmed no compatibility. | Delete old names and reject old frames/fields. |
| Caller death behavior | Detached broker can outlive JS caller. | Treat disconnect as authority loss; no live trays or event delivery without caller session. |
| Runtime mode split | Direct tray and managed worker solve different lifecycle problems. | Current direction removes managed worker from OpenTray; developers own background mode. |
| Package boundary | Background service is common but should not pollute tray ontology. | Do not add public broker package unless a later decision reintroduces managed mode. |
| Native artifact format | Determines whether v0.9 still ships an OpenTray-owned process. | Prefer `.node` for Node core runtime; evaluate Deno/Bun adapters explicitly instead of preserving broker executable by inertia. |

## Intent-Driven Plan

- [x] 1. Create OpenSpec change and discussion SSOT.
- [ ] 2. Continue product-law discussion until identity and app metadata derivation are settled.
- [x] 3. Write initial specs for settled `icon` projection law.
- [x] 4. Write BDD tasks from specs.
- [ ] 5. Run `bun run openspec:vision -- commit-check opentray-v0-9 --phase research-plan` once plan/spec/tasks are ready for apply.
- [ ] 6. Implement destructively.
- [ ] 7. Self-review against visible OS identity, tray-first API, no-`Space` residue, and no public broker story.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Does v0.9 intentionally support one tray per app only? | If yes, a single `id` can be app identity; if no, app identity and tray identity must be separate somewhere. | Keep multi-tray possible internally. |
| Should `createTray({ id: "com.example.build" })` derive broker app identity from the same id? | This is ergonomic but couples tray identity to broker identity. | Avoid until confirmed. |
| Should app identity be an optional second argument or inferred from package/process? | Determines the final low-noise API. | Infer by default; explicit override remains possible. |
| Should production identity require `app` or `opentray` manifest? | Prevents unstable broker identities after bundling or binary packaging. | Yes: production-stable identity should be explicit or embedded. |
| Should `createTray({ id })` use `id` as app id when no app identity exists? | Ergonomic, but risks conflating app and tray identity. | Only if v0.9 chooses one-tray-per-app as public law. |
| Should OpenTray provide a tiny build-time manifest helper? | This may make bundled/single-binary mode reliable without verbose runtime options. | Consider `defineOpenTrayApp()` or package manifest field before specs. |
| Should caller disconnect make the runtime exit immediately or idle briefly? | Immediate exit is simpler; idle can make reconnect cheaper but must not keep visible effects alive. | If any internal host remains, it may idle only after all visible state and routes are removed. |
| Should v0.9 provide a managed broker package later? | Background service is common, but including it may pollute tray capability design. | No for current direction; document external service patterns instead. |
| Should the Node runtime be the primary native distribution target? | `.node` is a Node addon format; Deno/Bun support may need separate adapters or compatibility proof. | Prefer Node `.node` as the core artifact, then design Deno/Bun support explicitly. |
| Should any standalone executable remain for smoke/debug/development? | A debug executable may help contributors, but a published executable reintroduces broker-shaped product semantics. | Keep only if contributor-only or clearly not part of public runtime API. |
| Should tooltip survive as a first-class field? | User questions whether `title` and `tooltip` overlap. | Tooltip is hover/accessibility projection; if defaulted, it should default from `icon` text, not top-level `title`. |
| Should display candidates live under `icons`, `display`, `presentation`, or another name? | Field name should match ontology. | Settled by user: use `icon`; remove separate `icons`. |
| Are text-only tray projections a real supported target or only fallback? | Some platforms may not support text-only tray presence. | Treat `text` as a candidate that can be unsupported. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep `Space` public and make `createTray` a convenience wrapper | Contradicts the user's explicit "彻底移除space的概念" direction. |
| Keep downward compatibility aliases for v0.9 | User explicitly does not want compatibility. |
| Preserve shared broker/surface internally | Contradicts the caller isolation law and makes OS attribution unsolvable. |
| Let `id` silently perform every identity role | Creates an unnamed singularity and will break permissions, routing, and future multi-tray support. |
| Treat selected display output as source truth | Projection is not ontology; caller-authored candidates are source, backend choice is projection. |
| Couple tray API directly to service-worker semantics | User explicitly warned not to byte-couple service-worker design; background worker is an analogy, not imported browser law. |
| Public `createBroker` in v0.9 | Current user direction prefers fully removing broker and letting developers own background mode. |
| Keep standalone broker executable as the primary published runtime | It preserves an OpenTray-owned background process after the public broker concept has been removed, creating ontology leakage through distribution. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: v0.9 specs and implementation expose a tray-first API with no public `Space` or `Broker` concept, no compatibility aliases, app-owned process/service lifecycle, no generic `opentray` task-manager ownership for host programs, native tray runtime distribution aligned with host ownership, and deterministic responsive tray display candidate selection.
