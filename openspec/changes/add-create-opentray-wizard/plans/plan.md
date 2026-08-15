# Intent Document

## Current Round

- Round: 5
- Status: COMPLETED. ego-browser walkthrough verified: plain click-and-type on
  the terminal works and survives tab round-trips (forceMount keeps the ghostty
  instance alive; fetch-probe confirmed every keystroke posts to
  /api/terminal-input); the identity form is fully usable from idle (prime
  derives placeholders from command text without spawning; manual service-port
  input substitutes for discovery; confirm resolves placeholders). The
  walkthrough also exposed and fixed three real defects: corrupt favicons are
  rejected at scrape and materialize falls back to the glyph icon;
  dynamic-port (listen(0)) commands get their fresh port adopted via
  process-tree ownership in the generated entry; app-icon manifest paths are
  canonicalized to absolute before createTray dispatch. Final acceptance with
  a real npm install reached success: bundle at
  ~/.opentray/apps/plain-server-cjs-node/Final Service.app.
- Previous plan backup: `plans/plan-v4.md`.

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

> 我要实现 npm:create-opentray 子包，目的是用户可以通过这个命令，直接创建出一个由 opentray 托管的应用程序。
>
> 我比如说，已经有一个命令是`npx somecommand start`，然后这个命令内部会去监听 19080 端口。
> 那么把它用 create-opentray 打包，直接帮用户创建出一个本地应用程序。
>
> 底层逻辑是：
> 1. 执行 npx create opentray，会启动 一个 webui，在 webui 上，让用户输入启动命令
> 2. 立刻在本地跑一次，监听命令 做的端口监听，用户可以在 webui 上看到启动命令的 shell 输出
> 3. 得到 http 服务后，我们抓取 favicon 和 title，作为默认的 appicon 和 appName，展示给用户看，同时用户仍然可以自己定义图标和应用名称，至于 appId，我们会截取 命令 ，在 Options 出现之前的片段合并成默认 appId，比如`npx somecomand start --xx`会被处理成`start.somecommand.npx`作为默认 appId，当然用户可以自己定义
> 4. 以上步骤的过程，目的是让用户填写 opentray 的必要参数，抓取favicon 和 title、自动生成 appid 都只是辅助
> 5.  可能会出现多个http 服务端口，我们选择默认第一个去做抓取，但是这些服务都会被罗列在 webui 中，用户可以点击链接，来实现切换，同时我们会在 webui 中通过 iframe 展示这些服务。切换链接意味着重新抓取 favicon 和 title，这个过程就是一个轮询地
> 6. 最终用户点击确定创建应用，我们会把表单敲定下来，显示一个 Dialog，把应用信息展示出来，即便还在轮询抓取，但是表单值已经固定不再变更。我们使用 opentray 的底层技术，生成这个应用占位
> 7. Dialog 中确定生成，进入 Pendding 状态，可以显示必要的日志进度，等待完成后。Dialog 的内容会再次改变成 Success 状态，并提供一个按钮，点击可以打开应用。并提醒用户可以将应用图标固定到任务栏（Windows）或者 Dock 栏（macOS）

## Objective Record

### Requirement-Bearing Q&A

| Turn | Speaker | Objective record | Impact on intent |
| ---- | ------- | ---------------- | ---------------- |
| 1 | User | Full seven-step wizard specification (verbatim above), including: WebUI entry, immediate local run with shell output, favicon/title scrape, default appId derivation `start.somecommand.npx`, multi-port listing with iframe preview and switch-triggered re-scrape polling, frozen-form Dialog, Pending→Success states with open-app button and taskbar/Dock pinning hint. | This is the complete product contract; the wizard exists to collect OpenTray's required parameters, scraping/appId are only helpers. |
| 2 | Assistant | Presented implementation plan (package shape, module decomposition, HTTP API, scaffold contract, icon pipeline via `@opentray/vite-plugin`, materialize pipeline, tests, OpenSpec workflow). | Plan approved by user; becomes the traceability source for specs/tasks. |
| 3 | User | 实测反馈：点击"运行"后界面没有立刻出现 shell 面板；应改用 xterm.js 或 ghostty-web（建议）渲染真实终端，因为命令可能需要交互才能有效果。 | Two requirements: (a) instant panel feedback on Run; (b) real interactive terminal (PTY) rendered by ghostty-web, with graceful degradation when the native PTY is unavailable. |
| 4 | User | 终端协议可能有问题，需要完全客观传输 stdio（前端 ghostty-web 分析渲染，即便异常）；确认底层是否用 node-pty、是否 prebuild 版本，参考 ../openspecui 的 pty 前后端实现。终端+iframe 整合为 Chrome 式 Tabs 面板（Terminal tab 显示命令、Iframe tab 显示可编辑 URL 且支持前进后退）；iframe 仅在嗅探到 TCP 监听且 HTTP 确认后自动打开（多端口多 tab）；Terminal tab 底部状态栏显示光标位置/选区范围/嗅探到的 HTTP 服务（点击跳转对应 Iframe tab，按 hostname 匹配）；Iframe tab 是辅助，嗅探不到不影响创建应用；默认值显示为 input placeholder（含专门的图标 input）；用 react-shadcn 重构页面。 | Round-4 scope: objective base64 byte passthrough, @lydell/node-pty prebuilt, tabs panel with context nav + status bar, placeholder defaults + icon input, react-shadcn SPA webui. |
| 5 | User | 用 ego-browser 走查；自己实测终端仍然完全无反应。且即便命令没有"运行"，表单也应能直接填写使用——运行只是为了测试可用和抓取可用作默认值的信息。 | Round-5 scope: terminal input must survive tab switches and respond to plain user clicks (ego-browser-verified); the identity form is always editable from idle, with defaults derivable from the command without running (prime) and a manual service port fallback. |

### Evidence Read

| Source | Fact | Why it matters |
| ------ | ---- | -------------- |
| `packages/cli/package.json` | `packages/cli` publishes as `opentray`; bin `dist/cli.mjs`; deps only `@opentray/packaging` + `@opentray/spec`; tsdown build. | Precedent for a special-named publish package; create-opentray follows the same shape with zero new third-party runtime deps. |
| `packages/cli/src/sdk.ts` | `createTray(options, runtimeOptions)` accepts `appId`, `appName`, `appIcon`, `appLaunch`, and owns broker connection/session lifecycle. | Generated app entry calls `createTray` directly with the frozen identity + explicit `appLaunch` vector. |
| `packages/cli/src/app-launch.ts` | `normalizeAppLaunch` resolves path-like commands against cwd; bare names stay PATH-eligible; env map never persisted. | Launch vector must be made PATH-independent before persisting (absolute interpreter + entry), per App Launch Law. |
| `packages/cli/src/local-broker.ts` + `src/daemon/*` | Darwin stable bundle is materialized automatically at `~/.opentray/apps/<encoded-package>/<appName>.app` on first `createTray`; appLaunch descriptor committed after handshake. | Materialize success gate = generated entry prints ready marker + Darwin bundle exists; no new packaging code needed. |
| `packages/spec/src/index.ts` | `AppIcon` is a strict array of platform-standard assets (icns/ico/png/svg); URLs, favicons, raw RGBA invalid. | Favicon bytes must be regenerated into ICNS/ICO/PNGs through the sanctioned generator, never passed raw. |
| `packages/vite-plugin/src/app-icon.ts` | `generateOpenTrayAppIcon({sourcePath, ...output paths})` renders squircle-normalized ICNS/ICO/Linux PNGs + relocatable manifest; cache-aware. | Exact reuse target for the wizard's icon step; no parallel encoder. |
| `packages/ext-webview/src/index.ts` | `WebviewExt`/`attachWebview` mount typed WebView; `style.appMode: true` projects ordinary Shell membership; Dock reopen handled live via `reopenRequested`. | Generated window uses `appMode: true`; "Open App" on macOS can rely on `open <bundle>.app` for both cold launch and warm focus. |
| `packages/cli/examples/_support/dev-server.ts` | Merges `NO_PROXY=localhost,127.0.0.1,::1` at module load so loopback fetches bypass proxies. | Same guard required for wizard scraping probes. |
| `.changeset/config.json` | Fixed release group lists all `@opentray/*` + `opentray`; changesets + trusted publishing. | `create-opentray` must join the fixed group with a minor changeset. |
| `pnpm-workspace.yaml` | Workspace globs `packages/*`. | New package at `packages/create` is picked up automatically. |
| npm `ghostty-web` 0.4.0 (coder/ghostty-web, MIT) | xterm.js-API-compatible WASM terminal; ships `dist/ghostty-web.js` + `ghostty-vt.wasm`; zero runtime deps. | Adopt as the wizard terminal renderer (user-recommended); vendored as static assets, no build step. |
| npm `node-pty` | Canonical PTY spawn; native module compiled on install. | Optional dependency with runtime feature detection; pipe-mode fallback keeps `npx create-opentray` working without a toolchain. |

### Git Evidence

| Checkpoint | Expected commit evidence | Current status |
| ---------- | ------------------------ | -------------- |
| OpenSpec artifacts before apply | Commit containing `plans/plan.md`, specs, and `tasks.md` before product-code work starts | Pending |
| Task-progress commits | Commit containing current-context task checkbox updates plus matching code/BDD evidence | Pending |
| Self-review updates | Commit containing review output and any reopened or added OpenSpec tasks before the next apply loop | Pending |
| Normal archive | Commit containing `openspec archive <change>` result | Pending |
| Abnormal handoff | Commit containing `HANDOFF.md` / `vN.HANDOFF.md` evidence before returning to user discussion | N/A |

### Existing OpenSpec Survey

| File / change | Existing law or pattern | Reuse, extend, or break |
| ------------- | ----------------------- | ----------------------- |
| `add-app-launch-command` | App Launch Law: explicit `{command,args,cwd}` vector, PATH-independent persistence, descriptor mutable post-handshake. | Reuse: wizard records an absolute launch vector; never persists env. |
| `add-webview-app-mode-and-app-icon` | appMode projection + strict AppIcon catalog law. | Reuse: generated window `appMode: true`; icon catalog from sanctioned generator. |
| `specs/client-sdk` | `createTray` is the only public entry; tray-first. | Reuse: scaffold template uses public API only. |
| `specs/packaging-plugin` | `@opentray/vite-plugin` owns ICNS/ICO/PNG generation. | Reuse: call `generateOpenTrayAppIcon` directly. |
| `specs/monorepo-workspace` | `packages/*` → `@opentray/<dir>` with `opentray` as the one special name. | Extend by convention: `packages/create` → `create-opentray` (npm initializer naming, second special name, recorded here as accepted exception). |

### User Language System

| User phrase | Working meaning | Plain-language translation when needed |
| ----------- | --------------- | -------------------------------------- |
| "由 opentray 托管的应用程序" | A locally generated app whose tray/window/lifecycle is owned by OpenTray runtime. | Generated project runs `createTray` + WebView appMode window wrapping the user's command. |
| "打包" | Turn a start command into a desktop-resident app, not binary bundling. | Scaffold + materialize pipeline. |
| "监听命令 做的端口监听" | Diff listening TCP ports before/after spawning the command. | Port-scan module with pre-spawn baseline. |
| "截取命令在 Options 出现之前的片段合并成默认 appId" | Tokens before the first `-`-prefixed option, reversed, dot-joined. | `npx somecommand start --xx` → `start.somecommand.npx`. |
| "表单敲定" / "固定不再变更" | Form freeze on confirm; later scrapes must not overwrite. | Frozen-form state in wizard machine. |
| "Pendding" (Pending) | Materializing state with log progress. | Pending state streams materialize logs. |
| "应用占位" | App placeholder created via OpenTray's underlying tech. | The scaffolded project + stable Darwin bundle materialization. |

### Demo / Spike Code

| Path | Question it answers | Keep, migrate, or delete |
| ---- | ------------------- | ------------------------ |
| none | — | Integration test with a `node -e` HTTP server command covers the spike need; no demos/ directory required. |

### Questions To Confirm With User

| Question | Why this is the real question | Current inference before user answers |
| -------- | ----------------------------- | ------------------------------------- |
| Should the wizard keep the user's command running inside the generated app on every launch (spawn+supervise), or assume an externally managed service? | Determines generated `main.mjs` semantics. | Infer: generated app spawns and supervises the command itself, ready by TCP connect polling (matches "直接帮用户创建出一个本地应用程序"). |
| Windows/Linux pinning hint only, or also generate shortcuts? | Platform law says Windows persistence needs a separate shortcut atom. | Infer: hint text only in Success dialog; no shortcut atom in this change. |

## Intent

### Surface Intent

Ship `npx create-opentray`: a WebUI wizard that runs any start command once, discovers its HTTP services, scrapes favicon/title, derives a default appId, lets the user adjust the OpenTray parameters, then freezes the form, generates the app through OpenTray's own packaging/runtime machinery, and ends with a Success dialog that can open the app and hints at taskbar/Dock pinning.

### Underlying Drive

OpenTray's required parameters (`appId`, `appName`, `appIcon`, `appLaunch`, service URL) are exactly the facts observable from running the command once. The wizard closes the gap between "a CLI that listens on a port" and "a desktop-resident OpenTray app" without teaching the user the SDK.

### Final Visible Effect

Operator runs `npx create-opentray` in an empty directory; browser opens the wizard; they paste `npx somecommand start --xx`; they watch the command's shell output live; discovered services appear as clickable links with an iframe preview; favicon/title auto-fill the form (still editable); clicking 确定创建 freezes the form into a review Dialog; 确认生成 shows a Pending log (scaffold → icon → install → first launch → bundle); Success shows an 打开应用 button that reveals/focuses the real native window with the scraped icon in Dock/taskbar, plus the platform pinning hint. What the operator stops worrying about: writing any OpenTray code, picking ports, or producing ICNS/ICO assets.

## Platform Diagnosis

- Current platform laws: tray-first `createTray`; AppIcon strict platform-standard catalog; appLaunch shell-free absolute vector; Darwin stable bundle auto-materialized by runtime; Windows persistence out of scope; package-manager install is the consumer contract; monorepo `packages/*` naming with `opentray` special case.
- Does this fit as a regular atom: yes. The wizard is a consumer of existing public APIs (`createTray`, `WebviewExt`, `generateOpenTrayAppIcon`) plus pure Node; it adds no core/crate surface.
- Does this require law upgrade: one naming convention extension — `packages/create` publishes as `create-opentray` (npm initializer namespace), accepted as a second special publish name. No kernel/runtime law changes.
- Breaking update stance: purely additive new package; no destructive migration.
- User confirmations still required: none blocking; the two open questions above carry safe defaults.

## Reverse-Inferred Design

### Interaction / Visual Story

Wizard page (single file, vanilla JS) states: `idle` (command input + Run) → `running` (live log console) → `discovered` (service chips + iframe preview + form auto-filled, scrapes keep refreshing untouette fields) → user clicks 确定创建 → `frozen` Dialog (read-only summary) → 确认生成 → `materializing` Dialog section with streaming log lines → `success` Dialog section with 打开应用 button and platform pinning hint, or `failed` with error + 重试. See plan tasks for exact HTTP surface.

### Interface Shape

CLI: `create-opentray [--no-open] [--port <n>] [--pm npm|pnpm|bun] [--skip-install] [--force] [targetDir]`.
HTTP API on 127.0.0.1 with token guard: `GET /api/events` (SSE), `POST /api/command`, `POST /api/select-service`, `POST /api/form`, `POST /api/confirm`, `POST /api/create`, `POST /api/open-app`, `POST /api/stop`.

### Data Shape

- `ServiceEndpoint {port, url, firstSeenAt, title?}` — ephemeral discovery projection.
- `WizardForm {appId, appName, iconSource: "favicon"|"custom", customIconPath?, targetDir, pm}` — editable until frozen; frozen copy becomes immutable materialize input.
- Generated project durable facts: `opentray.app.json` `{schemaVersion:1, appId, appName, command:{command,args,cwd}, service:{port}, window:{width,height}}`; `app-icon/` assets + manifest (absolute-path `AppIcon` at runtime); `main.mjs` entry; `package.json` deps pinned to the current OpenTray line.

### Architecture Shape

- New package `packages/create` → `create-opentray`; Node-builtins-only runtime; reuses `@opentray/spec` types + `@opentray/vite-plugin` generator; generated app depends on published `opentray` + `@opentray/ext-webview`.
- Forbidden couplings: no changes to `opentray-core`/crates; no product branches in core; no raw favicon into AppIcon; no shell-string appLaunch; no daemon lifecycle subcommands.

### User Confirmation Gates

| Gate | Why confirmation is required | Default until user answers |
| ---- | ---------------------------- | -------------------------- |
| Non-empty target directory overwrite | Prevents destroying existing files. | Refuse unless `--force` and directory contains only ignorable files. |
| Killing the preview process before materialize | Frees the service port for the generated app's first launch. | Always kill preview tree on create (stated in UI). |

## Intent-Driven Plan

- [x] 1. Research and align intent (approved plan + this document).
- [ ] 2. Write specs from the intent (`create-wizard` capability spec).
- [ ] 3. Write BDD tasks from specs.
- [ ] 4. Implement tasks (package scaffold, modules, WebUI, tests, docs, changeset).
- [ ] 5. Self-review against intent and decide whether to loop.

## Open Questions

| Question | Why it matters | Default assumption until user answers |
| -------- | -------------- | ------------------------------------- |
| Supervise command inside generated app vs external service? | Generated entry semantics. | Supervise inside generated app (spawn + TCP readiness). |
| Windows shortcut generation? | Platform law defers persistence to a shortcut atom. | Hint text only; separate future change. |
| Scraper should prefer which favicon candidates? | Icon quality of default. | `rel=icon` largest `sizes` → apple-touch-icon → `/favicon.ico` → first-letter glyph fallback via sharp-rendered SVG template. |

## Rejected Paths

| Path | Why rejected |
| ---- | ------------ |
| xterm.js as renderer | ghostty-web is user-recommended, ships Ghostty's battle-tested VT parser as WASM with an xterm.js-compatible API, and needs no addon stack; xterm.js remains the fallback shape of the API so migration stays trivial. |
| Hard `node-pty` dependency | A required native module would break `npx create-opentray` on machines without a compile toolchain, violating the normal-install consumer law; optional dependency + pipe fallback preserves it. |
| WebSocket transport for terminal I/O | Adds a server dependency and upgrade handling; SSE output + batched POST input on loopback is sufficient for prompt-level interactivity with zero new server deps. |
| Raw favicon bytes as `AppIcon` | Violates App Icon Law (URLs/favicons/RGBA invalid); rejected in favor of the sanctioned generator. |
| Persisting a shell string or bare `npx` in appLaunch | Violates App Launch Law PATH-independence; rejected in favor of absolute interpreter + entry vector. |
| Teaching users the SDK instead of a wizard | Defeats the product intent ("直接创建出一个本地应用程序"). |
| Adding a `create` subcommand to the `opentray` CLI bin | Consumer rule: `opentray` CLI stays a usage pointer; npm initializer naming (`npx create-opentray`) is the ecosystem convention. |
| Web framework + build step for the WebUI | Wizard must run offline from dist with zero extra deps; single-file vanilla HTML/CSS/JS suffices. |
| Shortcuts/`.desktop` generation in this change | Windows/Linux persistence is a separate platform atom per law. |

## Exit Conditions

- Default max review iterations: 2.
- Issue recurrence threshold: same defect recurring twice reopens tasks.
- Custom exit condition from intent: end-to-end wizard run against a local HTTP server command produces a launchable generated app with scraped icon/title and correct default appId; repo gates (`pnpm run build`, `pnpm run verify`, `openspec validate --all --strict`, `git diff --check`) pass.
