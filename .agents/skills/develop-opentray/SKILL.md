---
name: develop-opentray
description: Develop and refactor the OpenTray repository while preserving kernel/runtime laws, backend boundaries, extension host contracts, native packaging, release workflow, and visual acceptance. Use when changing `crates/*`, `packages/*`, OpenSpec artifacts, release CI, native examples, or official extension packages inside this repo.
---

<!--
Orthogonal intents (maintained 2026-07-22; original user request: keep source checkout,
linked-consumer staging, and workspace smoke guidance internal to .agents/skills):
1. Route repository contributors to source-level platform laws.
2. Preserve internal build, staging, release, and visual-acceptance workflows.
3. Keep package-consumer tutorials owned by skills/opentray.
-->

# Develop OpenTray

## Overview

Use this skill for repo-internal OpenTray work. Keep `opentray-core` boring, keep platform/native behavior in the right atoms, and prove user-visible changes with a real command instead of only unit tests.

## First Moves

- Inspect repo truth before proposing changes: `git status --short --branch`, relevant `openspec/changes`, package manifests, and crate boundaries.
- Decide whether the request is kernel/runtime, backend adapter, extension host, official extension, release, or user-visible acceptance work.
- If the change primarily creates or refactors an official extension package, also use `$develop-opentray-ext`.
- When orthogonal OpenTray atoms are hard to explain, start from scenario examples and ask the user which visible effect they want before hardening the architecture.

## Reference Map

- Kernel/runtime laws: read `references/kernel-runtime.md`.
- Backend adapter laws: read `references/backend-adapters.md`.
- Extension host and dynamic loader laws: read `references/extension-host.md`.
- Tray primary action patterns: read `references/tray-primary-event-patterns.md`.
- Official extension package boundaries: read `references/official-extensions.md`.
- Badge roadmap atom: read `references/ext-badge.md`.
- Island/live-activity roadmap atom: read `references/ext-island.md`.
- Release and trusted publishing flow: read `references/release.md`.
- Human-visible verification rules: read `references/visual-acceptance.md`.

## Non-Negotiable Boundaries

- Do not add `if ext == "webview"` or equivalent product branches to `opentray-core`.
- Do not add `if ext == "lynx"` or equivalent product branches to `opentray-core`.
- Do not import `tray-icon`, `ksni`, `winit`, `tao`, `wry`, or platform npm packages into `opentray-core`.
- Do not fake missing backend capability; return capability absence or a typed unsupported error.
- Do not claim visual/native work is complete unless a human-visible command exists and has been smoked.
- Do not commit generated native binaries into source control.

## Documentation Rules

- Treat `skills/opentray` as an installed-package consumer Skill. Keep source
  checkout commands, workspace filters, linked-consumer staging, native build
  paths, contributor smoke tests, and release operations inside `.agents/skills`.
- Do not hard-code version numbers (e.g. `v0.9`, `0.9.x`) in user or contributor docs. Versions go stale on the next release; describe behavior by model, not by version ("the current tray-first model", "an earlier surface model", "the daemon era"). This applies to README files, skill references, and AGENTS-style guides alike.
- The rule above is about fixed numeric labels in prose. Typed runtime fields such as `packageVersion`, `<package-version>` path segments, or `@opentray/spec` protocol-line values are variables, not version numbers in documentation — do not strip those.
- Keep code examples consistent with the actual public exports. Do not reach for removed APIs (`createSpace`, `resolveDefaultSpace`, `tray.setTitle`) even when documenting history; show the real current surface (`createTray`, `setIcon({ text })`).
- Prefer concrete example script names that exist in `package.json` (e.g. `example:debug-runtime-tray`). Verify every script name before writing it into documentation.

## Development App Launch Rule

- `appLaunch` is a cold process-entry vector. A live Darwin Dock reopen emits
  `reopenRequested` and must never execute it.
- In a Vite development graph, persist the top-level supervisor that reconstructs
  the complete server, daemon, and WebView tree. Use the absolute JavaScript
  runtime with Vite's real `node_modules/vite/bin/vite.js` entry and the frontend
  workspace as `cwd`.
- Do not persist only a daemon child, a shell string, or a bare `pnpm` command.
  The complete transitive command graph must work without the interactive
  terminal's `PATH`; pnpm scripts and `.bin/vite` shell shims still perform a
  nested bare runtime lookup and are not safe under Finder/LaunchServices.
- Before accepting a linked consumer, run its source workspace's documented
  staging command so facade, broker, carrier, and native extensions come from
  one built graph. A registry install must not need this source-only step.
- A repeated development start is a consumer runtime-ownership concern unless
  collected broker/carrier evidence shows an OpenTray artifact defect. Review
  the consumer's lifecycle registry, active development endpoint, daemon PID,
  and Vite supervisor before changing core or native code. Keep the detailed
  takeover tutorial in `skills/opentray`; this maintainer Skill records only
  the boundary and evidence required to classify the issue.

```bash
pnpm run prepare:linked-consumer
```

- Treat readiness as a bounded native cold-start budget. It must cover Darwin
  carrier/AppKit startup, remain inside the caller-lock budget, and preserve PID
  liveness plus exact artifact-identity checks on every poll. Timeout errors must
  point to the caller-scoped broker log.
- Treat caller locks as recoverable ownership records. Preserve a live PID,
  reclaim a dead PID automatically, and validate a unique owner token before
  release so interrupted callers never require manual lock deletion.

## Verification Baseline

Use the smallest relevant gate first, then close with the repo gate:

```bash
pnpm run build
pnpm run verify
openspec validate --all --strict
git diff --check
```

For visual changes, also run the relevant smoke command from `references/visual-acceptance.md`.

Wizard smoke testing (`create-opentray` package): from any target directory,
`pnpm --dir <repo> create-opentray` runs the wizard from source and
`pnpm --dir <repo> create-opentray:dist` from the built `dist/` bin. Both
honor `INIT_CWD`, so the generated project defaults to the invoking directory,
not the workspace root.

Lynx host-window work is owned by the independent
[`jixoai/opentray-ext-lynx`](https://github.com/jixoai/opentray-ext-lynx) repository;
the core repository only verifies the generic extension boundary.
