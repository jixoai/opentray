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
  getBackend(): Promise<SoundBackendCapabilities>;
}

/** 通用名（typed 联合，自动补全）或平台原生音名（任意字符串，运行时解析）。 */
export type SystemSoundName = CommonSystemSoundName | (string & {});
```

`getBackend()` 为**异步**（R2 P0-7 裁决，同 dialog）：扩展惰性加载，attach 同步期不可能给出
真实的运行时 DTO；方法 dispatch 前 await 同一快照做能力前置。不存在同步 `backend` 属性。

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
   "Sosumi"、"Glass"…）；win32 = `PlaySound(SND_ALIAS | SND_ASYNC | SND_NODEFAULT)`
   注册表声音方案名（"SystemHand"、"SystemExclamation"、"SystemAsterisk"…）——**flags
   三件套冻结**（R2 P0-4）：`SND_ASYNC` 防阻塞 owner loop；`SND_NODEFAULT` 防未知 alias
   静默回退默认系统音（缺它则 native true 不再代表「请求的名字被接受」）；
3. 仍无法解析（含 native false 返回）→ typed `sound_not_found`（载荷含名字与已尝试的
   目录），**绝不静默无声、绝不错误回退**。

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
| 格式 | **v1 承诺集（有限 canonical）**：wav/aiff/mp3/m4a 四项（超出者不承诺） | **仅 WAV——精确 RIFF 解析前置拒绝**（R3 P1-1 冻结算术）：路径展开/canonicalize/readability + **最大 64 MiB** + **≥12 字节** + **declared_size + 8 ≤ actual_size**（offset-4 字段计的是 8 字节 RIFF 头之后）+ **fmt 与 data 两个 chunk 都必须存在**（每个 chunk：offset + 8 + size + 奇数补 pad 后必须落在 declared RIFF 区域内；fmt payload ≥16 字节；不做解码）；任何违例 → typed `sound_format_unsupported`；不可读 → typed `sound_file_unreadable`。fixture：仅 12 字节头、u32::MAX declared、declared-8 边界、奇数字节补 pad、仅 fmt、仅 data、chunk 越过 declared 与越过 physical 两分；PlaySound spy 断言拒绝路径零调用 |
| 并发 | 多实例自然混音 | PlaySound 进程级单声道：**后播放取消前播放**（文档化降级，经 PlaybackArbiter 线性化） |
| 生命周期 | 实例存活至播放完成（delegate didFinishPlaying 回收；兜底定时探测） | SND_ASYNC 即返，无需持有 |

`PlaySoundOptions`：`volume?`（darwin 0–1；win32 不支持 → typed
`sound_capability_unavailable`，绝不静默忽略）……v1 裁决：**不提供任何选项**（拒绝路径已
排除音量控制），`PlaySoundOptions` 预留空对象类型，后续字段走平台命名空间（同 dialog
法则）。路径相对 cwd 解析、`~` 展开、不可读 → typed `sound_file_unreadable`。

### 1.4 播放语义（法则）

- **fire-and-forget**：三个方法都在播放**开始**（原生调用受理成功）时 resolve；完成事件
  不存在（EventPort producer 留待需求证实）。
- 非模态、不阻塞、无 busy 语义；并发调用合法（win32 取消语义见矩阵）。
- **session close = PlaybackArbiter 所有权门控**（R2 P0-4 线性化升级）：native 侧维护
  process-wide `PlaybackArbiter`——**同一 mutex/临界区**内依次执行「native `PlaySound`
  调用 → 处理其返回值 → 提交或清除 `(sessionId, instanceGeneration, sequence)` token」，
  token 覆盖**所有 PlaySound 路径（`SND_ALIAS` 与 `SND_FILENAME`，不含 `MessageBeep`）**。
  session close 在同一锁内比较完整 token：匹配才 `PlaySound(NULL, SND_PURGE)` 并清除；
  不匹配不得 purge。不允许仅用 `Atomic*::swap` 包 metadata——「A swap→B swap+play→A
  play」交错会令 token 指向 B、实际播放 A，B close 的 purge 就会错停 A。新播放原子替换
  旧 token 并按 win32 单声道语义取消旧播放，内部状态记「accepted but prior owner
  superseded」，不把旧播放伪装存活。
  darwin 维护 session-owned `NSSound` 实例集合，close 只 stop 自己的集合。token 是内部
  所有权机制，不是 Node-facing API，不改变 fire-and-forget 语义。
- **单会话运行时注记**（R2 P0-3 同步裁决）：现 broker 为 caller-scoped 单 session，并发
  实际面是同 session 多 mount 与跨 app 实例（独立 broker）；token 按 session 语义设计，
  为未来运行时演进预留，不虚构多 session 并发验收场景。
- 测试从四格扩展为：两线程交错（swap/play race）、alias-vs-file token 交替、native false
  返回路径、close race；每个用例以 spy/wrapper 断言**实际 `SND_PURGE` 与播放调用次序**。

## 2. `SoundBackendCapabilities` DTO

```ts
export interface SoundBackendCapabilities {
  platform: 'darwin' | 'win32';
  systemSoundCatalog: boolean;        // 平台原生音名目录可解析
  playFile: boolean;                  // playSound 可用
  fileFormats: readonly string[];     // v1 承诺集：darwin ['wav','aiff','mp3','m4a']; win32 ['wav']（有限 canonical，非运行时开放集）
}
```

法则（R2 P1-1/P1-6 修正）：DTO schema 提升到共享 `@opentray/spec` 与 opentray-spec crate
公共 schema，配 exhaustive serialization fixture；CI 显式执行 darwin 与 windows **两个
target** 的 compile/type/test 并以同一完整 fixture 比对两个平台构造器——单一 target 编译
通过不构成门，不声称交叉编译因果。`fileFormats` 是 **v1 承诺集**（有限 canonical），
不把随 OS/codec 变化的开放集合当「exact accepted formats」。facade 以异步
`getBackend(): Promise<...>` 暴露快照（加载后请求 DTO，返回不可变 snapshot）。

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
- **体积与发布证据**：真实 `npm pack --json --pack-destination`（tgz stat/digest、npm 版本、
  packlist、四目标 hash）+ 解包同一 tgz 逐目标 identity check——与 dialog §6.3/§6.4 共用
  同一脚本与证据格式，receipt 含 tarball 路径与 digest；dry-run 仅开发预警。
