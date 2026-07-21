---
name: opentray
description: OpenTray package-consumer guide for installing `opentray`, creating trays, loading official extensions such as `@opentray/ext-webview`, choosing ordinary `style.appMode` windows versus tray utilities, implementing warm Dock reopen and cold `appLaunch` flows, packaging applications, validating consumer behavior, and troubleshooting installed runtime graphs. Use when developing an application that consumes published OpenTray packages, not when modifying or linking the OpenTray source repository.
---

<!--
Orthogonal intents (maintained 2026-07-21; original user requests: publish detailed appMode
adaptation guidance for projects such as skill-creator-v2, and keep OpenTray source/link
instructions exclusively in repository-internal .agents skills):
1. Route package consumers to the smallest relevant public reference.
2. Preserve consumer-facing API and platform-truth rules.
3. Exclude source checkout, workspace, staging, and contributor-smoke instructions.
-->

# OpenTray

## Overview

Use this skill when the user is building an application with published OpenTray
packages. Treat the consumer project as the only workspace in scope: install
dependencies, create a tray, attach extensions, package the app, validate its
real behavior, and diagnose the installed runtime graph.

## Quick Routing

- First install and first-app path: read `references/getting-started.md`.
- Version selection, protocol-line tags, and install drift: read `references/versioning.md`.
- For a progressive path from first tray to extensions and host control, read `references/tutorial.md`.
- Public API patterns and examples: read `references/api-patterns.md`.
- Scenario decision cards for common app shapes: read `references/scenarios.md`.
- Ordinary application windows versus tray utilities, warm Dock reopen, cold `appLaunch`, and development supervisors: read `references/app-mode.md`.
- Runtime ownership, application process lifetime, and persistent logs: read `references/runtime-ownership.md`.
- Packaging through a bundler (Vite/esbuild/tsdown/webpack) or writing a custom adapter: read `references/bundling.md`.
- Consumer-project acceptance matrix: read `references/visual-acceptance.md`.
- Official WebView extension usage: read `references/ext-webview.md`.
- Common local issues and capability limits: read `references/troubleshooting.md`.

## Consumer Rules

- The public `opentray` CLI binary does not expose daemon lifecycle or smoke subcommands. It only prints a usage pointer. Do not recommend `opentray daemon ...` or `opentray smoke ...` to package users.
- Validate real tray/window behavior through the consumer application's actual entrypoint; never require an OpenTray source checkout.
- The top-level SDK entrypoint is `createTray(options, runtimeOptions?)`. Do not reach for `createSpace` / `resolveDefaultSpace` / `createApp` — those belong to an earlier surface model and no longer exist.
- Menu item-local `onMenuClick` callbacks are a convenience layer, not a replacement for tray handle events. Keep teaching `tray.onMenuClick(...)`, `tray.onTrayClick(...)`, `tray.onTrayDoubleClick(...)`, and `tray.listen(...)` when apps need stable IDs, centralized routing, or raw tray activation.
- Visible tray text is part of icon projection (`icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`), not a top-level tray `title`. There is no `tray.setTitle()`; mutate text through `setIcon(...)`.
- Keep platform truth explicit. If a platform or icon/runtime capability is limited, say so instead of pretending it works.
- Distinguish between protocol-only examples and real native visual acceptance.
- Do not silently rewrite or inject user HTML/CSS for frameless, overlay, or drag behavior. Teach the relevant native APIs and the product tradeoff, then let the user own their UI structure.
- Prefer scenario reasoning over API inventory. Pick the closest scenario card, then compose atoms for the remaining edge cases.
- Use `latest` for newest published packages and `stable-A-B` / `alpha-A-B` when the user wants to lock a whole OpenTray protocol line; read `references/versioning.md` before giving install advice that pairs official extensions with `opentray`.
- Treat a normal package-manager install as sufficient. Diagnose an incoherent
  installed graph as an OpenTray defect; never turn repository preparation into
  an application prerequisite.

## Quick Verification

Inspect the consumer's `package.json`, then use its package-manager install,
typecheck, and real application entry commands. Do not invent a generic script
name: run the entry that owns the product's complete process tree.
