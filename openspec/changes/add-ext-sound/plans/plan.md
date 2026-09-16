# add-ext-sound — Intent Document (SSOT)

> 原始需求（Owner，2026-09-17）：
> 1. 「关于 beep，新增 @opentray/ext-sound 这个包，提供 playSystemSound(name or platform-name)、beep(BeepKind)。playSound(path) 这个看情况提供，我们优先保持轻量，如果平台能低成本提供，那就做，如果只有部分平台能低成本提供，那就做成部分平台特供接口。」
> 2. 「后续就和 Codex 去讨论。除非有重大决策项需要我参与就停下来问我，否则以 Codex 的决策为准。如果可以就持续推进，直到全部开发和测试全部完成。」
>
> 用户语言系统：**「优先保持轻量」「能力原子」「以 Codex 的决策为准」**。
> 关联 change：`add-ext-dialog`（同波开发；其批次 A 交付的 embedded artifact kind 与
> pack-size 审计是本 change 直接复用的共享基建；beep 从 dialog 移出的裁决记录在该 change）。
> 评审记录：Codex R1（2026-09-17）：add-ext-sound **5.5/10 NO-GO**——本版为 R1 修订版
> （P0-4 播放所有权 token 化、P1-4 WAV 内容校验、P1-5 解析可测性、P1-6 依赖工程化、
> P1-7 self-review 缺项、§4.1/4.2/4.3 裁决全部吸收）。

## 最终可见效果（operator 视角）

- `pnpm add @opentray/ext-sound` 一个包即得：`beep(kind)`（win32 五级 MessageBeep；darwin NSBeep 文档化降级）、`playSystemSound(name)`（通用名表 + 平台原生音名直通）、`playSound(path)`（双平台低成本结论成立 → 通用 API，win32 WAV-only typed 拒绝非 WAV）。
- 内嵌四目标二进制单包发布（复用 embedded artifact kind），压缩体积远低于 2MB 警告线。
- 声音播放为 fire-and-forget（播放**开始**即 resolve，无完成事件）；session close 停止该 session 启动的播放。
- Linux 调用得到 typed `sound_platform_unsupported`，不触碰 broker。

## 调研事实（API 层面，实现批核验补锚点）

- win32：`MessageBeep` 五级（OK/ICONASTERISK/ICONEXCLAMATION/ICONHAND/ICONQUESTION，winmm/user32）；`PlaySound(SND_FILENAME|SND_ASYNC)` 仅 WAV、**进程级单声道**（后一次调用取消前一次）；**`PlaySound(NULL, SND_PURGE)` 是进程级停止——无 session 参数，任一实例调用都会停止全进程播放**（R1 P0-4：session close 直接 purge 会误伤其它 session）；压缩格式需 Media Foundation（重依赖，违反轻量）。系统事件音走 `SND_ALIAS`（注册表声音方案名）。
- darwin：`NSBeep()` 单一系统 alert 音；`NSSound(named:)` 命名系统音目录（Basso/Sosumi/Glass/Pop…）+ `NSSound(contentsOfFile:)` 播放文件（wav/aiff/mp3/m4a 等 CoreAudio 格式），实例须存活至播放完成（delegate/retain）；AppKit 经 Darwin carrier 已就绪（ext-badge 同族依赖）。
- 两个平台对 `playSound` 都是低成本（winmm / AppKit 均无新增链接依赖）→ 按 Owner 裁决规则做成**通用 API + 行为矩阵**，无需平台特供形态。
- 声音命令非模态、不阻塞；无 EventPort 需求（完成事件 v1 不做）。

## 决策（D1–D5；细节以 design-reference.md 为准）

| # | 决策 | 依据 |
|---|------|------|
| D1 | 包 `@opentray/ext-sound`，crate `crates/opentray-ext-sound`，embedded 单包内嵌四目标（复用 `add-ext-dialog` 批次 A 基建，不重复建设） | Owner 裁决原文；体积规范（2026-09-16）；薄封装预期 << 2MB（实测为证，R1 §4.5） |
| D2 | 能力面 = `beep(BeepKind)` + `playSystemSound(通用名 \| 平台原生名)` + `playSound(path)`；**playSound 成本结论：双平台低成本 → 通用 API**；win32 WAV-only 以**内容校验**执行（RIFF/WAVE header + 大小上限 + canonicalize/readability 前置，非仅扩展名） | Owner 成本规则两分支裁决；R1 P1-4 |
| D3 | `playSystemSound` 解析顺序：通用名表（**R1 §4.1 冻结三项：notification/warning/error**）→ 平台原生音名 → miss 则 typed `sound_not_found`（details 含 requested name/platform/attempted mode），绝不静默无声；「accepted」判定以原生返回值为准 + broker.log 诊断 | R1 §4.1 + P1-5 |
| D4 | 播放语义 = fire-and-forget（resolve 于播放开始）；无完成事件；**session close = PlaybackToken 所有权门控**（R1 §4.2/P0-4）：token `{sessionId, generation, sequence}` 原子替换记录当前 win32 播放 owner，close 仅在 token 仍归该 session 时 `PlaySound(NULL, SND_PURGE)`；darwin 维护 session-owned NSSound 实例集合，close 只 stop 自己的集合 | P0-4：SND_PURGE 进程级误伤；token 非 Node-facing API，不改 fire-and-forget |
| D5 | 流程：单 change，批次 A（spec 类型；embedded 基建依赖 add-ext-dialog 批次 A，**工程化依赖门**：共享基线 commit 落地并验证后本 change 才进入实现，两 change 共享基建与各自验证均完成后一起归档）→ B（crate 双平台）→ C（facade）→ D（staging + 体积门）→ E（验证 + 文档 + changeset） | R1 P1-6 依赖工程化 |

## 开放问题（R1 已全部裁决，冻结如下）

| 问题 | 裁决（R1 §4，冻结） |
|------|----------|
| 通用系统音名表 | **仅三项**：`notification`(Glass/SystemAsterisk)、`warning`(Sosumi/SystemExclamation)、`error`(Basso/SystemHand)；`default/info/question` 只属于 `beep(BeepKind)`，不进 playSystemSound 目录（alert 分级与命名系统音不混层） |
| win32 播放并发/停止语义 | PlaybackToken 所有权门控（D4）；后播放原子替换旧 token 并按 win32 语义取消旧播放，内部状态「accepted but prior owner superseded」，不把旧播放伪装存活 |
| NSSound 实例回收 | delegate didFinishPlaying 回收；无 delegate 环境兜底定时探测 |

## 拒绝路径

| 路径 | 拒绝原因 |
|------|----------|
| 播放完成/进度事件（EventPort producer） | 需求未证实；v1 fire-and-forget 已覆盖 beep/系统音场景 |
| win32 压缩格式支持（Media Foundation） | 重依赖，违反「优先保持轻量」；WAV-only typed 拒绝是诚实边界 |
| 通用混音/多实例引擎、音量/循环控制 | 超出轻量系统能力原子范围；那是播放器/媒体包的领地 |
| beep 留在 ext-dialog | Owner 已裁决声音是独立能力词（2026-09-17） |
| 平台特供 playSound | 双平台均低成本，不满足「仅部分平台低成本」分支条件 |

## 实施计划（specs/tasks 追溯）

1. 批次 A：`@opentray/spec` 声音类型（BeepKind、SystemSoundName、SoundBackendCapabilities、typed 错误码）——embedded artifact kind 与 pack-size 审计**不重复建设**（add-ext-dialog 批次 A 交付，本 change 排在其后）。
2. 批次 B：crates/opentray-ext-sound——darwin（NSBeep/NSSound 目录与文件播放/实例回收）+ win32（MessageBeep/PlaySound SND_ALIAS 与 SND_FILENAME/session 停止）。
3. 批次 C：packages/ext-sound facade（attachSound、解析顺序校验、WAV 前置校验、contract.json、embedded 描述符）。
4. 批次 D：staging 到 `platforms/<target>/` + pack-size 配置。
5. 批次 E：双平台真机验证（可闻性不作为门，命令层语义验证为主）+ skills 公共文档 + changeset（minor）。
