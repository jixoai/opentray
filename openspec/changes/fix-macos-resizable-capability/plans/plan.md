# Intent Document

## Current Round

- Round: 1
- Status: completed and released
- Previous plan backup: none

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check artifact status: `bun run openspec:vision -- status <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 我已经验收通过了，按照计划，发版本，然后适配 pnpm-pub

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Release only after the accepted Windows frameless and resize work. | A release CI failure is part of the current delivery scope, not a deferred platform cleanup. |
| 2 | CI | Darwin WebView builds reject a macOS `WindowCapabilities` constructor because the DTO lacks `resizable`. | Restore common capability parity before another publish attempt. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| Release run `29364829543` | Both Darwin WebView artifacts fail with `E0560`: `WindowCapabilities` has no field `resizable`. | The native release is blocked before package versioning or publishing. |
| `crates/opentray-ext-webview/src/macos/mod.rs` | The macOS capability constructor already sets `resizable: true`; the local serialized DTO omits the field. | One DTO field restores the intended public output and Darwin compilation. |
| `crates/opentray-ext-webview/src/windows/mod.rs` | Windows declares and serializes the same common capability. | The platform contract has a direct parity reference. |
| `openspec/specs/webview-frameless-soft-resize/spec.md` | Common `resizable` requires capabilities to declare support. | This is an implementation omission under an existing durable requirement. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Plan, spec, and tasks committed before product code | Pending |
| Task-progress commit | DTO repair and task update committed together | Pending |
| Self-review updates | Review evidence committed before archive | Pending |
| Normal archive | Archive result committed after successful CI evidence | Pending |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ------------------------ |
| `webview-frameless-soft-resize` | `resizable` is common and capabilities report platform support. | Reuse; repair its missing macOS projection. |
| `release.yml` | Darwin WebView artifacts compile before versioning and publish. | Reuse as the release-grade macOS compiler gate. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 发版本 | Complete CI-native build and package publication, not merely push a changeset. | A release is complete only after the registry publish succeeds. |
| macOS 改动 | Cross-platform implementation must be truthful about actual platform evidence. | macOS needs a Darwin compiler result. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| None | The release failure has one deterministic fix and the user already requested release. | Repair and retry immediately. |

## Intent

### Surface Intent

`navigator.window.getCapabilities()` reports the common `resizable` support field on macOS exactly as it does on Windows, and the Darwin WebView release artifacts compile and publish.

### Underlying Drive

Common TypeScript contracts are only real when each native platform serializes the same common capability shape. A platform-local DTO must not silently lag a public contract.

### Final Visible Effect

The release workflow completes both Darwin WebView artifact jobs, then proceeds to version and publish the accepted OpenTray release.

## Platform Diagnosis

- Current platform laws: WebView owns platform capability projection; release CI owns native build truth.
- Does this fit as a regular atom: yes, a macOS extension DTO parity repair.
- Does this require law upgrade: yes, record native capability DTO parity as a release compiler law.
- Breaking update stance: no new API or migration; this completes an already declared common field.
- User confirmations still required: none.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
TypeScript common capability
          |
          v
macOS WindowCapabilities DTO includes resizable
          |
          v
Darwin WebView build compiles and release can publish
```

### Interface Shape

- `WebviewWindowCapabilities.resizable` remains a required common boolean.
- macOS reports `true`, matching its supported native `NSWindowStyleMask::Resizable` projection.

### Data Shape

- The macOS serialized DTO gains one boolean field: `resizable`.
- No runtime state, persistence, or protocol version changes are introduced.

### Architecture Shape

- Keep the field in the macOS extension capability DTO next to `resize`.
- Do not route this repair through broker or shared core logic.
- Use the Darwin WebView CI build as the platform compiler proof unavailable on this Windows host.

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement tasks.
- [x] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| None | The compiler error identifies the exact missing field. | Retry the stable release after CI passes. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Remove `resizable` from macOS capability construction | It would hide a supported common contract instead of repairing platform parity. |
| Make the field optional in TypeScript | It would weaken the established common capability contract and leave platform drift undetected. |

## Exit Conditions

- Default max review iterations: 2
- Issue recurrence threshold: 2
- Custom exit condition from intent: Darwin arm64 and x64 WebView release jobs compile with the macOS capability DTO, then stable package publish succeeds.
