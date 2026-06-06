## 1. Alignment / Investigation

- [x] 1.1 Confirm the current `attachWebview` call path and the generic `load-ext` protocol law.
- [x] 1.2 Confirm that the current extension registry is keyed by `(spaceId, extName)` and cannot isolate same-name mounts inside one space.
- [x] 1.3 Confirm examples and README paths that currently teach or rely on manual WebView `load-ext`.

## 2. BDD Contract

- [x] 2.1 Add a client SDK requirement for typed tray extension mounting through `TrayHandle.extend(...)`.
- [x] 2.2 Add an extension host requirement for optional `mountId` dispatch identity separate from extension package/library identity.
- [x] 2.3 Add a WebView requirement for `WebviewExt` lazy load, isolated mount dispatch, and actionable load failure.
- [x] 2.4 Add a guidance requirement so docs teach `.extend(WebviewExt).createWebviewWindow(...)` as the ordinary path while keeping `attachWebview` compatibility.

## 3. Implementation

- [x] 3.1 Add optional `mountId` to TypeScript and Rust `load-ext` protocol frames.
- [x] 3.2 Make dynamic extension instances register by `mountId` when present while still resolving dylibs by `name/path`.
- [x] 3.3 Add generic `TrayHandle.loadExtension(...)`, `TrayHandle.extend(...)`, and `TrayExtension` contracts in `opentray`.
- [x] 3.4 Implement `WebviewExt` with `createWebviewWindow(...)` and lazy load-on-first-command behavior.
- [x] 3.5 Preserve synchronous `attachWebview(tray)` as a compatibility adapter.
- [x] 3.6 Update README and example walkthroughs to remove manual WebView `load-ext` from the ordinary path.

## 4. Verification

- [x] 4.1 Add or update tests proving a mounted WebView command auto-loads the extension once.
- [x] 4.2 Add or update tests proving same-name extension mounts can dispatch through different mount ids.
- [x] 4.3 Add or update tests proving load failures are visible and actionable.
- [x] 4.4 Run focused TypeScript tests and type checks for `opentray`, `@opentray/ext-webview`, and touched extension tests.
- [x] 4.5 Run focused Rust tests for core/bin mount identity and the tray icon backend.
- [x] 4.6 Run `bun run openspec:vision -- validate auto-load-webview-extension`.
- [x] 4.7 Run `bun run openspec:vision -- commit-check auto-load-webview-extension --phase self-review` before writing final review evidence.

## 5. Self-Review Loop

- [x] 5.1 Generate `review/self-review.md` as the macro review thinking record comparing implementation against `plans/plan.md`.
- [x] 5.2 Generate separate `review/self-review.html` as the screenshot / interaction / structured evidence presentation.
- [ ] 5.3 If review reopens scope or changes the doc law, commit the updated OpenSpec artifacts before the next apply loop.
- [ ] 5.4 If the review exits normally, run `openspec archive auto-load-webview-extension` and commit the archive result.
