# add-ext-sound — Tasks

> 规范附录：`plans/design-reference.md` 是实现准绳。共享基建（embedded artifact kind、
> pack-size 审计）依赖 `add-ext-dialog` 批次 A 先行落地。

## 1. Alignment

- [ ] 1.1 plan 索引与 design-reference 一致；validate 通过；add-ext-dialog 批次 A（embedded artifact kind + check-pack-size）已落地为前置。

## 2. BDD Contract

- [ ] 2.1 `@opentray/spec`：BeepKind、SystemSoundName（`(string & {})` 联合）、PlaySoundOptions（预留空对象）、SoundBackendCapabilities、typed 错误码四枚（`sound_platform_unsupported` / `sound_not_found` / `sound_format_unsupported` / `sound_file_unreadable`）；单测。

## 3. Implementation — 批次 B（crates/opentray-ext-sound）

- [ ] 3.1 darwin：NSBeep、NSSound(named:) 目录解析与播放、NSSound(contentsOfFile:) 文件播放 + delegate didFinishPlaying 实例回收（兜底定时探测）、session 停止（stop + 释放）。
- [ ] 3.2 win32：MessageBeep 五级、PlaySound(SND_ALIAS) 方案名、PlaySound(SND_FILENAME|SND_ASYNC) WAV 播放、PlaySound(NULL, SND_PURGE) session 停止。
- [ ] 3.3 BackendCapabilities DTO 嵌入与上报；交叉编译门（darwin target 编过 = win32 序列化齐全）。

## 4. Implementation — 批次 C（packages/ext-sound facade）

- [ ] 4.1 `attachSound(tray, options?)` → capability（tray.extend 家族同构）；`contract.json`（extensionName "sound"、fingerprint contract-1）；embedded 描述符（复用 SDK 新 kind）。
- [ ] 4.2 facade 前置校验：playSystemSound 解析顺序（通用名表 → 原生名透传 → typed miss）、win32 非 WAV 前置拒绝、路径解析 + `~` 展开 + 不可读 typed、Linux typed unsupported。
- [ ] 4.3 vitest 确定性套件（解析顺序矩阵 / 格式前置 / 错误码 / 描述符）。

## 5. Packaging — 批次 D

- [ ] 5.1 构建管线：staging 到 `platforms/<target>/`（复用 dialog 批次 D 的管线改动模式）；package.json `files` 收口；pack-size 配置纳入。

## 6. Verification

- [ ] 6.1 双平台真机验收：三方法命令受理与错误分支语义验证（原生返回值/broker.log 取证，可闻性不作门）；通用名×3 + 双平台各一原生名 + 必 miss 名；session close 停止；backend DTO 上报。
- [ ] 6.2 全量门：workspace 测试 + typecheck + 交叉编译 + vision validate；`npm pack --dry-run` 体积证据。

## 7. Release

- [ ] 7.1 AGENTS.md：Sound Extension Law 提炼落档（fire-and-forget、解析顺序、格式矩阵、session 停止）。
- [ ] 7.2 skills/opentray 公共消费文档 + packages/ext-sound/README。
- [ ] 7.3 changeset（minor）→ 与 add-ext-dialog 同波发布。
