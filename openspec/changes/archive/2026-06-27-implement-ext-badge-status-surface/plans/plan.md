# Intent Document

## Current Round

- Round: 1
- Status: apply
- Previous plan backup: `plans/plan-v1.md`

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

> 1. 是的。我希望 ext-badge 保持诚实和实用。请开始撰写openspec change。
> 2. 完成三个平台的开发，并完成macOS平台的完整开发与测试（利用ext-webview ipc 开发一个调试面板）

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Wants `ext-badge` to stay honest and practical, and asks to start the OpenSpec change. | This change must define capability-gated badge semantics, not fake cross-platform parity. |
| 2 | User | Requests implementation for three platforms and full macOS development/testing, using `ext-webview` IPC to build a debug panel. | The change must include a macOS-visible debug surface and a platform matrix that distinguishes full support from reduced support. |
| 3 | User | Confirms Windows should proceed at Reduced depth for this round. | Windows gets package/runtime/distribution atoms and explicit unsupported behavior now; native taskbar projection remains future work. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `README.md` | `ext-badge` is already a named roadmap package, and `ext-island` is the other placeholder extension. | Confirms the change belongs in the existing roadmap, not a new package family. |
| `packages/ext-badge/README.md` | The package role already states badge counts, progress bars, overlay icons, and attention status. | Gives the durable product intent to refine into a real contract. |
| `packages/ext-webview/README.md` | WebView already has capability-gated `navigator.window`, overlay, IPC, and platform-specific support rules. | Gives the right pattern for the macOS debug panel and for honest capability reporting. |
| `openspec/specs/webview-extension/spec.md` | OpenTray already treats capability-gated runtime behavior as the law for cross-platform window features. | This change should reuse that law, not invent a second pattern. |
| `openspec/specs/consumer-skills/spec.md` | Consumer guidance is supposed to teach scenario composition, not DOM mutation or fake recipes. | The debug panel should be an explicit proof surface, not an implicit HTML hack. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | pending |
| Normal archive | Commit containing `openspec archive <change>` result | pending |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | pending |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/specs/webview-extension/spec.md` | Capability-gated window and page bridge law. | Reuse the gating model and typed unsupported behavior. |
| `openspec/specs/consumer-skills/spec.md` | Scenario-first guidance and no hidden DOM mutation. | Extend the debug-panel story as a visible operator proof surface. |
| `openspec/changes/archive/2026-06-04-enrich-webview-window-macos-capabilities/plans/plan.md` | macOS-specific native window capability reasoning and proof discipline. | Reuse the evidence style for macOS testing. |
| `openspec/changes/archive/2026-06-05-rebuild-webview-cross-platform-window-contract-and-runtime/plans/plan-v1.md` | Cross-platform capability matrix thinking for substrates that diverge. | Reuse the matrix pattern and make Linux explicitly reduced. |
| `packages/ext-badge/README.md` | Badge/progress/overlay/attention role statement. | Extend into a real API contract and platform matrix. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| `capability-gated` | API exists only when the current substrate can actually honor it. | 先看平台能不能真做，再决定要不要开放这个能力。 |
| `保持诚实和实用` | Do not fake parity; expose real support and real limitations. | 能做就做，不能做就明确拒绝。 |
| `三个平台` | macOS, Windows, Linux. | 三个平台都要有合同，但不一定同等支持。 |
| `macOS平台的完整开发与测试` | macOS must have the strongest end-to-end proof surface. | macOS 要做到能看、能点、能测、能验。 |
| `利用ext-webview ipc 开发一个调试面板` | Use the existing WebView extension bridge as the proof/control surface. | 通过现有 WebView IPC 做一个可操作的调试面板。 |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| `packages/ext-webview/src/index.ts` | What page/runtime bridge shape already exists for IPC and capability gating. | Keep |
| `packages/ext-webview/README.md` | What visible debug/proof patterns already belong in the WebView extension docs. | Keep |
| `packages/ext-badge/README.md` | What the status extension currently claims to do. | Keep and harden |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should Linux be a reduced capability target or an unsupported-by-design target for specific badge/progress effects? | This determines whether Linux gets a thin honest adapter or is excluded from shipping scope. | Default inference: reduced capability-gated support with explicit unsupported results for missing native primitives. |
| Should the macOS debug panel live only in the `ext-webview` example/demo path or also become part of the published package docs? | This determines how much proof surface should be productized versus left as repository-only acceptance tooling. | Default inference: repository-visible debug panel plus docs, not a new public product surface. |

## Intent

### Surface Intent

Build `ext-badge` as an honest, useful OpenTray extension that exposes badge/progress/overlay/attention status across macOS, Windows, and Linux without pretending the substrates are equivalent.

### Underlying Drive

The user wants a status extension that behaves like a real platform atom: capability-gated, explicit about gaps, and strong where the OS actually offers a native primitive. The request also wants a macOS-visible debug panel through `ext-webview` IPC so the extension can be developed and tested against a concrete operator-facing surface instead of only a headless contract.

### Final Visible Effect

An operator can inspect `ext-badge` capability support, set badge/progress/overlay/attention state where the platform allows it, and see the macOS proof surface through a WebView debug panel. Windows and Linux will not lie about unsupported badge semantics; they will report reduced capabilities and reject unsupported requests honestly until native substrates land.

## Platform Diagnosis

- Current platform laws: OpenTray extension atoms own their own runtime behavior; page/runtime bridges are capability-gated; unsupported behavior must reject explicitly; webview already owns the IPC/debug-panel pattern.
- Does this fit as a regular atom: yes.
- Does this require law upgrade: yes, but only inside the `ext-badge` extension law and its platform-capability metadata.
- Breaking update stance: prefer a breaking-but-honest capability contract over a fake parity API; do not invent Linux badge behavior that the substrate cannot prove.
- User confirmations still required: confirm whether Linux is reduced-capability support or fully excluded for release packaging if the implementation proves too thin to be useful.

## Reverse-Inferred Design

### Interaction / Visual Story

The operator opens a macOS debug panel through `ext-webview` IPC, selects a tray/status target, toggles badge count, progress, overlay icon, and attention state, and immediately sees whether the platform projects the effect or returns a typed unsupported result. The same surface should make platform differences obvious without requiring source-code inspection.

### Interface Shape

The badge extension should expose a small typed surface: `setBadge`, `clearBadge`, `setProgress`, `setProgressState`, `setOverlayIcon`, `setAttention`, and `getCapabilities`. Capability metadata must tell the caller which effect families are supported on the current platform and which ones are only partially projected or unsupported.

### Data Shape

Durable facts are badge count/text, progress value and state, overlay icon, and attention flag. Projections are tray icon badges, future taskbar overlays, Dock badge labels, and debug-panel state. The API must not confuse a visible projection with a source fact, and it must not store fake platform support in the projection layer.

### Architecture Shape

`packages/ext-badge` owns the public facade and typed contract. Platform-specific native atoms own the actual projection. `opentray` and the broker remain generic and must not gain badge-specific branches. The macOS debug panel should use `ext-webview` IPC as a proof surface, not as a second owner of badge semantics. Linux support, if present, must remain a reduced adapter that advertises capability truthfully and rejects unsupported effects with typed errors.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Windows scope | Native taskbar projection is not being completed in this round. | Reduced Windows package/runtime support with explicit unsupported errors. |
| Linux parity scope | Linux badge/progress primitives are not native-parity-class the way macOS and Windows eventually may be. | Reduced capability-gated support with explicit unsupported errors. |
| Debug panel packaging scope | A panel can be proof tooling or published product surface. | Keep it as a repo-visible macOS test/debug surface first. |

## Intent-Driven Plan

- [ ] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| What exactly counts as the badge effect family: badge text, progress, overlay icon, attention, or all four? | This determines the public API and the scope of native projection work. | All four, with explicit capability metadata per platform. |
| Should Linux ship as reduced capability support or be published only after a stronger native adapter exists? | This determines release packaging and acceptance criteria. | Reduced capability support, no fake parity. |
| Should the macOS debug panel expose only the badge API or also a richer operator inspection surface? | This determines how much can be tested without opening the native code path. | Badge controls plus capability inspection, enough for focused macOS verification. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Fake full Linux parity | It would violate the user’s honesty requirement and hide substrate limits behind a lie-shaped API. |
| Moving badge semantics into `opentray` core | That would blur the atom boundary and make the broker own product-specific status behavior. |
| Treating debug UI as ontology | The panel is a projection and proof surface, not the source of truth. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: macOS debug panel proves the badge flow through `ext-webview` IPC, Windows packages and reduced runtime are present, Linux reports reduced capability truthfully, and the contract makes unsupported behavior explicit instead of fake-successful.
