# OpenTray Handoff Context

> **Purpose:** This file provides full context for a new Claude session to start developing OpenTray. Read SPEC.md for the implementation spec, this file for the "why" behind every decision.

## What Is OpenTray?

A cross-platform Desktop Status Platform. Not just a "system tray library" — it's a platform for showing dynamic status, rich popups, and platform-specific UI from any Node.js application.

## Why Does This Project Exist?

### The Problem We Solved

We started by evaluating `systray-vs` (the npm package) to add a system tray icon to a Node.js app. We discovered a deeply broken ecosystem:

1. **systray-vs** — last updated 5 years ago, x86_64 only, CJS only, JSON parse crashes, no ESM
2. Its underlying Go binary (`felixhao28/systray-portable`) — also abandoned, uses getlantern/systray v1.1.0 from 2020
3. **getlantern/systray** (Go upstream, 3705 stars) — abandoned since 2023, 112 open issues, community PRs ignored for years
4. **node-systray-v2** — never published to npm, even older binaries

### Investigation Summary

We conducted 10+ parallel agent investigations, cloning and reading source code of every relevant library in both the Go and Rust ecosystems. Key reports are in `/Users/kzf/Dev/tmp/systray-vs-demo/`:

| File | Content |
|------|---------|
| `INVESTIGATION-REPORT.md` | Full ecosystem map, all issues/PRs for Go/Node libraries |
| `EVALUATION-REPORT.md` | Rust vs Go comparison, license analysis, platform extensibility |
| `ARCHITECTURE-REPORT-FINAL.md` | Final architecture: tray-icon + ksni hybrid |
| `OPENTRAY-VISION.md` | 4-layer vision (basic tray → rich popup → platform APIs → dynamic island) |

### Key Technical Discoveries

1. **fyne-io/systray (Go)** — actively maintained, but Apache-2.0 license and Go binary is 4-6 MB with 8-15 MB RSS. Not suitable for our MIT + lightweight goals.

2. **tray-icon (Rust, Tauri team)** — 378 stars, 14.4M downloads, MIT/Apache, most feature-complete tray library. Best choice for macOS/Windows.

3. **ksni (Rust)** — 136 stars, pure Rust D-Bus (zero system deps), **has complete DbusMenu implementation (95/100 score)**. Initially we thought it only had SNI — this was wrong. It's the best Linux backend.

4. **trayicon-rs (Rust)** — interesting alternative with SNI + DbusMenu in one crate, but code quality issues (Error::Display infinite recursion, block_on deadlocks, panic on no D-Bus). Scored 35/100 for DbusMenu.

5. **libappindicator-zbus (Rust)** — pure Rust libappindicator protocol, but immature (3 months old, zero tests, builder API is 2444 lines of type-state boilerplate). Scored 72/100.

### Why Rust over Go

| Factor | Rust | Go |
|--------|------|-----|
| Binary size | 1.5-2 MB | 4-6 MB |
| Memory RSS | 2-5 MB | 8-15 MB |
| Linux deps | Zero (zbus) | Zero (godbus) |
| License | All MIT | fyne-io is Apache-2.0 |
| Platform extensibility | ARM64, embedded, Android, WASM | Limited |
| Cross-compile | cross/zigbuild | GOOS/GOARCH (simpler) |

### Why tray-icon + ksni (not from-scratch)

Initially we recommended building from scratch (~2150 lines). Then we discovered ksni actually has a complete DbusMenu implementation (it was incorrectly assessed as SNI-only). This made the hybrid approach viable with only ~200-300 lines of adaptation code vs ~600 lines of DbusMenu from scratch.

### The "Rich Tray" Vision

We investigated what's beyond basic menus:
- **All frameworks** (Electron, Tauri, Wails) use the same pattern for rich tray popups: borderless window + WebView positioned near the tray icon
- **macOS** has NSPopover (native rich popup) and macOS 26 Tahoe brings Live Activities
- **Windows** has ITaskbarList3 (progress bars, overlay icons, Jump Lists, thumbnail toolbars) — richest platform APIs
- **Linux** is most limited: SNI protocol only supports icon+menu+tooltip
- **No cross-platform library** unifies these capabilities — this is OpenTray's differentiation

## Architecture Decisions

### Layer Model

```
Layer 0: Basic tray (icon + menu + tooltip + click events)    ← core binary, ~2 MB
Layer 1: Rich popup (WebView window anchored to tray)         ← extension shared library
Layer 2: Platform APIs (progress, badge, overlay, Jump List)  ← extension shared library
Layer 3: Dynamic Island (compact↔expanded transitions)        ← roadmap
```

### Extension System: Why Dynamic Libraries

The user explicitly asked about this. Three options evaluated:

1. **Dynamic library (.so/.dylib/.dll)** — same process, shared memory/handles, zero IPC. Chosen.
2. **Separate process + IPC (Unix socket)** — can't share OS handles (NSStatusItem, HWND belong to creating process)
3. **From scratch per extension** — too much work, defeats the purpose

**Critical detail:** Rust ABI is not stable. Extensions MUST use `extern "C"` interface for cross-version compatibility. This is non-negotiable.

### CLI as Entry Point

The Rust binary is invoked as a CLI tool by Node.js via `child_process.spawn()`. Communication is stdin/stdout JSON-RPC. This is the same proven pattern as systray-portable.

Extensions are loaded via CLI subcommands: `opentray ext:webview`. The core binary uses `libloading` to dynamically load the extension's shared library into the same process.

### npm Package Distribution

Per-platform optional dependencies (same pattern as `esbuild`, `turbo`):
```
opentray              → core package + postinstall
opentray-darwin-arm64 → macOS Apple Silicon binary
opentray-darwin-x64   → macOS Intel binary
opentray-windows-x64  → Windows binary
opentray-linux-x64    → Linux binary
... etc
```

Extension packages distribute shared libraries:
```
opentray-ext-webview  → .dylib/.so/.dll per platform
```

## Reference Repositories (cloned during investigation)

All at `/Users/kzf/Dev/tmp/systray-vs-demo/research/`:

| Directory | Repo | Why It Matters |
|-----------|------|----------------|
| `tray-icon/` | tauri-apps/tray-icon | Reference for macOS + Windows implementation |
| `ksni/` | iovxw/ksni | Linux backend — SNI + DbusMenu (best in Rust ecosystem) |
| `trayicon-rs/` | Ciantic/trayicon-rs | Alternative: SNI + DbusMenu in one crate, but low quality |
| `libappindicator-zbus/` | Decodetalkers/libappindicator-zbus | Alternative: full appindicator protocol, but immature |
| `fyne-io-systray/` | fyne-io/systray | Go alternative (Apache-2.0, not chosen) |
| `node-systray/` | felixhao28/node-systray | Current systray-vs package (abandoned) |
| `getlantern-systray/` | getlantern/systray | Original Go library (abandoned) |
| `node-systray-v2/` | edgar-p-yan/node-systray-v2 | Alternative npm package (never published) |

## What To Read First

1. **SPEC.md** — the full implementation specification (you just read the context, now read the spec)
2. **tray-icon macOS implementation** — `research/tray-icon/src/platform_impl/macos/` — reference for `opentray-darwin`
3. **tray-icon Windows implementation** — `research/tray-icon/src/platform_impl/windows/` — reference for `opentray-windows`
4. **ksni source** — `research/ksni/src/` — reference for `opentray-linux`, especially `service.rs` and `menu.rs`
5. **ksni examples** — `research/ksni/examples/` — understand the Tray trait API

## User Preferences

The user (kzf) has a detailed CLAUDE.md at `~/.claude/CLAUDE.md`. Key points:
- TypeScript strict mode, no `any`
- React 19+, shadcn/ui, tanstack, tailwindcss v4
- pnpm + lerna monorepo
- zod v4 for types
- File size ~200 lines, refactor into folders when needed
- Comments in same language as other files in the project
- Uses Context7 for library documentation lookup
- Prefers reading `node_modules/*` source directly when docs are insufficient
- **Architecture philosophy:** "Physics mindset" — platform/rules first, orthogonal atoms, embrace paradigm shifts, no hack/glue code
