---
name: opentray
description: OpenTray user guide for installing `opentray`, creating trays, loading official extensions such as `@opentray/ext-webview`, running visual acceptance recipes from source examples, and troubleshooting local usage. Use when the task is about consuming OpenTray as a package rather than modifying the OpenTray repository internals.
---

# OpenTray

## Overview

Use this skill when the user wants to build with OpenTray, not hack on the repo. Treat it as the docs entrypoint: install the package, create a tray, attach official extensions, run visual acceptance recipes from source examples, and debug runtime issues from the consumer side.

## Quick Routing

- Install, protocol-line tags, and first tray usage: read `references/getting-started.md`.
- Public API patterns and examples: read `references/api-patterns.md`.
- Scenario decision cards for common app shapes: read `references/scenarios.md`.
- Runtime/daemon lifecycle (library-level, not CLI): read `references/daemon-ops.md`.
- Reintroducing or auditing a broker/daemon process: read `references/daemon-best-practices.md`.
- Packaging through a bundler (Vite/esbuild/tsdown/webpack) or writing a custom adapter: read `references/bundling.md`.
- Visual acceptance and smoke recipes: read `references/visual-acceptance.md`.
- Official WebView extension usage: read `references/ext-webview.md`.
- Common local issues and capability limits: read `references/troubleshooting.md`.
- For tray/screen/edge placement reviews, start from `example:placement`.
- For responsive native-window style and size-constraint reviews, start from the `media-query-panel.ts` example (no `example:mediaQuery` script exists; run it directly via the file or review the responsive style kit).

## Consumer Rules

- The public `opentray` CLI binary does not expose daemon lifecycle or smoke subcommands. It only prints a usage pointer. Do not recommend `opentray daemon ...` or `opentray smoke ...` to package users.
- For real tray/window behavior, run the source-tree example scripts under `packages/cli/examples` (see `references/visual-acceptance.md`), or compose a short SDK recipe and explain its side effects before running it.
- The top-level SDK entrypoint is `createTray(options, runtimeOptions?)`. Do not reach for `createSpace` / `resolveDefaultSpace` / `createApp` — those belong to an earlier surface model and no longer exist.
- Visible tray text is part of icon projection (`icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`), not a top-level tray `title`. There is no `tray.setTitle()`; mutate text through `setIcon(...)`.
- Keep platform truth explicit. If a platform or icon/runtime capability is limited, say so instead of pretending it works.
- Distinguish between protocol-only examples and real native visual acceptance.
- Do not silently rewrite or inject user HTML/CSS for frameless, overlay, or drag behavior. Teach the relevant native APIs and the product tradeoff, then let the user own their UI structure.
- Prefer scenario reasoning over API inventory. Pick the closest scenario card, then compose atoms for the remaining edge cases.
- Use `latest` for newest published packages and `stable-A-B` / `alpha-A-B` when the user wants to lock a whole OpenTray protocol line; replace `A-B` with the current line from `@opentray/spec`.

## Quick Verification

Use one of these depending on the question (run from a source checkout):

```bash
pnpm --filter opentray example:basic          # protocol-only request/response
pnpm --filter opentray example:debug-runtime-tray   # real native tray + WebView
pnpm --filter @opentray/ext-webview example:webview # protocol-only facade
```
