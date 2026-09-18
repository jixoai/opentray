# add-ext-clipboard — Self-Review（实现阶段）

> 评审人：编排者。对象：实现（facade + shared schema + 原生 crate + 打包）。
> 性质：**实现自评**——Codex 实现复核待进行（pending），本档不代勾。

## 总判定

实现落地：`@opentray/spec` 冻结 schema（`ClipboardBackendCapabilities` DTO、
`CLIPBOARD_MAX_WRITE_UTF16 = 1_048_576`、五码错误族）、facade
`packages/ext-clipboard/src/index.ts`（preflight 门、immediate 派发、
`getBackend()` 冻结快照）、原生 crate `crates/opentray-ext-clipboard`
（win32 HGLOBAL 所有权 + 2000ms/退避梯重试纪律；darwin NSPasteboard owner 线程）、
embedded 打包（四目标 + contract.json）。

## 冻结契约自查（对照 design-reference）

- 计量单位 = UTF-16 码元（`String.length`）；1 MiB 上限、lone-surrogate typed 拒
  （`{reason:"lone-surrogate", index}`）——facade 与原生双侧实现，绝不替换写入。
- `readText` null 空态（非错误非空串）；`writeText('')` 合法；非字符串 → TypeError。
- win32 重试：仅 `ERROR_ACCESS_DENIED`、单调 2000ms 总预算、10→20→40→80→160→200ms
  梯、睡眠裁剪至剩余预算、耗尽 → `clipboard_locked` `{attempts, elapsedMs}`；
  其他错误即拒 `clipboard_unavailable` `{osErrorCode}`。
- HGLOBAL 所有权律：交接成功不 free（系统接管）；失败路径全部回收后才 typed 报错；
  读侧 GlobalLock 深拷贝、Close 后不触碰。
- Linux typed 拒、零 broker 帧；未知 attach 选项字段 TypeError。

## 已知边界（诚实声明）

1. Codex 实现复核 **pending**——本档为编排者实现自评，无第三方对抗轮。
2. 双平台真机往返验收（`pbpaste`/PowerShell 交叉取证、并发锁竞态真机压测）未收口。
3. tasks.md 尚未勾选（编排者收口时统一处理）。

## Git 证据

- 本档（docs 波）之前：实现 commits 见 `git log --oneline -- packages/ext-clipboard crates/opentray-ext-clipboard packages/spec`。
- verify:spec-consistency / vision-driven test：docs 波后重跑（见 change 收口记录）。
