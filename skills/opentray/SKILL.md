---
name: opentray
description: OpenTray architecture, extension, visual-acceptance, and release workflow guide. Use when working in the OpenTray repo on kernel/runtime laws, tray or Linux backend adapters, extension host behavior, official extension packages such as ext-webview/ext-badge/ext-island, runnable examples, npm trusted publishing, changesets, or first-stage release readiness.
---

# OpenTray

## Overview

Use this skill to preserve OpenTray's platform physics while changing the repository. Keep `SKILL.md` as the routing layer; load only the reference article that matches the current work.

## First Moves

- Inspect repo truth before proposing architecture: `git status --short --branch`, relevant `openspec/changes`, specs, package manifests, and crate boundaries.
- Prefer platform-law changes over glue. If a new need cannot fit `Surface`, `Tray`, `Lease`, `SurfaceBackend`, or `ExtensionInstance`, propose the law upgrade before implementation.
- Keep `opentray-core` free of concrete GUI, backend, npm package, and extension imports.
- For human-visible work, provide a real visual command such as `cargo run --example native_tray` or `cargo run --example visual_webview`, not only unit tests.

## Reference Map

- Kernel/runtime laws: read `references/kernel-runtime.md`.
- Backend adapter laws: read `references/backend-adapters.md`.
- Extension host laws: read `references/extension-host.md`.
- WebView extension work: read `references/ext-webview.md`.
- Badge extension work: read `references/ext-badge.md`.
- Island/live-activity extension work: read `references/ext-island.md`.
- Release, changesets, and npm trusted publishing: read `references/release.md`.
- Human-visible examples and acceptance: read `references/visual-acceptance.md`.

## Non-Negotiable Boundaries

- Do not add `if ext == "webview"` or equivalent feature branches in core.
- Do not import `tray-icon`, `ksni`, `winit`, `tao`, `wry`, or platform npm packages into `opentray-core`.
- Do not fake unavailable backend capability. Return capability absence or a typed unsupported error.
- Do not present visual work as complete unless a human-visible example command exists and has been smoked.
- Do not store long-lived `NPM_TOKEN` in GitHub Actions release publishing. Use npm trusted publishing with OIDC.

## Verification Baseline

Use the smallest targeted gate first, then close with the repo gate relevant to the work:

```bash
pnpm run build
pnpm run verify
openspec validate --all --strict
git diff --check
```

For visual examples, also run the relevant `cargo run --example <example_name>` smoke command from `references/visual-acceptance.md`.
