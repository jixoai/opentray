<!--
Orthogonal intents (updated 2026-07-21; original user requests: an app-mode entry
left in the Dock/taskbar must relaunch the consumer; owner acceptance then found
two Dock identities, a pinned entry that could not relaunch, and no durable daemon
diagnostics):
1. Define the public App Launch Command contract at the runtime seam.
2. Persist the latest launch invocation in a stable Darwin app bundle.
3. Make a cold launch from the bundle execute the consumer without a shell.
4. Converge legacy/wrong-package Darwin bundles onto one live App identity.
5. Preserve durable broker/carrier diagnostics and platform boundaries.
6. Reopen a live app-mode runtime from the Dock without spawning a second consumer.
7. Require development launch descriptors to restore the complete Vite -> daemon -> WebView tree
   without depending on the interactive terminal's PATH.
8. Keep broker startup bounded while automatically recovering coordination state left by dead callers.
Compromise: Darwin is the only platform with a stable OpenTray app carrier today;
Windows taskbar persistence needs a separate shortcut/launcher atom and is not
silently claimed by this change.
-->

# Intent Document

## Current Round

- Round: 6
- Status: Round-5 acceptance exposed a stale caller lock and a transitive shell-shim PATH
  dependency; both exact failure chains are reproduced and reopened for corrective evidence.
- Previous plan backup: `plans/plan-v6.md`.

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

> 我执行 pnpm dev，然后将图标固定到dock。首先可以确定的是，点击确实有反应了，它确实执行了一些动作。但是结果并不符合预期：skill creator没有关闭时点击没有打开窗口；关闭后点击打开了窗口但内容是 404。

> 所以这其实是开发模式的问题。我们直接在开发模式下，配置启动命令成 `pnpm dev`。

> 运行中的应用被点击 Dock 时，appMode: true 应默认自动显示并聚焦最近活跃的 appMode 窗口，这是我们opentray需要默认提供的行为。当然底层也需要暴露接口出来，比如可能是 opentrayWindow.focus，这部分你自己决策。

> 最后是我说的这个 skill-creator-v2 这个项目的新增的最佳实践，你可能需要帮它记录到项目AGENTS.md中，你不用开发，我会直接提醒skill-creator-v2自己做出修复。

> 1. pnpm skill-creator start 不启动托盘，相关测试无法进行。
> 2. pnpm dev 启动托盘后，点击 dock 图标，可以聚焦窗口。关闭窗口再点击也可以打开窗口。但是退出托盘后，点击dock 图标无法启动。

> 1. 还是没有修复：pnpm skill-creator start 不启动托盘，相关测试无法进行。
> 2. 现在连 pnpm dev 也无法启动托盘了。

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | An app-mode Dock/taskbar entry must remain useful after the tray process exits; clicking it must start the application again. | A stable carrier needs a cold-launch path, not only a retained broker window. |
| 2 | User | The launch command is configurable but may be empty; an empty value uses `process.argv`. | `undefined`/`null` normalize to a captured executable, argument list, and working directory. |
| 3 | User | After one successful launch, the next launch reuses the previous `process.argv`; developers may provide a launch script explicitly. | Persist the latest normalized command and overwrite it on each successful runtime initialization. |
| 4 | User | `pnpm dev` shows two Dock icons; hiding the window removes one. | A stable carrier is not sufficient while another OpenTray-owned bundle with the same App identity remains registered. |
| 5 | User | Pinning one icon, exiting, and clicking the pinned icon does not relaunch Skill Creator. | The sole surviving Dock path must be the current validated stable bundle and must contain the latest launch descriptor. |
| 6 | User | Manual acceptance needs daemon logs that expose the actual error. | Broker and cold-carrier output must be durable by default and documented at deterministic paths. |
| 7 | User | Development Dock launch must restore `pnpm dev`, not only the daemon child. | The descriptor must reconstruct Vite, its proxy, the daemon, and the WebView URL as one process tree. |
| 8 | User | A running app-mode Dock click must show and focus the most recently active app-mode window. | The live carrier needs a platform-neutral reopen intent and an extension-owned default projection. |
| 9 | User | OpenTray should expose a lower-level focus operation while supplying the default reopen behavior. | Add a typed WebView `focus()` capability without moving WebView policy into Core. |
| 10 | User | The Skill Creator persistence rule belongs in its `AGENTS.md`, not in this implementation. | Record incompatible-content reset versus I/O failure; do not change the consumer registry code. |
| 11 | User | `pnpm skill-creator start` did not mount the tray, blocking production-path acceptance. | Treat a linked consumer's staged broker and extension artifacts as an explicit test precondition and preserve the exact broker failure in durable logs. |
| 12 | User | Warm Dock reopen works, but clicking the pinned Dock entry after tray exit does not restart development. | Require the persisted development vector's complete subprocess graph to work in LaunchServices' minimal environment, not only in the terminal that first ran `pnpm dev`. |
| 13 | User | Production start still does not mount a tray, and development start has now regressed too. | A failed acceptance run must preserve and recover caller coordination state; development launch must bypass every shell shim that performs another PATH lookup. |

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
| Owner acceptance runtime graph | `~/.opentray/2.0.0/skill-creator/runtime/darwin-carrier/OpenTray.app` and `~/.opentray/apps/webui/Skill Creator.app` both declare `com.skill-creator`. | LaunchServices can retain a pinned path different from the running bundle, producing duplicate and dead Dock identities. |
| Installed module resolution | `skill-creator-v2` resolves the online `opentray@0.17.0` graph; its bundle broker hash matches that installed platform package, not the local checkout. | Local acceptance must use a real pnpm workspace override/link and rebuilt native package projection. |
| `packages/packaging/src/package-identity.ts` | Ambient `npm_package_json` currently beats the default running script path. | `pnpm --dir webui dev` incorrectly addresses the stable bundle as package `webui` instead of `skill-creator`. |
| `packages/cli/src/daemon/lifecycle.ts` | Detached broker stdio defaults to `ignore`. | Native broker failures disappear into `/dev/null`, preventing owner-assisted diagnosis. |
| `crates/opentray-bin/src/main.rs` | Cold carrier and spawned consumer use null stdout/stderr. | LaunchServices failures and early consumer exit are invisible even when the carrier resolves the descriptor. |
| `winit` macOS platform documentation | Winit intentionally does not expose `applicationShouldHandleReopen:`; applications must install an AppKit delegate. | The native broker must bridge Dock reopen into its generic event loop instead of inferring it from `resumed`. |
| `packages/ext-webview/src/index.ts` and native runtimes | `toVisible()` reveals retained windows; macOS focuses during reveal while Windows already has an internal focus path. | Expose `focus()` and compose `toVisible()` plus `focus()` for the default reopen projection. |
| `skill-creator-v2/AGENTS.md` | The consumer already records safeParse terminology but lacks the complete content-failure versus I/O boundary. | Update only the guide with the agreed reset rule; do not alter its registry implementation. |
| `opentray-launch.log` after the rejected cold click | The carrier read the expected absolute Node + pnpm entry and spawned it, then the root `dev` script failed at its nested bare `pnpm --dir webui dev` with `sh: pnpm: command not found`. | An absolute first executable is insufficient when a later script step still assumes the interactive terminal PATH. |
| `skill-creator-v2` production daemon log | Two pre-build linked runs timed out waiting for broker readiness, while the same command mounted successfully after `prepare:linked-consumer`; `lsof` then showed the linked source WebView dylib. | Linked acceptance must stage the source broker and native extension before either production or development runtime tests. |
| `broker.log` timestamps from the failed production start | The healthy Darwin broker began at `04:22:02.681`, emitted its startup line, and was terminated by SDK `SIGTERM` at `04:22:05.240` before publishing readiness. | The former optimistic polling window was shorter than a valid carrier/AppKit cold start; readiness needs a named native-startup budget while preserving liveness and artifact checks. |
| Lifecycle red BDD | A broker that stays alive and writes exact ready metadata after 2.2 seconds fails only under the former polling limit. | The regression can be proven without a GUI and must not weaken early-exit or identity-mismatch rejection. |
| `opentray-launch.log` after the readiness correction | Absolute Node starts absolute pnpm, but pnpm executes `webui/node_modules/.bin/vite`; that shell shim fails with `exec: node: not found`. | An absolute first executable does not make a transitive shell shim PATH-independent; Skill Creator must execute Vite's real JavaScript entry with the absolute Node binary. |
| `~/.opentray/2.0.0/skill-creator/runtime/broker.lock` | The lock contains dead PID `7001`; `acquireLock()` only polls `EEXIST` and never checks owner liveness. | One interrupted test or caller process permanently blocks every later production and development tray start until the SDK recovers the dead owner automatically. |
| `skill-creator-v2/test/cli-lifecycle.test.ts` | A detached production daemon test changes `SKILL_CREATOR_HOME` but still starts a real tray against the default OpenTray home. | Consumer tests must disable or isolate tray runtime state so a test-runner exit cannot poison the operator's production lock and bundle graph. |

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
| Should clicking an entry while the broker is still alive trigger the same command? | A live macOS app process receives activation/reopen events differently from a cold `.app` launch. | Emit a generic `reopenRequested` intent and let WebView auto-reveal/focus the most recent app-mode window; never spawn a second consumer. |
| Should Windows receive a persistent launcher too? | A normal taskbar button disappears with its process; persistence requires a shortcut or pinned shell identity. | Darwin only for this atom; Windows needs a separate launcher/shortcut capability. |

## Intent

### Surface Intent

When an ordinary application-mode entry is opened from the Dock, the user should either see the live application window restored and focused or, after the process exits, see the complete consumer development/production process tree start again. The entry must remember the last successful invocation automatically, while a developer can replace it with a deliberate script/command.

### Underlying Drive

`appMode` creates a normal application expectation. The stable `.app` currently has a correct name/icon but its executable only understands the private `broker` subcommand; Finder/Dock therefore reaches a dead-end. The missing concept is not another window flag. It is a durable handoff from carrier identity to caller process.

### Final Visible Effect

1. A consumer starts normally and creates its OpenTray app-mode runtime.
2. The runtime records the exact executable, arguments, and cwd that started it.
3. The consumer exits; the stable app entry remains usable in the Dock.
4. Opening that entry while live restores and focuses the most recently active app-mode window without a second consumer; opening it after exit launches the recorded consumer once, without a shell or manual repair.
5. If the developer configured a command, that command is launched instead; the carrier never guesses or concatenates shell text.
6. A previous OpenTray-owned bundle with the same App identity is unregistered and removed only after the current bundle is proven live; one Dock identity remains.
7. Broker and cold-launch failures append to deterministic log files without requiring a debug environment variable.
8. A healthy native broker may finish carrier/AppKit initialization within a bounded 10-second
   readiness budget; early exit and artifact mismatch still fail immediately with the broker log path.
9. A caller that dies while holding `broker.lock` cannot permanently disable the app: the next
   start proves the recorded owner is dead, reclaims the lock, and mounts the tray without manual cleanup.

## Platform Diagnosis

- Current platform laws: Core owns app identity/projection; the Darwin runtime package owns the carrier; the Node SDK owns package resolution and process spawning.
- Does this fit as a regular atom: yes. It is a runtime/carrier launch atom, not a new Core platform law.
- Does this require law upgrade: only the carrier contract gains a cold-launch descriptor and a no-argument entry procedure.
- Breaking update stance: introduce `appLaunch` without a legacy alias; do not persist shell strings or full environment state.
- User confirmations still required: Windows persistent launcher remains outside this change; the owner confirmed Darwin live reopen for this round.

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
     +--> handshake + descriptor commit
     |              |
     |              +--> unregister/remove stale same-AppId bundles
     |
consumer exits
     |
     v
Dock/Finder opens .app
     |
     v
carrier logs -> reads descriptor -> spawns consumer with log stdio -> carrier exits
```

Opening a retained live app is a warm reopen, not a second consumer launch. The carrier emits a platform-neutral `reopenRequested` intent; the WebView extension selects the most recently active `appMode` window, calls `toVisible()` and `focus()`, and exposes the intent for observation. The launch descriptor remains cold-start-only.

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

`undefined` and `null` mean auto snapshot. The normalized persisted vector is `{ command, args, cwd }`. `command` is an executable path/name, never a shell expression. Development consumers must persist a PATH-independent supervisor vector. Skill Creator executes Vite's real `bin/vite.js` with the absolute Node executable and the WebUI directory as `cwd`; it does not pass through pnpm, a package script, or a `.bin` shell shim. A package manager may help resolve that file during the original interactive run, but it must not remain in the persisted cold-launch chain.

### Data Shape

```text
Contents/Resources/
  opentray-app-bundle.json   immutable compatibility identity
  opentray-launch.json       mutable last launch descriptor
```

The descriptor schema is versioned and strict. It stores no environment variables. The writer uses the existing stable-bundle lock and atomic sibling replacement. A successful `createTray`/local runtime initialization overwrites the descriptor; a failed initialization does not claim a new launch state.

### Architecture Shape

- `opentray-core`: unchanged; no Node command or process spawning.
- `@opentray/packaging`: owns descriptor type, validation, path, atomic persistence, bundle identity inspection, and owner-safe stale-bundle removal.
- `opentray` SDK: resolves the running consumer script before nested package-manager environment metadata, snapshots the invocation, owns deterministic runtime log paths, and reconciles stale bundle identities only after handshake plus descriptor commit.
- `opentray` daemon lifecycle: waits up to the named 10-second native readiness budget, checks
  process liveness and exact ready artifact identity on every poll, keeps the default caller lock
  budget above that window, terminates the child only after a proved exit, mismatch, or timeout,
  and stores a PID plus unique owner token so dead caller locks are recoverable and releases cannot
  delete a replacement owner's lock.
- `opentray-bin` Darwin carrier: with no `broker` subcommand, resolves its own `.app` resources, appends carrier/consumer diagnostics, spawns the vector without a shell, and exits; with `broker`, it also bridges AppKit `applicationShouldHandleReopen:` into the generic broker event loop.
- `@opentray/ext-webview`: owns app-mode window selection and exposes `focus()`; it must not be reimplemented in `opentray-core`.
- Native broker/Core event seam: transports a generic app reopen intent; Core never selects or commands a WebView window.
- Windows/Linux: retain current no-argument usage behavior until a platform launcher atom is specified.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Live-process Dock reopen | Requires AppKit delegate bridging and a deterministic retained-window selection rule. | Auto-select the most recently active app-mode window, reveal and focus it, and expose the generic intent. |
| Windows persistence | Needs a stable shortcut/launcher instead of a taskbar button. | Darwin-only implementation. |

## Intent-Driven Plan

- [x] 1. Research and align the original launch-command intent.
- [x] 2. Implement and self-review the round-1 cold-launch path.
- [x] 3. Capture the owner rejection and reproduce the incoherent installed/bundle graph.
- [x] 4. Commit the round-2 specs and red BDD surface.
- [x] 5. Correct package identity, bundle convergence, and durable diagnostics.
- [x] 6. Verify through the real linked `skill-creator-v2` `pnpm dev` graph.
- [x] 7. Return the sole remaining Dock visual/click acceptance to the owner.
- [x] 8. Implement and verify the confirmed warm reopen, explicit focus, and development launch-vector behavior.
- [x] 9. Close the first Finder environment, linked-native preparation, and native readiness gaps found by owner acceptance.
- [ ] 10. Replace Skill Creator's transitive shell-shim launch vector, recover stale broker locks,
  isolate consumer lifecycle tests, and verify both real start commands against the linked runtime.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Should a null value disable relaunch? | The user described empty as fallback, not disable. | Null/omitted always auto snapshot; no disable mode in v1. |
| Should env be persisted? | Full env can leak credentials and differs between Finder and terminal. | Do not persist env; inherit the carrier environment at cold launch. |
| Should prebuilt bundles be immutable? | The descriptor must follow the latest invocation even when assets are prebuilt. | Assets/manifest are read-only; `opentray-launch.json` is explicitly runtime-mutable. |
| Should incompatible Skill Creator persistence be migrated in this change? | The consumer owns its registry implementation and defaults to destructive updates. | Document the safeParse reset/I/O boundary in Skill Creator `AGENTS.md`; do not change its code here. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| Persist one shell command string | Quoting, injection, and platform shell differences make it unsafe and non-deterministic. |
| Put launch command in `opentray-app-bundle.json` | Mutable runtime state would invalidate or blur immutable artifact compatibility. |
| Store all `process.env` | It can persist secrets and does not represent a stable app identity. |
| Persist pnpm or `.bin/vite` for development cold launch | Both eventually execute a shell shim that looks up bare `node` in Finder's minimal PATH. Persist the real Vite JavaScript entry under the absolute Node executable. |
| Ignore or manually delete `broker.lock` | It turns an abnormal caller exit into permanent operator repair and does not protect a replacement owner from an old release. |
| Add launch command to Core `AppProjection` | The command is a Node/carrier concern, not a platform-neutral tray projection. |
| Claim Windows taskbar persistence now | A live taskbar button is not a durable launcher after process exit. |

## Exit Conditions

- Default max review iterations: 2.
- Issue recurrence threshold: reopen the plan after one repeated mismatch between descriptor, bundle, or carrier behavior.
- Custom exit condition from intent: a real Darwin `.app` cold launch must execute the configured/default consumer vector once; a live Dock reopen must restore/focus the most recent app-mode window without a second consumer; the current consumer must converge to one OpenTray-owned same-AppId bundle; a dead lock owner must recover without manual deletion; failures must be present in documented logs; and a normal published `pnpm install` must remain sufficient for the runtime path.
