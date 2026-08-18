# create-no-first-launch-force-terminal — Intent Document SSOT

## 用户原始需求（时间戳记录）

- 2026-08-19：`create-opentray` 有 BUG：「正在生成应用…」卡在 `[launch] waiting for app ready marker`，最后显示 `generated app entry exited early with 1`，要求分析原因。
- 2026-08-19（追问）：「你的意思是创建应用的时候，还会运行一次命令？？」——用户对生成期重跑命令表示意外，要求保留已计划工作并审视更深层设计。
- 2026-08-19（决策 1）：去掉首启验证。「因为我们已经在 webui 面板提供了运行命令的动作，这里已经能暴露问题。」
- 2026-08-19（决策 2，补偿机制）：「默认情况下我们有一个终端的窗口，这个是基于高级配置来控制显示与否，但是如果我们发现它是异常退出，那么我们需要强制显示这个窗口，来告知用户异常。这样就能弥补可能隐藏掉的风险问题。」
- 2026-08-19（决策 3，嗅探策略）：「为什么要限制时间，端口又不是只有一个，只要在运行期间，那么就应一直嗅探，只不过为了降低 CPU 消耗，我们需要控制成本……比如检测当前的 CPU，最低可能要到 5s 一次，正常可能是 1s 一次。」

## 用户语言系统

- 「生成应用」= materialize 向导终段；「首启验证」= 生成期 first launch（重跑命令 + ready marker 门）。
- 「终端的窗口」= 生成应用内嵌的 web 终端窗（app-shell terminal），不是系统终端。
- 「强制显示这个窗口」= 异常退出时无视高级配置强制弹出。
- 「嗅探」= 对命令进程树监听端口做扫描 + HTTP 验证；「控制成本」= 自适应轮询频率。

## 事实（取证实证，2026-08-19）

1. 直接死因：生成的 `main.mjs`（plain 模式）在 `sniffServicePort(30_000)` 阻塞门超时抛错 → 顶层 await 未捕获 → exit 1 → 父进程报 `generated app entry exited early with 1`。两个失败项目（`~/.opentray/create/npx`、`~/.opentray/create/web-dsh-npx`）的 `app.log` 均只有一行 `no HTTP service found among the command's listening ports within 30000ms`。
2. ready marker 是 `main.mjs` 最后一行 stdout；走不到即表现为 UI 卡在 `waiting for app ready marker`（35s ≈ 30s 嗅探 + 启动开销）。
3. 命令实测（`npx -y @deepseek-ai/dsh@latest web`）：dsh 监听**随机端口**（argv `--port=0`），HTTP 200 正常；慢点不在服务端验证逻辑。
4. 环境不对等实证：向导预览经 PTY（TTY + TERM + 可交互 stdin）运行命令；生成首启用 pipes + stdin `ignore`。30 秒零命令输出。
5. 进程泄漏实证：机上残留昨日 16:49 孤儿 `npm exec`（PPID=1）与 02:32 从 Darwin bundle 冷启动的旧版 `main.mjs` 僵尸树（broker 已死仍存活）。泄漏机制双向成立：向导预览 PTY kill 只杀直接子进程；生成入口 `killCommand` 只 SIGTERM 直接子进程。均不清进程树。
6. 诊断不可见实证：真实原因只写入 `<projectDir>/app.log`；入口 stderr 为 `inherit`（流向向导终端，WebUI 不可见）；父进程丢弃所有非 marker stdout 行。

## 推断（无法完全还原，已被修复覆盖）

- 30s 内服务未出现的具体触发者无法完全还原（候选：非 TTY 下 npx @latest 静默慢装/行为分歧；旧实例或孤儿占端口导致 dsh 退避随机端口晚出现）。修复对三者均免疫：无时间上限 + PTY 对等 + 持续嗅探随机端口。

## 决策

| # | 决策 | 依据 |
|---|------|------|
| D1 | 生成期不再重跑命令（删除 first launch 阶段） | WebUI 面板已能暴露命令问题；重跑环境与预览不对等且成本高 |
| D2 | 终端窗口成为每个生成应用的一等组件；`showTerminal` 仅控制初始显示；命令**异常退出**（exitCode≠0 或任何服务验证前退出）时强制弹出并回放输出 | 弥补去掉首启验证后的风险隐藏 |
| D3 | 嗅探无时间上限；自适应频率 1s→5s（loadavg + 活动度调制） | 用户明确否决时间限制；成本用频率控制 |
| D4 | 命令恒走 PTY（`@lydell/node-pty` 无条件依赖，加载失败降级 pipes 记 app.log） | 与预览环境对等；终端窗口本身需要 PTY |
| D5 | 向导预览 kill 与生成入口 killCommand 均改为进程树清理 | 杜绝孤儿占端口毒化后续运行 |
| D6 | 入口顶层 try/catch：任何启动错误连同堆栈写 app.log 后 exit 1 | 入口自身崩溃时终端窗无法弹出，app.log 是唯一现场 |

## 开放问题

- 无阻塞项。后续增强（不在本变更）：终端窗口内提供「重启命令」操作；服务未出现时的等待页窗口。

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 保留首启验证 + 仅修诊断透传 | 用户决策 D1：WebUI 面板已暴露命令问题，重跑冗余 |
| 生成期接管预览进程实例 | 跨进程移交活 PTY 子进程不可行；违反平台法（禁止一个 CLI 拥有另一 CLI 生命周期） |
| 嗅探超时提高至 120s 硬预算 | 用户决策 D3：不应有上限，成本由频率控制 |
| 终端窗口常驻隐藏（预建） | 隐藏 appMode 窗口有 Dock 投影风险 + 常驻成本；改为按需创建 + ring 回放 |

## 平台法定位

本变更是现行平台法下的常规原子，不破法：
- 「生成的应用是命令的监督者」不变，仅移除生成期的额外一次运行。
- 遵守 WebView 轮询成本法：嗅探 0.2–1Hz 自适应，禁止隐藏高频轮询。
- Darwin bundle 物化时机后移至首次真实打开（App Launch Law 不变：冷启动描述符仍是 node main.mjs）。

## 最终可见效果（操作者视角）

1. 向导「正在生成应用…」只含 scaffold/icon/install 三步，依赖装完即成功——不再卡在 launch/bundle，也不会再出现 `exited early with 1`。
2. 成功页「打开应用」首次冷启动命令（与预览一致的 PTY 环境），服务在随机/固定端口出现后窗口自动打开，多端口各一窗。
3. 命令异常退出时，终端窗口无视高级配置强制弹出，完整回放命令输出与退出码——用户不再需要去翻 app.log 才知道发生了什么。
4. 向导预览关闭、应用退出后无孤儿进程残留（不再毒化下一次运行）。

## 意图驱动计划

### A. 生成流程简化
- `materialize.ts`：删除 `launchGeneratedApp`/`firstLaunchEntry`/READY_MARKER 协议/bundle `waitForDirectory`；`materialize` = `materializePayload`。
- `wizard.ts`：`create()` payload-only；success 不带 bundlePath；pinHint 文案（Darwin）改为「首次打开应用后可固定 Dock」。
- `lifecycle.ts`（CLI）同步；`open-app.ts` Darwin 无 bundle 时回退 detached `node main.mjs` 冷启动。
- `create-dialog.tsx` 步骤徽章 → `["scaffold","icon","install"]`。

### B. 入口重构（异常呈现面）
- `scaffold.ts`：shell server + `app-shell/` 资产 + `@lydell/node-pty` 无条件装配。
- `entry-template.ts`：恒 PTY（降级 pipes）；删阻塞嗅探门；持续自适应 monitor（1s→5s，loadavg+活动度）驱动一端口一窗；终端窗 `showTerminal` 初始显示、异常退出按需创建/`toVisible()+focus()` 强制弹出（shell ring 2000/回放 400 保证晚开可见）；killCommand 树杀（POSIX 组杀 + pgrep -P sweep，SIGTERM→宽限→SIGKILL）；顶层 catch 落盘 app.log。
- `command-run.ts`：预览 `startPtyRun.kill()` 补后代 sweep + 有界等待。

### C. 验证
- 单测：materialize 无 launch 阶段；open-app 冷启动回退；entry-template 渲染断言（恒 PTY、无门、异常弹窗、树杀、顶层 catch）；scaffold 恒装；command-run kill sweep。
- 手工（macOS, dsh 命令）：生成三步即成；打开应用冷启动 + 服务窗口；异常退出强制弹终端窗；退出无孤儿。
- 回归：`bun test packages/create` + vision-driven 基线。
