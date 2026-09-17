# add-ext-sound — Tasks（R1 修订版）

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计）依赖 `add-ext-dialog` 批次 A 先行落地——**工程化依赖门（P1-6）**：共享
> 基线 commit 落地并验证（resolver/pack script 测试绿）后本 change 才进入实现；两 change
> 在共享基建与各自实现/验证均完成后一起归档。
> 评审记录：R1 5.5/10 NO-GO；本版吸收 P0-4、P1-4/5/6/7 与 §4.1/4.2/4.3 裁决。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过
  - 证据：vision validate add-ext-sound ok（2026-09-18）；dialog 批次 A 基线早已绿且 CI 接线经批次 D/泛化 embedded-packages 管线实证（CI runs 35225263870/35234464270/35237215398/35238822528 全绿）。；add-ext-dialog 批次 A（embedded artifact kind + check-pack-size + deferred envelope）已落地并测试绿为前置——**CI 硬依赖门（R5 P1-6）**：sound 的 native/facade CI 作业以 dialog 批次 A 产物绿为条件（needs/路径门），不靠文档排序。

## 2. BDD Contract

- [x] 2.1 `@opentray/spec`：BeepKind、SystemSoundName（`(string & {})` 联合 + 冻结三通用名常量表）、PlaySoundOptions（预留空对象）、SoundBackendCapabilities（共享 schema + exhaustive fixture）、typed 错误码四枚的 details discriminated union（`sound_not_found` details 含 requested/platform/attempted catalog）；单测。
  - 证据（commit 01f3f221）：spec 156/156（+6 sound schema 用例）；冻结表 Object.freeze + 投影常量 + isCommonSystemSoundName；SOUND_ERROR_CODES 四枚 + details 判别联合（not-found 携 {requested, platform, attempted[]}）。

## 3. Implementation — 批次 B（crates/opentray-ext-sound）

- [x] 3.1 darwin：NSBeep、NSSound(named:) 目录解析与播放、NSSound(contentsOfFile:) 文件播放 + delegate didFinishPlaying 实例回收（兜底定时探测）、**session-owned NSSound 实例集合**（close 只 stop 自己的）。
  - 证据（commit c80397b5）：macos/mod.rs delegate 回收 + session 集合；共享 NSSound 缓存实例的 coalesce-acceptance 语义（swift 隔离实验实证，设计 L62-73 裁决落档）。
- [x] 3.2 win32：MessageBeep 五级、`PlaySound(SND_ALIAS|SND_ASYNC|SND_NODEFAULT)` 方案名（NODEFAULT 禁回退默认音）、`PlaySound(SND_FILENAME|SND_ASYNC)` WAV 播放、**process-wide PlaybackArbiter**（同一 mutex 线性化 native 调用→返回值处理→token 提交/清除；token 覆盖 alias+filename 全路径不含 MessageBeep；close 同锁比较完整 token 匹配才 `PlaySound(NULL, SND_PURGE)`）。
  - 证据（commit c80397b5）：arbiter.rs 平台中性（cfg(any(windows,test))），7 项竞态族确定性单测（双线程交错 + try_current_token WouldBlock 证明/alias-vs-file 交替/native false/close race 双序/同 session 重放/注销所有权/sequence 唯一性）；SND 三件套旗标冻结；MessageBeep false→sound_not_found（messagebeep:MB_* attempted 标记，冻结四码目录内唯一归宿）。
- [x] 3.3 BackendCapabilities DTO 嵌入上报（v1 有限格式集）；双 target CI 编译门 + exhaustive fixture 比对。
  - 证据（commit c80397b5）：双平台构造器 exhaustive fixture 单测；交叉编译 x86_64-pc-windows-msvc + aarch64-pc-windows-msvc + host darwin 全部 0 warning；CI 35234464270 四目标作业绿。

## 4. Implementation — 批次 C（packages/ext-sound facade）

- [x] 4.1 `attachSound(tray, options?)` → capability（tray.extend 家族同构）；**`getBackend(): Promise<...>` 异步快照**（惰性加载后请求 DTO）；`contract.json`（extensionName "sound"、fingerprint contract-1）；embedded 描述符（复用 SDK 新 kind）。
  - 证据（commit 01f3f221）：无同步 backend 属性；快照冻结；v1 三方法零 DTO 门控（零额外帧，测试断言）；未知选项字段 pre-transport TypeError。
- [x] 4.2 facade preflight：playSystemSound 通用名表解析（命中→平台投影常量；未命中→原样透传）、**win32 WAV 精确内容校验**（≥12 字节/RIFF declared length ≤ 实际大小/完整 fmt+data chunk 边界/最大 64 MiB；伪装 MP3、截断 WAV、declared 溢出、`.wav` 后缀内容不符全部 typed 拒绝）、Linux typed unsupported。
  - 证据（commit 01f3f221）：validateWavBytes 纯函数闭集 9 拒因，覆盖冻结算术全矩阵（u32::MAX/declared-8 边界/奇 pad/chunk 过 declared vs 过 physical 分立/伪装 MP3+ID3/fmt<16/12 字节下限/64MiB 上限 stat 前置拒绝不 slurp）。
- [x] 4.3 vitest 确定性套件（Node+Bun）：解析顺序矩阵 / 内容校验矩阵 / 错误码 details payload / 描述符。
  - 证据（commit 01f3f221）：27/27 Node + 27/27 Bun 双跑。

## 5. Packaging — 批次 D

- [x] 5.1 native-build-graph 注册 `sound` component + 收齐矩阵（复用 dialog 批次 D 的 staging 模式）；package.json `files` 收口；pack-size 接入 + **真实体积实测报告**写入 evidence artifact。
  - 证据（commits 01f3f221 + ac202238；PR #7 CI run 35234464270 全绿，merge sha 见 run）：`pack-size OK @opentray/ext-sound tarball=opentray-ext-sound-0.0.0.tgz bytes=1064261（≈1.02 MiB）[real]`；embedded 证据管线泛化（embedded-packages 列表替代 dialog-staged 布尔，任意 embedded 包零改动接入）；解包逐 target identity 4/4 OK（8 行 identity 中 sound 占 4）；回执入 embedded-pack-evidence artifact。另：编排层独立复跑抓到双 crate ABI 错误槽测试并行竞态（进程级 ExtensionErrorSlot 并行互吞），ac202238 全量串行化修复，8 轮压测 26+26 确定性。

## 6. Verification

- [x] 6.1 双平台真机验收：三方法命令受理与错误分支语义验证（原生返回值/broker.log 取证，可闻性不作门）；通用名×3 + 双平台各一原生名 + 必 miss 名（details payload 断言）+ **NODEFAULT 无回退取证**；**PlaybackArbiter 竞态族**（两线程 swap/play 交错、alias-vs-file 交替、native false、close race；spy/wrapper 断言实际 SND_PURGE 与播放次序）；backend DTO 上报（getBackend）。
  - 证据：darwin（c80397b5，S-Rust probe 全矩阵）；Windows 真机 honor 主机 2026-09-17（commits 0574c601 probe win32 腿 + da37e8e3 注册表 oracle）：`cargo test -p opentray-ext-sound` 26/26；probe release 全矩阵——beep/common×3/native SystemHand/playSound(真实 C:\Windows\Media WAV) 全 [ok] immediate；**真机抓到并修复一个法则级缺陷**：winmm `PlaySoundW` 在 `SND_ALIAS|SND_NODEFAULT` 下对不存在 alias 返回非零（NODEFAULT 只抑制默认音、BOOL 仍报成功），native BOOL 不是 alias miss oracle——da37e8e3 增设 `HKCU\AppEvents\Schemes\Apps\.Default\<name>` 注册表目录预检：缺键 = typed `sound_not_found`（attempted 含 registry-scheme 阶段）+ **零 native 调用**（设计的拒绝路径 spy 法则），修复后必 miss 名 [err] 全载荷正确；PlaybackArbiter 竞态族 7 项确定性单测双平台通过（26/26 ×2）；getBackend DTO 由 lib 测试冻结双平台构造器 fixture 覆盖。
- [x] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check；**真实 pack 证据**（共享 check-pack-size 脚本：真实 tgz stat/digest + 解包逐目标 identity，含 sha256/buildIdentity 断言）。
  - CI run 35256693589 全绿；sound vitest 28/28 Node+Bun；cargo 26/26 darwin + Windows 真机；pack-size 1.02MiB OK；vision validate + check ok。

## 7. Release

- [ ] 7.1 AGENTS.md
  - 证据：8e3ac5e8 Sound Extension Law 章（fire-and-forget、冻结三通用名、PlaybackToken 所有权门控、WAV 内容校验、session 集合停止 + 注册表 oracle 法则 + 有界两遍读）。：Sound Extension Law 提炼落档（fire-and-forget、冻结三通用名目录、PlaybackToken 所有权门控、WAV 内容校验、session 集合停止）。
- [ ] 7.2 skills/opentray
  - 证据：46f07da8 references/ext-sound.md + packages/ext-sound/README。 公共消费文档 + packages/ext-sound/README。
- [ ] 7.3 self-review
  - 证据：a66b1dc4 + 复核轮 .agents/review/2026-09-18-ext-sound-impl-r1.md R1 7.6→R3 9.2/10 集成 GO（双 P1 + 峰值残留全闭合，含 dialog 同族 getBackend 缺陷连带修复）。（md+html）+ check ok:true + Codex 复核至 GO（R1 P1-7 补项）。
- [ ] 7.4 changeset
  - 证据：9e8fe5b7 与 add-ext-dialog 同波。（minor）→ 与 add-ext-dialog 同波发布。
