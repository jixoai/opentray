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

通用名表 v1 提案（开放问题，Codex 可增删）：

| 通用名 | darwin | win32 |
|---|---|---|
| `'notification'` | Glass | SystemAsterisk |
| `'warning'` | Sosumi | SystemExclamation |
| `'error'` | Basso | SystemHand |

### 1.3 `playSound`（Owner 成本规则的裁决落地）

成本结论：**双平台均低成本**（win32 = winmm `PlaySound`，darwin = AppKit `NSSound`，均无
新增链接依赖）→ 通用 API，不做平台特供。

| 维度 | darwin | win32 |
|---|---|---|
| 格式 | NSSound 全系（wav/aiff/mp3/m4a…） | **仅 WAV**——非 `.wav` typed `sound_format_unsupported` 前置拒绝 |
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
- **session close**：扩展 cleanup 停止该 session 启动的播放（darwin `NSSound.stop()` +
  实例释放；win32 `PlaySound(NULL, 0, SND_PURGE)`）。

## 2. `SoundBackendCapabilities` DTO

```ts
export interface SoundBackendCapabilities {
  platform: 'darwin' | 'win32';
  systemSoundCatalog: boolean;        // 平台原生音名目录可解析
  playFile: boolean;                  // playSound 可用
  fileFormats: readonly string[];     // darwin: ['wav','aiff','mp3','m4a']; win32: ['wav']
}
```

编译门法则同 dialog：新增能力字段必须被每个平台 DTO 与原生构造器序列化（darwin target
编译过 = win32 序列化齐全）。facade 以 `sound.backend` 暴露只读快照。

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
  原生名透传/miss typed 错误）、win32 非 WAV 前置拒绝、路径解析与 `sound_file_unreadable`、
  Linux typed unsupported、embedded 描述符解析（复用 dialog 批次 A 的测试基建）。
- **原生验收（双平台真机）**：命令受理与错误分支语义验证（可闻性不作为验收门——无人工
  听觉断言，以原生返回值/broker.log 取证）；session close 停止；backend DTO 上报；
  playSystemSound 三通用名 + 双平台各一个原生名 + 一个必然 miss 的名字。
- **体积证据**：`npm pack --dry-run` 归档（预期 << 2MB）。
