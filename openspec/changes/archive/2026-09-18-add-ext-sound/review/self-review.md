# add-ext-sound — Self-Review（实现阶段）

> 评审人：编排者。对象：批次 B–D 实现（Rust crate、TS facade、打包/CI）后的完整 change 状态。
> 性质：**实现自评**——设计冻结（dialog 批次 A 基建依赖门满足后开工），双代理实现完成，
> 双平台真机验收（task 6.1）含一项法则级缺陷抓修；全量门（6.2）与发布链（7.x）仍由编排者
> 收口，本档不代勾。

## 总判定

设计经共享评审链收敛（R1 5.5 → R3 6.6 修正 → R5 8.0 / R6 8.6 NO-GO 依赖门 →
R7 9.0 GO，附 dialog 批次 A 依赖）；dialog 批次 A 落地后实现开工。当前状态：**实现完成
（批次 B 双平台 crate + 批次 C facade + 批次 D 打包/CI 证据 + 6.1 双平台真机验收含
registry-oracle 法则修正），等待 6.2 全量门 + 7.x 发布链（7.1 法则定稿已落、7.2 消费文档
已落、minor changeset/同波发布待办）**。

## 实现证据与闭合台账

| 批次 | 证据 | 关键发现 → 闭环 |
|---|---|---|
| B（crate 双平台） | commit c80397b5 | darwin：NSBeep/NSSound 目录/文件播放 + delegate 回收 + session-owned 实例集合（close 只 stop 自己的）；win32：PlaybackArbiter 平台中性核心（单 mutex 线性化 native 调用→返回值→`(sessionId, instanceGeneration, sequence)` token；close 同锁全 token 匹配才 `SND_PURGE`），7 项竞态族确定性单测双平台通过；SND 三件套旗标冻结；DTO 双平台构造器 exhaustive fixture；交叉编译 x86_64/aarch64-pc-windows-msvc 0 warning |
| B（真机抓修，法则级） | commits 0574c601 + **da37e8e3** | Windows 真机（honor 主机 2026-09-17）抓到：winmm `PlaySoundW` 在 `SND_ALIAS\|SND_NODEFAULT` 下对不存在 alias 返回非零——**native BOOL 不是 alias miss oracle**。修复：`HKCU\AppEvents\Schemes\Apps\.Default\<name>` 注册表目录预检为权威 miss oracle，缺键 = typed `sound_not_found`（attempted 含 registry-scheme 阶段）且**拒绝路径零 native 调用**；修复后必 miss 名 [err] 全载荷正确（cargo test 26/26） |
| C（facade） | commit 01f3f221 | `attachSound` 无同步 backend 属性；getBackend 冻结快照；通用名表解析（命中→平台投影，未命中→透传）；win32 WAV 结构校验纯函数闭集 9 拒因（u32::MAX/declared-8 边界/奇 pad/chunk 过 declared vs 过 physical 分立/伪装 MP3+ID3/fmt<16/12B 下限/64MiB 上限 stat 前置）；Linux typed unsupported；27/27 Node + 27/27 Bun |
| D（打包/CI） | commits 01f3f221 + ac202238；PR #7 CI run 35234464270 全绿 | 真实 pack 1,064,261 B（≈1.02 MiB，低于 2 MiB 警戒线）；**embedded 证据管线泛化**（embedded-packages 列表替代 dialog 专用布尔，任意 embedded 包零改动接入）；解包逐 target identity 4/4 OK；另抓修双 crate ABI 错误槽测试并行竞态（进程级 ExtensionErrorSlot 互吞，ac202238 串行化，8 轮压测 26+26 确定性） |
| 6.1（真机验收） | tasks 6.1 证据 | 双平台：三方法受理/错误分支（原生返回值/broker.log 取证，可闻性不作门）；通用名×3 + 双平台各一原生名 + 必 miss 名（details payload 断言）+ NODEFAULT 无回退取证；PlaybackArbiter 竞态族 7 项双平台 26/26×2；getBackend DTO fixture |

## 已知边界（诚实声明）

1. darwin 可闻性不作验收门（无人工听觉断言），以原生返回值/broker.log 为门——已冻结。
2. sound 实现没有独立的分批复核轮：设计裁决由共享评审链（R1–R7）持有，实现证据以
   tasks.md 记录 + CI 真实运行 + 真机 probe 为准；发布前如编排者要求，可对 sound facade
   单独追加一轮 Codex 复核。
3. 6.2 全量门与 7.3/7.4 发布链未完成——本档不宣告发布 GO。

## Git 证据

- 设计链：d0e48d79（R1）→ …（R2/R3 修订）→ R7 GO（依赖 dialog 批次 A）。
- 实现链：c80397b5（crate）→ 01f3f221（facade + spec schema + build-graph/CI 接入）→
  ac202238（测试串行化）→ 0574c601 + da37e8e3（win32 真机 probe + registry oracle）→
  bb128227（6.1 证据回填）。
- 评审链：.agents/review/2026-09-17-ext-dialog-sound-r{1..7}.md（共享设计链）。
- validate / verify:spec-consistency：通过。
