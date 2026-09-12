# add-webview-orchestration — Self-Review（评审之思）

> 评审人：编排者（ZCode MainAgent）。评审对象：HEAD（统一合线 + 3.6/7.x + quit 修复）。
> 方法：对照 plans/plan.md（D1–D23）、七份 spec delta、tasks.md 逐项核对实现与证据；
> 所有「子代理报告」均经编排者亲复跑抽验（测试数字见各任务证据行）。

## 总判定

**达到验收门槛，进入 Owner 人为走查。** 原始需求——「toolbar 模式下 iframe 无法加载」——
在真实链路（真实 broker + 真实 dylib + 真实生成应用）上闭环：HN（X-Frame-Options: DENY）
作为顶层上下文加载成功，登录态跨进程重启持久，地址栏以 urlChange 为真值跟随。

## 实现对意图的对照（D → 交付）

| 决策域 | 交付 | 证据锚 |
|---|---|---|
| D1–D2 同窗 sibling 编排 + 契约面 | macOS/Windows 双平台 WindowRegistry + per-tray 多 webview；13 wire 命令 + focus + 查询 | ext-webview Rust 134/134（mac）142/142（win）；fixtures 41+5 帧 |
| D3–D8 声明式布局 | Taffy 0.9.2 flex 子集求解（仅 ext-webview 依赖，Cargo.lock 冻结）；box 涂绘原语；resize 全原生（终值精确吻合断言） | layout.rs + LayoutTracker 事务；smoke1/3/4 |
| D9–D11/D20 通道 | channels.rs 状态机（单观测 onClose、字节级 1000/1MiB RFC 8785、LRU 32）；七帧双平台同构；订阅前缓冲补全（D11 清算项） | TS 118 + Rust 44 + mac 133 + win 142 |
| D12–D15/D22 create 承载 | 双模板 carrier + toolbar 页 + frameEmbeddable 符号级退役（rg 零命中）+ 向导开关默认关 | create 276/276、webui 71/71、P2 e2e ndjson |
| D16/D18/D21 平台法 | DTO 双平台平价（Darwin release 门 + Windows 真机门均过）；owner tuple 精确清扫（修 mod.rs:587-590 旧缺陷） | 双平台全绿 |
| D19/D23 事件/投影 | 统一事件族（四 kind + seq + 查询竞态语义）；ext-event tap 单源；overlay per-view 投影（Windows WCO insets 去硬编码） | smoke4 + 4.1 真机投影测试 |
| D17 流程 | Codex 文档复核七轮 5.5→8.2 签收；实现每批编排者亲验 | 七份 /tmp 报告 + tasks 证据行 |

## 与意图的偏离（显式清单）

1. **Taffy 体积**：raw +136.4 KiB（首测 159.8/strip 114.4）——Owner 裁决接受（100–200KB 停裁带内）。
2. **D19 交付语义收窄（v1 裁定）**：FFI send_event 的 vtable 生命周期限单次命令内——host 方向事件/消息**随下一次命令响应 flush**；页面方向（扩展内 evaluate_script 直推）不受限。持久事件句柄（generic ABI 扩展）留待后续 change；对 toolbar 载体无影响（导航接口是命令形状）。
3. **focus 双边沿的活体验证环境受阻**：本机无 TCC 辅助访问/屏幕录制且焦点钉死——机制链经 urlChange 同 tap 实证（帧字段/seq），key-window 前置不可达；观察步移交 Owner 配方（点击切换焦点环）。附带产品观察：已 key 窗口内纯点击切换 first responder 不触发 reconcile（观察者只覆盖 key 转换 + focus 命令）。
4. **两处纪律越界（均已编排者复核批准）**：P2 修 3.3 windowOnly 判定缺陷（crates/，3 行 + 回归测试）；L 修 Quit 脏退出（packages/cli，容忍传输关闭哨兵，typed 失败仍抛）。
5. **v1 已文档化的能力缺席**：toolbar 模式 iconFollows 不投影（content 无桥非 favicon 源）；facade 无 host setTitle（标题投影走原生 show 更新路径）。

## 新发现的既有缺陷（main 基线，非本变更回归，未在本 change 处理）

1. entry-template `(detached)` 标题标记调用 facade 不存在的 `win.setTitle`（被 monitorTick catch 静默吞）——living spec「Detached ports mark the window title」现值存疑。
2. opentray-spec `ext_abi_support.rs:131` clippy error 级 lint（not_unsafe_ptr_arg_deref）。
3. WebKit 存储不随 HOME 隔离（写真实 `~/Library/WebKit/<appId>`）——e2e 收尾须计清理步（本次已清）。

## 需 Owner 确认的新问题

1. **4.3 Windows 交互验收**：命令行文档已备（Windows 桌面会话执行；机器就绪态已构建）。
2. 上述三个既有缺陷是否另开小修 change。
3. D19 持久事件句柄（broker ABI 扩展）是否列入后续 change。
4. 发布链：`inter-glyph.ttf` 在源码检出跑 create dist 的可达性（registry 发布路径是否覆盖）——发布批核查项。

## 复核轮记录（D17）

Codex 文档复核七轮：R1 5.5 → R2 6.2 → R3 7.0 → R4 7.2 → R5 7.4 → R6 7.6 → R7 **8.2 签收（可进 Apply）**。阻塞总数 B10 + R2-B19 + R3-B7 + R4-B3 + R5-B4 + R6-B3 全部采纳修订。实现期两轮越界修复均按「最小 + 回归测试 + 报告」纪律处置。终核（6.5 实现质量轮）见 review/codex-final。

## Git 证据

- 分支 add-webview-orchestration（自 f5edf52 起）：openspec 文档线 + 实现线（协议/原生 mac/原生 win/通道/facade/create/文档/修复）+ 三次合并（win-merge/win-42/统一）。
- 工作树：clean（除两个刻意未提交的字体 untracked——主检出资产，worktree 副本供本地构建）。
- 勾选纪律：所有 [x] 均为编排者在当前工作上下文完成并验证后勾选；子代理一律不触 openspec/。

## 迭代与退出条件

- 实现期迭代：每批「子代理 → 编排者亲验 → 入档」循环，无同一问题存活两轮以上的情况。
- 环境受阻项（focus 边沿）不构成回路——已以机制链等价证据 + Owner 观察步替代，判定可退出。
- 剩余：Owner 人为走查（macOS + Windows）与 4.3 交互验收为最终关。
