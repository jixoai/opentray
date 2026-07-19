---
name: develop-opentray
description: Develop and refactor the OpenTray repository while preserving kernel/runtime laws, backend boundaries, extension host contracts, native packaging, release workflow, and visual acceptance. Use when changing `crates/*`, `packages/*`, OpenSpec artifacts, release CI, native examples, or official extension packages inside this repo.
---

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

- Do not hard-code version numbers (e.g. `v0.9`, `0.9.x`) in user or contributor docs. Versions go stale on the next release; describe behavior by model, not by version ("the current tray-first model", "an earlier surface model", "the daemon era"). This applies to README files, skill references, and AGENTS-style guides alike.
- The rule above is about fixed numeric labels in prose. Typed runtime fields such as `packageVersion`, `<package-version>` path segments, or `@opentray/spec` protocol-line values are variables, not version numbers in documentation — do not strip those.
- Keep code examples consistent with the actual public exports. Do not reach for removed APIs (`createSpace`, `resolveDefaultSpace`, `tray.setTitle`) even when documenting history; show the real current surface (`createTray`, `setIcon({ text })`).
- Prefer concrete example script names that exist in `package.json` (e.g. `example:debug-runtime-tray`). Verify a script name before writing it into a doc; never invent an `example:mediaQuery`-style name that does not resolve.

## Verification Baseline

Use the smallest relevant gate first, then close with the repo gate:

```bash
pnpm run build
pnpm run verify
openspec validate --all --strict
git diff --check
```

For visual changes, also run the relevant smoke command from `references/visual-acceptance.md`.

Lynx host-window work is owned by the independent
[`jixoai/opentray-ext-lynx`](https://github.com/jixoai/opentray-ext-lynx) repository;
the core repository only verifies the generic extension boundary.
