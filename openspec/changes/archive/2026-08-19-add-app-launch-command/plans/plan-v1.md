<!--
Orthogonal intents (2026-07-20; original user request: an app-mode entry left in
the Dock/taskbar must be able to start the consumer again, remember the latest
invocation when no command is configured, and allow an explicit launch command):
1. Define the public App Launch Command contract at the runtime seam.
2. Persist the latest launch invocation in a stable Darwin app bundle.
3. Make a cold launch from the bundle execute the consumer without a shell.
4. Preserve managed/prebuilt bundle ownership and compatibility boundaries.
5. Record the platform scope and the running-process Dock reopen boundary.
Compromise: Darwin is the only platform with a stable OpenTray app carrier today;
Windows taskbar persistence needs a separate shortcut/launcher atom and is not
silently claimed by this change.
-->

# Intent Document

## Current Round

- Round: 1
- Status: Self-review complete; owner Dock acceptance and archive pending.
- Previous plan backup: none; this is a new change.

## Workflow Command Surface

- Create change: `bun run openspec:vision -- new <change>`
- Check status: `bun run openspec:vision -- status <change>`
- Get artifact instructions: `bun run openspec:vision -- instructions <artifact> <change>`
- Strictly validate change files: `bun run openspec:vision -- validate <change>`
- Check commit evidence: `bun run openspec:vision -- commit-check <change> --phase <phase>`
- Rename after intent realignment: `bun run openspec:vision -- rename <old-change> <new-change>`
- Write abnormal-exit handoff: `bun run openspec:vision -- handoff <change>`
- Final workflow proof gate: `bun run openspec:vision -- check <change>`

## Original User Input

> 我基本验收通过了，接下来我们还需要提供一个关于app的配置：启动命令。
>
> 因为我们appMode的情况下，会在Dock/系统托盘留在一个入口。即便退出托盘，这个入口仍旧就存在。
> 所以用户自然会觉得可以点击这个入口来启动应用。
>
> 因此我们需要预留一个入口命令。
> 这是可配置的，但是默认可空，空的情况下使用 process.argv
>
> 只要启动一次，那么下次启动的时候，自然会使用上一次的 process.argv 的信息来进行启动。
> 当然也可以手动配置，所以开发者可以自己预留启动脚本。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | An app-mode Dock/taskbar entry must remain useful after the tray process exits; clicking it must start the application again. | A stable carrier needs a cold-launch path, not only a retained broker window. |
| 2 | User | The launch command is configurable but may be empty; an empty value uses `process.argv`. | `undefined`/`null` normalize to a captured executable, argument list, and working directory. |
| 3 | User | After one successful launch, the next launch reuses the previous `process.argv`; developers may provide a launch script explicitly. | Persist the latest normalized command and overwrite it on each successful runtime initialization. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/cli/src/sdk.ts` | `createTray(options, runtimeOptions)` is the public runtime seam and already accepts `appBundle`. | Launch configuration belongs beside App identity and bundle options, not in WebView or Core. |
| `packages/cli/src/local-broker.ts` | Darwin bundle materialization occurs during local broker resolution before broker spawn and also runs when an existing broker is reused. | The latest launch descriptor can be refreshed at the same stable initialization boundary. |
| `packages/packaging/src/app-bundle.ts` | Managed generation is atomic and `reinitialize: false` validates a prebuilt bundle read-only; the manifest hashes executable/template/icon. | Launch state must be a separate descriptor so changing argv never invalidates artifact compatibility. |
| `crates/opentray-bin/src/main.rs` | No `broker` subcommand currently prints Usage and exits. | This is the exact cold-launch gap for Finder/Dock execution of `Contents/MacOS/opentray`. |
| `packages/darwin-app-carrier/Info.plist` | The stable carrier identifies the broker executable as the bundle executable. | The carrier can be the launch trampoline without adding AppKit to the platform-neutral Core. |
| `openspec/changes/add-webview-app-mode-and-app-icon` | App mode and stable Darwin bundle identity are already specified separately. | This change extends the runtime carrier with launch intent instead of reopening that completed design. |
| `AGENTS.md` Darwin Runtime Carrier Law | The Darwin runtime package owns the broker plus shared `.app` carrier; Core must remain platform neutral. | The launcher stays in packaging/runtime/carrier atoms and is not an AppProjection field. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Committed as `c1c9a66 docs(spec): prepare add-app-launch-command for apply`. |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Committed as `f3ddf42 feat: relaunch consumers from Darwin app bundles`. |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Self-review commit pending. |
| Normal archive | Commit containing `openspec archive <change>` result | Pending. |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | Not expected. |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `openspec/changes/add-webview-app-mode-and-app-icon` | `style.appMode` is the common Shell role and stable Darwin bundle is a runtime distribution atom. | Extend the carrier lifecycle with a separate launch descriptor. |
| `openspec/changes/darwin-runtime-carrier-and-webview-permissions` | Darwin carrier and permission work is an independent incomplete change. | Do not modify it; depend only on the existing carrier contract. |
| `packages/packaging` | Bundler-neutral app bundle generator shared by Vite/esbuild/webpack/tsdown. | Add one durable descriptor schema and atomic writer. |
| `packages/cli` daemon lifecycle | Broker command is an argument vector and Node `spawn()` is already shell-free. | Reuse vector semantics for the persisted consumer command. |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| 启动命令 | A command vector that reconstructs the consumer process. | App Launch Command. |
| 入口命令 | The command executed when the stable app carrier is opened with no broker arguments. | Cold-launch entry command. |
| 默认可空 | Omitted/null configuration means automatic capture, not disabled launch. | Auto snapshot mode. |
| 使用 `process.argv` | Preserve the current Node runtime executable plus script/arguments. | `process.execPath` + `process.argv.slice(1)` + current cwd. |
| 上一次的 `process.argv` | Durable last-known-good invocation for the stable carrier. | Last Launch Descriptor. |
| 预留启动脚本 | Explicit developer-owned executable and argument vector. | Shell-free explicit launch command. |
| 退出托盘 | The caller/broker process is gone while the stable app entry remains available. | Cold relaunch, not retained-session reveal. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | Existing packaging and native entry code already expose the smallest proof surface. | No spike needed before implementation. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should clicking an entry while the broker is still alive trigger the same command? | A live macOS app process receives activation/reopen events differently from a cold `.app` launch. | This change guarantees cold launch after process exit; retained-window reveal remains the existing tray/session contract. |
| Should Windows receive a persistent launcher too? | A normal taskbar button disappears with its process; persistence requires a shortcut or pinned shell identity. | Darwin only for this atom; Windows needs a separate launcher/shortcut capability. |

## Intent

### Surface Intent

When an ordinary application-mode entry is opened from the Dock after the tray process has exited, the user should see the same consumer application start again. The entry must remember the last successful invocation automatically, while a developer can replace it with a deliberate script/command.

### Underlying Drive

`appMode` creates a normal application expectation. The stable `.app` currently has a correct name/icon but its executable only understands the private `broker` subcommand; Finder/Dock therefore reaches a dead-end. The missing concept is not another window flag. It is a durable handoff from carrier identity to caller process.

### Final Visible Effect

1. A consumer starts normally and creates its OpenTray app-mode runtime.
2. The runtime records the exact executable, arguments, and cwd that started it.
3. The consumer exits; the stable app entry remains usable in the Dock.
4. Opening that entry launches the recorded consumer once, without a shell or manual repair.
5. If the developer configured a command, that command is launched instead; the carrier never guesses or concatenates shell text.

## Platform Diagnosis

- Current platform laws: Core owns app identity/projection; the Darwin runtime package owns the carrier; the Node SDK owns package resolution and process spawning.
- Does this fit as a regular atom: yes. It is a runtime/carrier launch atom, not a new Core platform law.
- Does this require law upgrade: only the carrier contract gains a cold-launch descriptor and a no-argument entry procedure.
- Breaking update stance: introduce `appLaunch` without a legacy alias; do not persist shell strings or full environment state.
- User confirmations still required: live-process Dock reopen and Windows persistent launcher remain explicitly outside this change.

## Reverse-Inferred Design

### Interaction / Visual Story

```text
consumer start
     |
     v
createTray(appMode + appLaunch?)
     |
     v
stable .app + last launch descriptor
     |
consumer exits
     |
     v
Dock/Finder opens .app
     |
     v
carrier reads descriptor -> spawns consumer -> carrier exits
```

Opening a retained live app is not silently converted into a second consumer. The existing broker/session lifecycle remains authoritative while it is alive.

### Interface Shape

```ts
interface AppLaunchCommand {
  command: string;
  args?: readonly string[];
  cwd?: string;
}

interface OpenTrayRuntimeOptions {
  appLaunch?: AppLaunchCommand | null;
}
```

`undefined` and `null` mean auto snapshot. The normalized persisted vector is `{ command, args, cwd }`. `command` is an executable path/name, never a shell expression.

### Data Shape

```text
Contents/Resources/
  opentray-app-bundle.json   immutable compatibility identity
  opentray-launch.json       mutable last launch descriptor
```

The descriptor schema is versioned and strict. It stores no environment variables. The writer uses the existing stable-bundle lock and atomic sibling replacement. A successful `createTray`/local runtime initialization overwrites the descriptor; a failed initialization does not claim a new launch state.

### Architecture Shape

- `opentray-core`: unchanged; no Node command or process spawning.
- `@opentray/packaging`: owns descriptor type, validation, path, atomic persistence, and managed/prebuilt lifecycle semantics.
- `opentray` SDK: snapshots/normalizes the Node invocation and passes the descriptor through local broker resolution.
- `opentray-bin` Darwin carrier: with no `broker` subcommand, resolves its own `.app` resource descriptor, spawns the vector detached with null stdio, and exits; with `broker`, behavior is unchanged.
- Windows/Linux: retain current no-argument usage behavior until a platform launcher atom is specified.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Live-process Dock reopen | Requires AppKit/winit activation callback and can conflict with retained session authority. | Keep current live-process behavior; guarantee cold launch only. |
| Windows persistence | Needs a stable shortcut/launcher instead of a taskbar button. | Darwin-only implementation. |

## Intent-Driven Plan

- [x] 1. Research and align intent.
- [x] 2. Write specs from the intent.
- [x] 3. Write BDD tasks from specs.
- [x] 4. Implement tasks.
- [x] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should a null value disable relaunch? | The user described empty as fallback, not disable. | Null/omitted always auto snapshot; no disable mode in v1. |
| Should env be persisted? | Full env can leak credentials and differs between Finder and terminal. | Do not persist env; inherit the carrier environment at cold launch. |
| Should prebuilt bundles be immutable? | The descriptor must follow the latest invocation even when assets are prebuilt. | Assets/manifest are read-only; `opentray-launch.json` is explicitly runtime-mutable. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Persist one shell command string | Quoting, injection, and platform shell differences make it unsafe and non-deterministic. |
| Put launch command in `opentray-app-bundle.json` | Mutable runtime state would invalidate or blur immutable artifact compatibility. |
| Store all `process.env` | It can persist secrets and does not represent a stable app identity. |
| Add launch command to Core `AppProjection` | The command is a Node/carrier concern, not a platform-neutral tray projection. |
| Claim Windows taskbar persistence now | A live taskbar button is not a durable launcher after process exit. |

## Exit Conditions

- Default max review iterations: 2.
- Issue recurrence threshold: reopen the plan after one repeated mismatch between descriptor, bundle, or carrier behavior.
- Custom exit condition from intent: a real Darwin `.app` cold launch must execute the configured/default consumer vector once, and normal `pnpm install` must still be sufficient for the runtime path.
