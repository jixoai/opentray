---
name: opentray
description: OpenTray user guide for installing `opentray`, creating spaces and trays, using daemon commands, loading official extensions such as `@opentray/ext-webview`, running visual acceptance recipes, and troubleshooting local usage. Use when the task is about consuming OpenTray as a package rather than modifying the OpenTray repository internals.
---

# OpenTray

## Overview

Use this skill when the user wants to build with OpenTray, not hack on the repo. Treat it as the docs entrypoint: install the package, create a space, create a tray, attach official extensions, run visual acceptance recipes, and debug daemon/runtime issues from the consumer side.

## Quick Routing

- Install, protocol-line tags, and first tray usage: read `references/getting-started.md`.
- Public API patterns and examples: read `references/api-patterns.md`.
- Scenario decision cards for common app shapes: read `references/scenarios.md`.
- Daemon lifecycle and health checks: read `references/daemon-ops.md`.
- Visual acceptance and smoke recipes: read `references/visual-acceptance.md`.
- Official WebView extension usage: read `references/ext-webview.md`.
- Common local issues and capability limits: read `references/troubleshooting.md`.
- For tray/screen/edge placement reviews, start from `example:placement`.
- For responsive native-window style and size-constraint reviews, start from `example:mediaQuery`.

## Consumer Rules

- Do not recommend `opentray smoke ...`; the public CLI is intentionally limited to daemon lifecycle and health.
- For smoke/visual checks, use this skill to compose a real SDK/example recipe and explain its side effects before running it.
- Keep platform truth explicit. If a platform or icon/runtime capability is limited, say so instead of pretending it works.
- Distinguish between protocol-only examples and real native visual acceptance.
- Do not silently rewrite or inject user HTML/CSS for frameless, overlay, or drag behavior. Teach the relevant native APIs and the product tradeoff, then let the user own their UI structure.
- Prefer scenario reasoning over API inventory. Pick the closest scenario card, then compose atoms for the remaining edge cases.
- Use `latest` for newest published packages and `stable-A-B` / `alpha-A-B` when the user wants to lock a whole OpenTray protocol line; replace `A-B` with the current line from `@opentray/spec`.

## Quick Verification

Use one of these depending on the question:

```bash
opentray daemon health
pnpm --filter opentray example:basic
pnpm --filter @opentray/ext-webview example:webview
```
