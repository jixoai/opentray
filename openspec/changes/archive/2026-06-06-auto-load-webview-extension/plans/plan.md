# Intent Document

## Current Round

- Round: 2
- Status: apply
- Previous plan backup: `plans/plan-v1.md`

## Workflow Command Surface

- Check status: `bun run openspec:vision -- status auto-load-webview-extension`
- Strictly validate change files: `bun run openspec:vision -- validate auto-load-webview-extension`
- Commit evidence gate: `bun run openspec:vision -- commit-check auto-load-webview-extension --phase self-review`
- Final proof gate: `bun run openspec:vision -- check auto-load-webview-extension`

## Original User Input

> 你的目前责任是编写openspec changes。你先把#001 的change写了。写完我们再讨论#003

## Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | Issue #001 | `attachWebview()` silently fails without prior `load-ext` - SDK should auto-load or throw actionable error | The public WebView path must not require hand-authored `load-ext`. |
| 2 | User | `export const tray = createTray(...).use(WebviewExt[,options]) ... const window = tray.createWebviewWindow(...)` | Move from a helper-only facade to an extension-mounted tray capability. |
| 3 | User | `use更像是生命周期插件，要不要用 (await createTray(...)).extends(WebviewExt, options)` | Avoid `use`; choose extension/capability language. |
| 4 | User | `开发者可以 创建多个 tray，挂在不同的 Ext，即便是同一个WebviewExt ... tray1和tray2的WebviewExt不一样` | The design must guarantee instance isolation, not just auto-load a singleton extension by name. |
| 5 | User | `可以，就按这个设计。开始重写change，并apply。` | Rewrite #001 around tray-scoped extension mounts and apply implementation. |

## Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/ext-webview/src/index.ts` | `attachWebview(tray)` was a thin wrapper over `tray.commandExtension("webview", ...)`. | Confirms the original silent prerequisite. |
| `packages/cli/src/client.ts` | `TrayHandle` had only `commandExtension`, no generic load or extension mount API. | The SDK lacked a public law for extension atoms to attach capability methods. |
| `packages/spec/src/index.ts` / `crates/opentray-spec/src/protocol.rs` | `load-ext` carried `name/path`; `ext-command` carried `ext`. | The protocol can add an optional mount alias without replacing the existing command family. |
| `crates/opentray-core/src/extension.rs` | The registry was keyed by `(surfaceId, extName)`. | Same-name WebView mounts in the same space would collide without a mount id. |
| `crates/opentray-bin/src/dynamic_extension.rs` | Dynamic discovery uses the requested extension name to find `libopentray_ext_<name>`. | Mount identity must not replace package/library identity. |
| `packages/cli/examples/*webview*` | Public examples manually sent `load-ext` before WebView commands. | Ordinary guidance leaked low-level setup. |

## Intent

### Surface Intent

Let developers mount WebView as a tray capability:

```ts
const tray = (await createTray(...)).extend(WebviewExt, options);
const panel = tray.createWebviewWindow(...);
await panel.show();
```

The first WebView command loads the native extension automatically. If loading fails, the command rejects with a typed actionable error.

### Underlying Drive

The real platform problem is not only a missing preload call. The old `load-ext by name` law created a singleton-like endpoint inside a space. That cannot truthfully support multiple trays mounting different instances of the same extension family. The platform needs a generic mount identity that separates:

- extension type/package identity: what library should be resolved
- extension mount identity: which mounted instance receives commands

### Final Visible Effect

A developer can create multiple trays and mount `WebviewExt` independently on each one. Each mount has its own command endpoint and lazy load state. The broker remains generic, and WebView-specific behavior stays inside `@opentray/ext-webview`.

## Platform Diagnosis

- Current law before this change: extension registry key was `(spaceId, extName)`.
- Diagnosis: #001 is no longer a regular facade-only atom. The user confirmed instance isolation, so the platform law must be upgraded.
- Recommended law: `load-ext` MAY carry a `mountId`; registry and commands dispatch by mount id, while dynamic discovery still resolves by extension `name/path`.
- Rejected compromise: keep one `webview` instance per space and rely on the WebView runtime to map state by tray. That handles windows but cannot handle two different WebView extension instances in the same space.

## Architecture Shape

- `TrayHandle.loadExtension({ name, path, mountId })` exposes the generic load law to extension atoms.
- `TrayHandle.extend(extension, options)` mounts a typed tray extension and returns the original tray handle plus the extension capability.
- `TrayExtension` is a TypeScript contract owned by `opentray`, not by WebView.
- `WebviewExt` is an extension atom that resolves `name: "webview"`, `path: "@opentray/ext-webview"`, and an optional mount id/path override.
- `attachWebview(tray)` remains as a synchronous compatibility adapter and defaults to the legacy `webview` mount.

## Intent-Driven Plan

- [x] 1. Research current `attachWebview`, `load-ext`, and registry key laws.
- [x] 2. Upgrade the OpenSpec intent from facade auto-load to tray-scoped extension mount.
- [x] 3. Add protocol mount identity without replacing existing `load-ext` and `ext-command` frame families.
- [x] 4. Add SDK extension mount contracts.
- [x] 5. Add `WebviewExt` and `createWebviewWindow` facade behavior.
- [x] 6. Keep `attachWebview` as compatibility.
- [ ] 7. Update docs and examples to teach `.extend(WebviewExt)`.
- [ ] 8. Run focused TS/Rust/OpenSpec verification.
- [ ] 9. Write self-review evidence.

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Keep requiring manual `load-ext` | Preserves the original hidden prerequisite. |
| Put `if ext == "webview"` in core | Violates extension atom ownership. |
| Make `name` double as both package identity and mount identity | Breaks dynamic library discovery and cannot isolate same-name instances. |
| Attach WebView at `SpaceHandle` for this issue | Current WebView windows are tray-anchored; space-level windows need a separate product story. |
| Rename the API to `.extends(...)` | It reads like a type inheritance relation; `.extend(...)` is a clearer runtime capability action. |

## Exit Conditions

- Multiple WebView mounts can share `name: "webview"` while dispatching through different mount ids.
- First command on a WebView mount sends one `load-ext` then the actual command.
- Later commands reuse the successful mount load.
- Load failure is wrapped as an actionable WebView error.
- Public examples no longer instruct ordinary consumers to send `load-ext` manually.
