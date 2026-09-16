# add-ext-sound — Design Reference（规范附录，实现以本档为准）

> 意图索引见 `plan.md`（D1–D5）。共享基建（embedded artifact kind、pack-size 审计）由
> `add-ext-dialog` 批次 A 交付，本档不重复定义，仅引用。

## 0. 定位与边界

能力词 `sound` = **OS 标准声音反馈原子**：系统提示音（beep）、命名系统音（playSystemSound）、
低成本文件播放（playSound）。市场与 dialog 相同：「无页面上下文」的 host 侧调用。
页面自己能放的音（HTMLAudioElement）归页面——本包不做 page 桥。

不做清单：播放完成/进度事件（EventPort）、压缩格式 on win32（Media Foundation）、
混音/多实例引擎、音量与循环控制、Linux 原生实现（typed `sound_platform_unsupported`）。

## 1. 公共 API（facade `@opentray/ext-sound`）

```ts
export const attachSound = (
  tray: TrayHandle,
  options?: SoundExtensionOptions
): SoundCapability => { /* tray.extend 家族，session-scoped，同构 attachBadge/attachDialog */ }

export type BeepKind = 'default' | 'info' | 'warning' | 'error' | 'question';

export interface SoundCapability {
  beep(kind?: BeepKind): Promise<void>;
  playSystemSound(name: SystemSoundName): Promise<void>;
  playSound(path: string, options?: PlaySoundOptions): Promise<void>;
  readonly backend: SoundBackendCapabilities;
}

/** 通用名（typed 联合，自动补全）或平台原生音名（任意字符串，运行时解析）。 */
export type SystemSoundName = CommonSystemSoundName | (string & {});
```

### 1.1 `beep`

| kind | win32 投影 | darwin 投影 |
|---|---|---|
| `'default'` | MessageBeep(MB_OK) | NSBeep() |
| `'info'` | MessageBeep(MB_ICONASTERISK) | NSBeep()（文档化降级） |
| `'warning'` | MessageBeep(MB_ICONEXCLAMATION) | NSBeep()（同上） |
| `'error'` | MessageBeep(MB_ICONHAND) | NSBeep()（同上） |
| `'question'` | MessageBeep(MB_ICONQUESTION) | NSBeep()（同上） |

darwin 无分级 alert 音是**文档化降级**（§4 矩阵），不构成平台特例。

### 1.2 `playSystemSound` 解析顺序（法则）

1. **通用名表**命中 → 当前平台投影音名；
2. 未命中 → 视为**平台原生音名**：darwin = `NSSound(named:)` 系统音目录名（"Basso"、
   "Sosumi"、"Glass"…）；win32 = `PlaySound(SND_ALIAS)` 注册表声音方案名
   （"SystemHand"、"SystemExclamation"、"SystemAsterisk"…）；
3. 仍无法解析 → typed `sound_not_found`（载荷含名字与已尝试的目录），**绝不静默无声**。

通用名表（R1 §4.1 **冻结**，不再开放增删）：

| 通用名 | darwin | win32 |
|---|---|---|
| `'notification'` | Glass | SystemAsterisk |
| `'warning'` | Sosumi | SystemExclamation |
| `'error'` | Basso | SystemHand |

`default/info/question` 只属于 `beep(BeepKind)`，不进本目录——alert 分级与命名系统音是两层
语义，不混。**accepted 判定**（P1-5）：以原生返回值为准（win32 PlaySound 布尔返回；
darwin NSSound 目录命中且 play 受理），非「未报错」；miss 的 typed 错误 details 至少含
requested name、platform、attempted mode/catalog；broker.log 记录解析诊断。

### 1.3 `playSound`（Owner 成本规则的裁决落地）

成本结论：**双平台均低成本**（win32 = winmm `PlaySound`，darwin = AppKit `NSSound`，均无
新增链接依赖）→ 通用 API，不做平台特供。

| 维度 | darwin | win32 |
|---|---|---|
| 格式 | NSSound 全系（wav/aiff/mp3/m4a…） | **仅 WAV——内容校验前置拒绝**（R1 §4.3）：路径展开/canonicalize/readability + 大小上限 + `RIFF`/`WAVE` header 检查（扩展名大小写不敏感但不足以证明格式）；header 不匹配或文件截断 → typed `sound_format_unsupported`；不可读 → typed `sound_file_unreadable`。不得把校验推到 PlaySound 之后解释返回值 |
| 并发 | 多实例自然混音 | PlaySound 进程级单声道：**后播放取消前播放**（文档化降级） |
| 生命周期 | 实例存活至播放完成（delegate didFinishPlaying 回收；兜底定时探测） | SND_ASYNC 即返，无需持有 |

`PlaySoundOptions`：`volume?`（darwin 0–1；win32 不支持 → typed
`sound_capability_unavailable`，绝不静默忽略）……v1 裁决：**不提供任何选项**（拒绝路径已
排除音量控制），`PlaySoundOptions` 预留空对象类型，后续字段走平台命名空间（同 dialog
法则）。路径相对 cwd 解析、`~` 展开、不可读 → typed `sound_file_unreadable`。

### 1.4 播放语义（法则）

- **fire-and-forget**：三个方法都在播放**开始**（原生调用受理成功）时 resolve；完成事件
  不存在（EventPort producer 留待需求证实）。
- 非模态、不阻塞、无 busy 语义；并发调用合法（win32 取消语义见矩阵）。
- **session close = PlaybackToken 所有权门控**（R1 §4.2/P0-4）：native 侧维护
  `PlaybackToken { sessionId, generation, sequence }` 记录当前 win32 播放 owner——每次新
  播放原子替换 token（按 win32 进程级单声道语义取消旧播放，内部状态记「accepted but
  prior owner superseded」，不把旧播放伪装存活）；**session close 仅在 token 仍归该
  session 时执行 `PlaySound(NULL, SND_PURGE)`，token 属其它 session 时 close 不得 purge**。
  darwin 维护 session-owned `NSSound` 实例集合，close 只 stop 自己的集合。token 是内部
  所有权机制，不是 Node-facing API，不改变 fire-and-forget 语义。
- 测试至少覆盖 A/B 会话交错与关闭顺序四格（A播→B播→关A / A播→B播→关B / A播→关A /
  A播→关B）。

## 2. `SoundBackendCapabilities` DTO

```ts
export interface SoundBackendCapabilities {
  platform: 'darwin' | 'win32';
  systemSoundCatalog: boolean;        // 平台原生音名目录可解析
  playFile: boolean;                  // playSound 可用
  fileFormats: readonly string[];     // darwin: ['wav','aiff','mp3','m4a']; win32: ['wav']
}
```

编译门法则（R1 P1-3 同 dialog 修正）：DTO schema 提升到共享 `@opentray/spec` 与
opentray-spec crate 公共 schema，配 exhaustive serialization fixture；CI 明确执行 darwin 与
windows 两个 target 的 compile/type/test，单一 target 编译通过不构成门。facade 以
`sound.backend` 暴露只读快照。

## 3. 打包（引用 add-ext-dialog §6，不重复）

- `packages/ext-sound/platforms/{darwin-arm64,darwin-x64}/libopentray_ext_sound.dylib` +
  `{win32-arm64,win32-x64}/opentray_ext_sound.dll`；`kind: "embedded"` artifact；
  `contract.json` = `{ "extensionName": "sound", "contractFingerprint": "opentray-ext-sound-contract-1" }`；
  pack-size 审计同一脚本同一阈值（2MB warn / 3MB fail）。
- crate：`crates/opentray-ext-sound`（唯一原生源）。
- typed 错误码：`sound_platform_unsupported` / `sound_not_found` /
  `sound_format_unsupported` / `sound_file_unreadable`。

## 4. 线程与依赖

- 声音命令在 GUI 主线程派发（winit 串行化）；全部原生调用**非阻塞**（SND_ASYNC /
  NSSound.play 即返）——无 dialog 的模态集成问题。
- darwin 依赖 Darwin carrier/AppKit（ext-badge 同族）；win32 链接 winmm（PlaySound /
  MessageBeep），无 WinRT、无 comctl 依赖。
- 无 TCC 权限需求。

## 5. 测试策略

- **TS 确定性**（vitest）：beep kind 表投影、playSystemSound 解析顺序（通用名命中/
  原生名透传/miss typed 错误含 details payload）、**win32 WAV 内容校验**（RIFF/WAVE
  header 匹配、伪装 MP3、截断 WAV、大小超限、不可读、大小写扩展名）、路径 canonicalize、
  Linux typed unsupported、embedded 描述符解析（复用 dialog 批次 A 测试基建）。
- **原生验收（双平台真机）**：命令受理与错误分支语义验证（原生返回值/broker.log 取证，
  可闻性不作为门）；通用名×3 + 双平台各一原生名 + 一个必然 miss 名；**A/B 会话交错与关闭
  顺序四格**（P0-4：关闭不持有 token 的 session 不得 purge 别人的播放）；backend DTO 上报。
- **双 target CI 编译门** + exhaustive fixture（P1-3）。
- **体积证据**：`npm pack --dry-run` 实测报告（同 dialog §6.3 证据要求）。
