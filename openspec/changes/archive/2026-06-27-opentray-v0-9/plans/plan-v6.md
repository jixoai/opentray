# Intent Document - OpenTray v0.9 Tray-First API Reset

## Current Round

- Round: 1
- Status: discussion / research-plan, no compatibility confirmed
- Previous plan backup: `plans/plan-v5.md`
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

## Intent

### Surface Intent

Open a v0.9 design change where OpenTray drops `Space` as a user-facing and preferably internal concept, makes `createTray` the single public creation entrypoint, isolates each host program's broker/tray runtime, and designs responsive tray display candidates without preserving backward compatibility.

### Underlying Drive

The user is pushing OpenTray away from "shared tray platform" and toward "private desktop status runtime for each app/caller." The desired shift is not a naming cleanup. It is a bottom-layer reset:

```text
old pressure:
shared broker -> Space aggregation -> Tray contribution -> projection

new pressure:
caller/app identity -> private broker -> Tray atom -> responsive projection candidates
```

The deeper rule is conservation of source: every visible process, tray item, event, and mutation must trace to the real host application, not to `opentray` as a generic library name or to a ghost `Space` grouping.

The latest identity question makes one constraint explicit: inferred app identity is convenient but cannot be the only legal source. In dev mode, package metadata may be available. In bundled JavaScript, package metadata is often erased or rewritten. In a direct single-binary distribution, the executable name and embedded metadata may be the only stable source. v0.9 needs a tiered identity law rather than one magic inference path.

### Final Visible Effect

A developer can write the main path without learning `Space`:

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

The operating system does not show a generic `opentray` owner for that program's tray runtime. Each OpenTray-using program has an isolated broker/tray runtime. Display projection chooses the best available platform structure from declarative candidates rather than forcing every platform into one `title + icon` shape.

## Platform Diagnosis

- Current platform laws: archived current law already collapsed shared surface and pins one broker to one caller, but public SDK/protocol/docs still expose `Space`, `spaceId`, `createSpace`, `resolveDefaultSpace`, and surface-derived backend vocabulary.
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

The operator sees:

```text
Build Monitor process/tray runtime
    not "opentray"

Build tray status
    not a shared bucket of unrelated CLIs
```

### Interface Shape

Candidate low-ceremony entrypoint:

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
private broker
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

Likely destructive work areas:

- remove public `createSpace`, `resolveDefaultSpace`, `SpaceOptions`, `SpaceRef`;
- remove, not alias, protocol `create-space`, `default-space`, and `spaceId`;
- collapse extension scope to caller/session authority plus tray identity;
- rename or replace `SurfaceProjection` if it is no longer truthful backend vocabulary;
- make process/task-manager identity caller-derived and verify it per platform;
- update examples, README, skills, specs, and tests around tray-first API.

No-compatibility law:

```text
removed public concept -> removed export
removed protocol field -> rejected input
removed docs example -> no replacement alias
deprecated alpha name -> deleted, not re-marked deprecated
```

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

## Intent-Driven Plan

- [x] 1. Create OpenSpec change and discussion SSOT.
- [ ] 2. Continue product-law discussion until identity and app metadata derivation are settled.
- [x] 3. Write initial specs for settled `icon` projection law.
- [ ] 4. Write BDD tasks from specs.
- [ ] 5. Run `bun run openspec:vision -- commit-check opentray-v0-9 --phase research-plan` once plan/spec/tasks are ready for apply.
- [ ] 6. Implement destructively.
- [ ] 7. Self-review against visible OS identity, tray-first API, and no-`Space` residue.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Does v0.9 intentionally support one tray per app only? | If yes, a single `id` can be app identity; if no, app identity and tray identity must be separate somewhere. | Keep multi-tray possible internally. |
| Should `createTray({ id: "com.example.build" })` derive broker app identity from the same id? | This is ergonomic but couples tray identity to broker identity. | Avoid until confirmed. |
| Should app identity be an optional second argument or inferred from package/process? | Determines the final low-noise API. | Infer by default; explicit override remains possible. |
| Should production identity require `app` or `opentray` manifest? | Prevents unstable broker identities after bundling or binary packaging. | Yes: production-stable identity should be explicit or embedded. |
| Should `createTray({ id })` use `id` as app id when no app identity exists? | Ergonomic, but risks conflating app and tray identity. | Only if v0.9 chooses one-tray-per-app as public law. |
| Should OpenTray provide a tiny build-time manifest helper? | This may make bundled/single-binary mode reliable without verbose runtime options. | Consider `defineOpenTrayApp()` or package manifest field before specs. |
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

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: v0.9 specs and implementation expose a tray-first API with no public `Space` concept, no compatibility aliases, caller-isolated broker runtime, no generic `opentray` task-manager ownership for host programs, and deterministic responsive tray display candidate selection.
