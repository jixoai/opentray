# Intent Document

## Current Round

- Round: 1
- Status: In progress
- Previous plan backup: None

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

> 我打印了日志: `{event: "downloadcompleted", id: 9, payload: {filename: "pnpm-pub-backup (6).json", success: true, url: "blob:http://127.0.0.1:56522/795eeb81-83a8-4208-955d-479d7520f8cf"}}`
> 请问我们能否做到拿到最开始的 filename，也就是不冲突之前的。这对于应用识别某个事件是否和自己有关系非常重要，虽然 url 确实可以作为识别之一
>
> 好，但建议使用 suggestedFilename 作为字段
>
> filename 不变，开始推进这项变更

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker   | Objective record                                                                                                                                     | Impact on intent                                                                    |
| ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1    | User      | Wants the pre-deduped filename, not only the deduped final saved filename, because the app must identify whether a download event belongs to itself. | The event payload must preserve source truth in addition to the current projection. |
| 2    | Assistant | Current code can preserve the original filename on macOS, while Windows needs substrate-aware handling instead of path-only projection.              | The implementation must keep the payload honest per platform.                       |
| 3    | User      | Field name should be `suggestedFilename`.                                                                                                            | The public API name is fixed.                                                       |
| 4    | User      | `filename` must remain unchanged while the new field is added.                                                                                       | This is an additive contract change, not a rename or semantic migration.            |

### Evidence Read

| Source                                                                                     | Fact                                                                                                                                            | Why it matters                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `crates/opentray-ext-webview/src/macos/downloads.rs`                                       | `WKDownloadDelegate` already receives `suggestedFilename`, but current metadata overwrites it with the deduped basename before emitting events. | macOS already has the source truth; the current problem is projection loss.                                                      |
| `crates/opentray-ext-webview/src/windows/downloads.rs`                                     | Current Windows metadata is derived from `ResultFilePath`, so event payloads only see the resolved filename projection.                         | Windows needs a separate source-truth field and a different substrate path.                                                      |
| `webview2-com-sys` bindings                                                                | `ICoreWebView2DownloadOperation` exposes `ContentDisposition` and `ResultFilePath`, but not a direct `SuggestedFileName` method.                | Windows likely needs a best-effort parse from `Content-Disposition`, with explicit null when the substrate does not expose more. |
| `packages/ext-webview/src/index.ts`                                                        | The TS event map currently only carries `filename` on download events.                                                                          | The public facade must evolve with the native payload.                                                                           |
| `packages/ext-webview/README.md`                                                           | The README documents download lifecycle events but not a second filename field.                                                                 | Public docs must stay aligned with the new contract.                                                                             |
| `openspec/specs/webview-extension/spec.md`                                                 | The canonical WebView download event law currently documents `{ url, filename, success }` and `{ url, filename, receivedBytes, totalBytes }`.   | The durable contract must be extended, not only the implementation.                                                              |
| `openspec/changes/archive/2026-07-04-add-webview-download/specs/webview-extension/spec.md` | The archived download change intentionally kept payloads path-free and cross-platform uniform.                                                  | This follow-up must preserve that law while adding source truth.                                                                 |

### Git Evidence

| Checkpoint                      | Expected commit evidence                                                                            | Current status                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts            | Not yet recorded in git history for this change. |
| Task-progress commits           | Commit containing current-context task checkbox updates plus matching code/BDD evidence             | Pending implementation.                          |
| Self-review updates             | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending implementation.                          |
| Normal archive                  | Commit containing `openspec archive <change>` result                                                | Not started.                                     |
| Abnormal handoff                | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion       | Not needed at this phase.                        |

### Existing OpenSpec Survey

| File / change                                                                              | Existing law or pattern                                                                                 | Reuse, extend, or break                                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `openspec/specs/webview-extension/spec.md`                                                 | Download events are unprefixed window-bus events, path-free, cross-platform uniform.                    | Extend.                                                                        |
| `openspec/changes/archive/2026-07-04-add-webview-download/specs/webview-extension/spec.md` | The previous download change established the existing event set and payload law.                        | Extend with a follow-up atom instead of mutating archive history.              |
| `packages/ext-webview/src/index.ts`                                                        | Event payload types are centralized in `WebviewWindowEventMap`.                                         | Reuse.                                                                         |
| `crates/opentray-ext-webview/src/macos/downloads.rs`                                       | Download metadata is stored per download and replayed through start/progress/finish/fail/cancel events. | Reuse with a richer metadata shape.                                            |
| `crates/opentray-ext-webview/src/windows/downloads.rs`                                     | Windows download events already have a per-download metadata flow around `DownloadOperation`.           | Reuse with a richer metadata shape and substrate-specific filename extraction. |

### User Language System

| User phrase                      | Working meaning                                                                     | Plain-language translation when needed                   |
| -------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 最开始的 filename                | The filename before collision dedupe or save-path rewriting.                        | Pre-deduped suggested filename.                          |
| 不冲突之前的                     | Before browser-style collision resolution appends ` (n)`.                           | Source-truth name before final save-path resolution.     |
| 应用识别某个事件是否和自己有关系 | The app needs a stable correlation handle for its own downloads.                    | The event payload must preserve identity-relevant facts. |
| `filename不变`                   | Existing `filename` semantics must not be broken for current consumers.             | Additive API change only.                                |
| `suggestedFilename`              | The new field should be named after the substrate suggestion, not after app intent. | Preferred public field name.                             |

### Demo / Spike Code

| Path | Question it answers                                                             | Keep, migrate, or delete |
| ---- | ------------------------------------------------------------------------------- | ------------------------ |
| None | The visible effect is already concrete from the logged event and current tests. | None                     |

### Questions To Confirm With User

| Question           | Why this is the real question                                              | Current inference before user answers  |
| ------------------ | -------------------------------------------------------------------------- | -------------------------------------- |
| None at this phase | The user already fixed the public field name and compatibility constraint. | Proceed with additive contract change. |

## Intent

### Surface Intent

The user wants WebView download events to expose the pre-deduped filename as `suggestedFilename`, while keeping the existing `filename` field unchanged.

### Underlying Drive

The real pressure is ontology hygiene. The extension currently erases a source fact and leaves the app with only a projection (`filename` after dedupe or save-path resolution). The app needs a traceable signal to correlate download events with its own trigger, especially when `blob:` URLs or repeated filenames make the final saved name unstable.

### Final Visible Effect

When a page triggers a download and the app logs the event, it can see both the browser/native suggestion and the existing filename field side by side. The operator no longer has to guess whether `pnpm-pub-backup (6).json` came from the app's own `pnpm-pub-backup.json` request or from some other download. The payload remains path-free and cross-platform uniform.

## Platform Diagnosis

- Current platform laws: download lifecycle events are extension-owned native atoms delivered through the existing window-event bus; payloads are path-free and cross-platform uniform.
- Does this fit as a regular atom: Yes. This is a contract refinement inside the WebView extension atom.
- Does this require law upgrade: Yes, but only a small payload-law upgrade. The event projection must stop erasing source truth.
- Breaking update stance: Additive only. Keep `filename` unchanged and add `suggestedFilename`.
- User confirmations still required: None for this round.

## Reverse-Inferred Design

### Interaction / Visual Story

The app triggers a download, listens on the existing `download*` events, and receives one payload shape that always contains `url` and `filename`, plus a second field `suggestedFilename` when the substrate can surface the pre-deduped suggestion. The app can correlate on `url + suggestedFilename` without depending on a final saved-path rewrite.

### Interface Shape

Download event payloads remain on the same event names:

- `downloadstarted`
- `downloadprogress`
- `downloadcompleted`
- `downloadfailed`
- `downloadcanceled`

Each payload keeps `filename` unchanged and gains:

- `suggestedFilename: string | null`

`success` remains completed-only. `receivedBytes` and `totalBytes` remain progress-only.

### Data Shape

- Ontology:
  - `url`
  - `suggestedFilename` when the substrate exposes it
- Projection:
  - `filename` as the existing event field
  - `success`
  - progress byte counters

The implementation must not let the final saved basename overwrite the source-truth suggested name.

### Architecture Shape

- The extension crate owns native extraction and event payload construction.
- The TS facade owns the typed event surface and README contract.
- The OpenSpec change owns the law update and traceability.
- No core daemon or sibling extension changes are allowed.
- Windows-specific filename extraction must stay inside the Windows download atom; no shared platform special-casing in core.

### User Confirmation Gates

| Gate               | Why confirmation is required                                    | Default until user answers |
| ------------------ | --------------------------------------------------------------- | -------------------------- |
| None at this phase | The user already chose the field name and compatibility stance. | Proceed.                   |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [ ] 2. Write specs from the intent.
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks.
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question                                                                                                         | Why it matters                                                                   | Default assumption until user answers                                 |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| When Windows lacks an explicit substrate suggestion, should `suggestedFilename` fall back to a derived basename? | Falling back would blur source truth and may reintroduce the projection problem. | Default to `null` unless the substrate exposes a distinct suggestion. |

## Rejected Paths

| Path                                                 | Why rejected                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Rename `filename` to `suggestedFilename`             | Breaks existing consumers and violates the user's explicit compatibility requirement. |
| Overwrite `filename` with the pre-deduped suggestion | Destroys the existing projection that current consumers already use.                  |
| Add the final filesystem path                        | Violates the established cross-platform path-free event law.                          |
| Use `requestedFilename` as the field name            | Over-claims caller intent and does not match the native substrate vocabulary.         |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 3
- Custom exit condition from intent: the event contract preserves `filename`, adds `suggestedFilename`, and proves the new payload shape in native logic, TS types, docs, and focused tests.
