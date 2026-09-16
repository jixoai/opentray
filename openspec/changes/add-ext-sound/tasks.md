# add-ext-sound — Tasks（R1 修订版）

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计）依赖 `add-ext-dialog` 批次 A 先行落地——**工程化依赖门（P1-6）**：共享
> 基线 commit 落地并验证（resolver/pack script 测试绿）后本 change 才进入实现；两 change
> 在共享基建与各自实现/验证均完成后一起归档。
> 评审记录：R1 5.5/10 NO-GO；本版吸收 P0-4、P1-4/5/6/7 与 §4.1/4.2/4.3 裁决。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过；add-ext-dialog 批次 A（embedded artifact kind + check-pack-size + deferred envelope）已落地并测试绿为前置。

## 2. BDD Contract

- [ ] 2.1 `@opentray/spec`：BeepKind、SystemSoundName（`(string & {})` 联合 + 冻结三通用名常量表）、PlaySoundOptions（预留空对象）、SoundBackendCapabilities（共享 schema + exhaustive fixture）、typed 错误码四枚的 details discriminated union（`sound_not_found` details 含 requested/platform/attempted catalog）；单测。

## 3. Implementation — 批次 B（crates/opentray-ext-sound）

- [ ] 3.1 darwin：NSBeep、NSSound(named:) 目录解析与播放、NSSound(contentsOfFile:) 文件播放 + delegate didFinishPlaying 实例回收（兜底定时探测）、**session-owned NSSound 实例集合**（close 只 stop 自己的）。
- [ ] 3.2 win32：MessageBeep 五级、PlaySound(SND_ALIAS) 方案名、PlaySound(SND_FILENAME|SND_ASYNC) WAV 播放、**PlaybackToken {sessionId, generation, sequence} 原子替换所有权**（close 仅在 token 归属本 session 时 `PlaySound(NULL, SND_PURGE)`；「accepted but prior owner superseded」内部状态）。
- [ ] 3.3 BackendCapabilities DTO 嵌入上报；双 target CI 编译门 + exhaustive fixture。

## 4. Implementation — 批次 C（packages/ext-sound facade）

- [ ] 4.1 `attachSound(tray, options?)` → capability（tray.extend 家族同构）；`contract.json`（extensionName "sound"、fingerprint contract-1）；embedded 描述符（复用 SDK 新 kind）。
- [ ] 4.2 facade preflight：playSystemSound 通用名表解析（命中→平台投影常量；未命中→原样透传）、**win32 WAV 内容校验**（路径展开/canonicalize/readability/大小上限/RIFF+WAVE header；伪装 MP3、截断 WAV、`.wav` 后缀但内容不符全部 typed 拒绝）、Linux typed unsupported。
- [ ] 4.3 vitest 确定性套件（Node+Bun）：解析顺序矩阵 / 内容校验矩阵 / 错误码 details payload / 描述符。

## 5. Packaging — 批次 D

- [ ] 5.1 native-build-graph 注册 `sound` component + 收齐矩阵（复用 dialog 批次 D 的 staging 模式）；package.json `files` 收口；pack-size 接入 + **真实体积实测报告**写入 evidence artifact。

## 6. Verification

- [ ] 6.1 双平台真机验收：三方法命令受理与错误分支语义验证（原生返回值/broker.log 取证，可闻性不作门）；通用名×3 + 双平台各一原生名 + 必 miss 名（details payload 断言）；**A/B 会话交错与关闭顺序四格**（不持有 token 的 close 不得 purge 他人播放）；backend DTO 上报。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 双 target CI 编译门 + vision validate + check；`npm pack --dry-run` 体积证据。

## 7. Release

- [ ] 7.1 AGENTS.md：Sound Extension Law 提炼落档（fire-and-forget、冻结三通用名目录、PlaybackToken 所有权门控、WAV 内容校验、session 集合停止）。
- [ ] 7.2 skills/opentray 公共消费文档 + packages/ext-sound/README。
- [ ] 7.3 self-review（md+html）+ check ok:true + Codex 复核至 GO（R1 P1-7 补项）。
- [ ] 7.4 changeset（minor）→ 与 add-ext-dialog 同波发布。
