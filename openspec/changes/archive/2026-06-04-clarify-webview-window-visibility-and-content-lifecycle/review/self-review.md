# Self Review

## Decision Check

- `show(...)` is now treated as the visibility/bootstrap verb for an existing tray-scoped WebView session.
- Explicit content replacement moved onto `setContent(...)` and the existing URL-focused `navigate(...)` alias.
- Explicit session teardown moved onto `destroy()`.
- The WebView session law remains extension-owned; no WebView-specific lifecycle parsing was moved into `opentray-core` or `opentray-bin`.

## Contract Check

- Repeated compatible `show(...)` calls no longer reload page content implicitly.
- Repeated `show(...)` calls reject incompatible bootstrap changes and reject implicit content replacement with typed errors.
- `hide()` preserves the page runtime.
- `destroy()` destroys the tray-scoped session and allows a later `show(...)` to create a fresh runtime.
- Reused sessions can still accept mutable shell updates such as title, icon, size, and style without requiring destruction.

## Evidence Check

- TypeScript facade coverage proves the host-side API now exposes explicit lifecycle verbs instead of overloading repeated `show(...)`.
- Native extension tests cover:
  - compatible session reuse
  - rejection of bootstrap drift
  - rejection of implicit content replacement
  - mutable shell state exclusion from bootstrap identity
- Tray-panel smoke modes exercised the operator-visible lifecycle paths:
  - `reopen` -> `shown`, `hidden`, `shown`
  - `set-content` -> `shown`, `contentSet`
  - `destroy-reopen` -> `shown`, `destroyed`, `shown`

## Verification Evidence

- `pnpm --filter @opentray/ext-webview test`
- `cargo test -p opentray-ext-webview`
- `pnpm --filter opentray typecheck`
- `OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=reopen pnpm --filter opentray example:tray-panel`
- `OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=set-content pnpm --filter opentray example:tray-panel`
- `OPENTRAY_BROKER_BIN="$PWD/target/debug/opentray" OPENTRAY_EXAMPLE_WEBVIEW_SMOKE=destroy-reopen pnpm --filter opentray example:tray-panel`
- `bun run openspec:vision -- validate clarify-webview-window-visibility-and-content-lifecycle`
- `bun run openspec:vision -- commit-check clarify-webview-window-visibility-and-content-lifecycle --phase self-review`
- `git diff --check`

## Residual Risk

- `show(...)` still parses a fully resolved initial style payload, so callers who want precise live style patch semantics should prefer `navigator.window.setStyle(...)` after the session exists.
- The self-review does not reopen the plan. The accepted product behavior is now explicit, tested, and demonstrated through smoke commands.
