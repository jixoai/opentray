# Interview Plan

## Original User Input

> ## 摘要
> 把图标方案从"单一 template 特性"升级为**面向操作系统的通用候选优先级机制**:新增 `darwin/win32/linux` 三组 OS 专属候选键(`-<os>-icon-only` / `-<os>-icon-text`),与同名通用键同层,匹配当前 OS 时替代通用键;Darwin 候选额外携带 `isTemplate` 属性,经 `tray-icon` 0.24 的 `with_icon_as_template` 渲染。现有优先级链完全复用,只加一层 OS 匹配过滤。
>
> ## 改动清单
>
> 1. OpenSpec 变更(vision2,沿用仓库最新先例)
> 2. TS spec — `packages/spec/src/index.ts:331-346`
> 3. Rust spec + serde — `crates/opentray-spec/src/model.rs`
> 4. 投影层 — `crates/opentray-backend-tray-icon/src/projection.rs`
> 5. Native — `crates/opentray-backend-tray-icon/src/native.rs`
> 6. 测试(BDD)
> 7. 文档
> 8. Changeset
> 9. 验证(最小门禁,按序)
>
> ## 不做
> 不动 opentray-core(不引 OS 概念);不给 linux KSNI 实现图标消费(存核保持);不碰 NSImage/objc2 features;不引入 macos- 前缀别名。

## Pre-Interview Orientation

| Field | Record |
| ----- | ------ |
| Confirmed topic | OS-scoped tray icon candidate priority and Darwin template rendering |
| Interview mother tongue | Chinese |
| Thinking language for this interview | Chinese for intent capture; English for repo artifacts |
| Confirmation source | User supplied Chinese requirements and implementation checklist directly |

## Q&A Ledger

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Implement OS-specific icon candidate keys for Darwin, Win32, and Linux, with Darwin `isTemplate` routed through `tray-icon` template support. | Treat this as a platform projection law, not a one-off Darwin template feature. |
| 2 | User | Keep the existing priority chain and add only an OS match filter before generic candidates. | Preserve current icon-only / text-only / icon-text / fallback ordering. |
| 3 | User | Do not touch `opentray-core`, Linux KSNI icon consumption, NSImage/objc2 feature sets, or `macos-*` aliases. | Scope is spec, transport model, tray-icon projection/native adapter, tests, docs, and changeset only. |
| 4 | Assistant | Repo survey found `tray-icon` is already `0.24.0`, `with_icon_as_template` exists, and this change currently has only `.openspec.yaml` plus the default interview template. | Implementation can use the existing dependency and must complete the `vision2` artifact chain before app-code work. |

## Evidence Read

| Source (file / change / spec) | Fact | Why it matters |
| ----------------------------- | ---- | -------------- |
| `AGENTS.md` | OpenTray is tray-first; `App`, `Tray`, and `Session` are ontology, while extensions/native backends attach through tray/session contracts. | OS icon selection belongs in spec/projection/backend atoms, not a new core ontology. |
| `packages/spec/src/index.ts` | `IconCandidates` currently has `icon-only`, `text-only`, and `icon-text`; `Icon` is candidate map plus partial simple fallback. | The TS public contract can add optional keys without changing the top-level icon field. |
| `crates/opentray-spec/src/model.rs` | `Icon` uses custom serde to flatten simple fallback and serialize candidate keys as kebab-case. | New OS keys must follow the same serde law. |
| `crates/opentray-backend-tray-icon/src/projection.rs` | `TrayIconSelection::from_icon` is the current candidate priority gate and asset normalization path. | Add OS filtering there, not in core or caller SDK code. |
| `crates/opentray-backend-tray-icon/src/native.rs` | The native builder currently applies icon, title, tooltip, and menu from the compiled projection. | `isTemplate` must ride on the compiled asset into builder construction. |
| `tray-icon 0.24.0` local crate source | `TrayIconBuilder::with_icon_as_template(bool)` exists and is documented as macOS-only. | Native implementation can use the public builder API without objc2 feature changes. |
| `openspec/changes/os-scoped-icon-candidates/.openspec.yaml` | The change declares `schema: vision2`; status showed only the interview artifact scaffold existed. | The artifact order is interview -> specs -> tasks -> close/toc. |

## User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 单一 template 特性 | Darwin-only patch shape to avoid | Do not make this a hard-coded special case. |
| 通用候选优先级机制 | Cross-platform candidate law | The public icon contract grows OS-scoped candidate slots. |
| 同名通用键同层 | Same semantic layer as generic keys | OS keys are peers, not nested platform config. |
| 匹配当前 OS 时替代通用键 | Current OS shadows generic candidate for same mode | Add one matching filter before normal priority selection. |
| 存核保持 | Preserve kernel/core law | Keep `opentray-core` OS-neutral. |

## Intent

### Surface Intent

Add `darwin/win32/linux` icon-only and icon-text candidate keys, preserve the existing priority chain, and route Darwin template metadata into the native `tray-icon` backend.

### Underlying Drive

The user wants icon rendering to become a general candidate-selection law. Darwin template rendering is the first extra property, but it should not introduce a Darwin branch in core or a compatibility alias in the public API.

### Final Visible Effect

Callers can provide generic and OS-specific tray icon candidates in one `icon` object. On the current OS, the matching candidate shadows the generic candidate for the same display mode. On Darwin, `isTemplate: true` on the selected Darwin candidate is preserved through projection and applied through `tray-icon`.

### Workflow Fit

This is a `vision2` change. Do not create legacy `plans/plan.md`, plan backups, or self-review artifacts.

## Open Questions

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should this advance the protocol line? | OS-only keys are additive but old brokers ignore unknown fields. | No protocol bump; ship as a patch-level additive shape and recommend generic fallback for old runtimes. |
| Should `isTemplate` be allowed on generic `icon-only`? | That would expand template semantics beyond OS-scoped Darwin keys. | No; template is Darwin-candidate metadata only. |

## Decisions

| Decision | Confirmed by | Reversible? |
| -------- | ------------ | ----------- |
| Keep the public `icon` field as the only tray projection input. | User checklist and current client-sdk spec. | No, without redesigning the icon ontology. |
| Add only `darwin-*`, `win32-*`, and `linux-*` keys; do not add `macos-*` aliases. | User "不做" list. | No for this change. |
| Keep `opentray-core` OS-neutral. | User "不做" list and OpenTray platform law. | No for this change. |
| Use `tray-icon` builder template API instead of objc2/NSImage work. | User checklist and local crate evidence. | Yes, if upstream API changes later. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Add a separate `template` or `appearance` top-level field. | It would split one icon ontology into parallel projection sources. |
| Add OS logic to `opentray-core`. | Core stores app/tray/session facts; backend projection owns physical platform selection. |
| Implement Linux KSNI icon consumption now. | User explicitly scoped it out. |
| Add `macos-*` aliases. | User explicitly rejected aliases and this repo avoids compatibility glue. |

## User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Protocol-line bump | It changes install-time compatibility selection. | Keep protocol constants unchanged. |
