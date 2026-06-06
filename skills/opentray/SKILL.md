---
name: opentray
description: OpenTray user guide for installing `opentray`, creating spaces and trays, using daemon commands, loading official extensions such as `@opentray/ext-webview`, running smoke examples, and troubleshooting local usage. Use when the task is about consuming OpenTray as a package rather than modifying the OpenTray repository internals.
---

# OpenTray

## Overview

Use this skill when the user wants to build with OpenTray, not hack on the repo. Treat it as the docs entrypoint: install the package, create a space, create a tray, attach official extensions, run smoke commands, and debug daemon/runtime issues from the consumer side.

## Quick Routing

- Install, protocol-line tags, and first tray usage: read `references/getting-started.md`.
- Public API patterns and examples: read `references/api-patterns.md`.
- Daemon lifecycle, smoke commands, and health checks: read `references/daemon-ops.md`.
- Official WebView extension usage: read `references/ext-webview.md`.
- Common local issues and capability limits: read `references/troubleshooting.md`.

## Consumer Rules

- Prefer package-owned commands such as `opentray smoke daemon-tray` over workspace-only developer commands when answering usage questions.
- Keep platform truth explicit. If a platform or icon/runtime capability is limited, say so instead of pretending it works.
- Distinguish between protocol-only examples and real native smoke commands.
- Use `latest` for newest published packages and `stable-A-B` / `alpha-A-B` when the user wants to lock a whole OpenTray protocol line; replace `A-B` with the current line from `@opentray/spec`.

## Quick Verification

Use one of these depending on the question:

```bash
opentray daemon health
opentray smoke daemon-tray
pnpm --filter opentray example:basic
pnpm --filter @opentray/ext-webview example:webview
```
