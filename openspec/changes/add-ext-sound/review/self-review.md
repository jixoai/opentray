# add-ext-sound — Self-Review（设计阶段）

> 评审人：编排者。对象：R3 修订后的 design-reference / spec delta / tasks。
> 性质：**research-plan 阶段自评**——实现尚未开始（依赖 add-ext-dialog 批次 A 基建先行）；
> 本档在实现完成后更新为实现自评。

## 总判定

设计经 Codex 三轮评审（5.5 → 6.2 → 6.6）收敛，R3 指出的 sound 侧问题（虚构多 session
BDD、RIFF 解析不精确、dry-run 证据矛盾、embedded 身份字段缺失）全部修正。
当前状态：**设计冻结候选，等待 R4 GO + dialog 批次 A 落地后进入实现**。

## 对照 R3 的闭合自查

| R3 项 | 落点 | 自查结论 |
|---|---|---|
| P0-4 虚构多 session | spec Requirement 1 场景重写（单 session 集成 + arbiter 模拟双 token 单测；不命名活的第二 caller session） | 闭合 |
| P1-1 RIFF 精确算术 | design §1.3 + spec playSound（declared_size+8≤actual、fmt 与 data 都必须、chunk 边界含奇数 pad、fmt≥16B、fixture 七族、spy 零调用断言） | 闭合 |
| P1-3 证据矛盾 | design §5 / tasks 6.2 改真实 pack 脚本 + 解包 identity；embedded 场景补 sha256/buildIdentity | 闭合 |
| SND flags / arbiter / 有限格式集 / getBackend | R2 已冻结，R3 复核为正确（报告 §5「Frozen decisions」） | 维持 |

## 已知边界（诚实声明）

1. 实现依赖门：dialog 批次 A（DeferredOperation/embedded/pack 基建）落地并测试绿后才开工
   （tasks 1.1）；两 change 同波归档。
2. darwin 可闻性不作验收门（无人工听觉断言），以原生返回值/broker.log 为门——已冻结。
3. PlaybackArbiter 的跨线程交错证明依赖实现期 spy/wrapper 测试，证据回填本档。

## Git 证据

- 本阶段 commits：d0e48d79（R1 版）→ 82981086（R2 版）→ 本次（R3 版）。
- 评审链：.agents/review/2026-09-17-ext-dialog-sound-r{1,2,3}.md。
- validate：通过（每次修订后重跑）。
