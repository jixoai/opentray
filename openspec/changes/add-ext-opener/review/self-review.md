# add-ext-opener — Self-Review（实现阶段 + 复核轮收口）

> 评审人：编排者。对象：实现（facade + shared schema + 原生 crate + 打包）+ Codex 复核轮。
> 性质：**实现自评 + 复核轮记录**——7.3 的 Codex GO 以 I4 综合裁决为准，本档不代勾。

## 总判定

实现落地：`@opentray/spec` 冻结 schema（`OpenerBackendCapabilities` DTO、
`OPENER_ALLOWED_SCHEMES = http/https/file/mailto`、四码错误族）、facade
`packages/ext-opener/src/{index,shared}.ts`（纯分类矩阵 + transport 组合）、
原生 crate `crates/opentray-ext-opener`（darwin NSWorkspace / win32 ShellExecuteW +
explorer /select 构造层）、embedded 打包（四目标 + contract.json）。
Codex 实现复核 I2 P1 + I2b 追击均已修复并双平台复验。

## 冻结契约自查（对照 design-reference）

- 目标矩阵：绝对路径（POSIX/drive/UNC/`\\?\` 字面）verbatim 派发、不规范化；
  `C:x` drive-relative typed 拒（reason:"drive-relative"）；相对路径拒
  （reason:"relative"）；**URL 检测为 WHATWG parser 驱动（I2/I2b 修订）**——
  native 与 facade 的 `new URL()` 逐行同构（含 C0/space 边距剥离、tab/newline
  任意位置剥除、非特殊 scheme 不透明路径），scheme 为规范小写解析值过白名单，
  白名单外 → `opener_scheme_blocked` `{scheme}`；`file:` URL 永不转路径；
  存在性不是受理前提。facade 与原生双侧同构（防御纵深，细节形状一致）。
- revealInFolder：拒绝集合（引号 → "path-quote"；NUL/C0 → "path-control-char"、
  拒绝不转义）；仅当裁后仍合法才裁一个尾随分隔符；根路径
  （`/`、`C:\`、UNC 根、`\\?\` 根）不裁剪、语义为打开根；POSIX 只裁 `/`，
  win32 裁 `\` 或 `/`。
- win32 受理 = `ShellExecuteW > 32`；≤32 → `opener_failed`
  `{shellExecuteResult, reason?}`（SE_ERR 表映射小写 reason）；darwin 布尔受理
  → `{osError:true}`；`activateFileViewerSelectingURLs` void 即受理。
- Linux typed 拒、零 broker 帧；v1 预留空 options 对象，未知字段 TypeError；
  空/非字符串目标 TypeError。

## 复核轮记录（I2 P1 + I2b）

| 轮 | 发现 | 闭环 |
|---|---|---|
| I2 P1（NO-GO） | native scheme 门仅词法扫描：`http:`、`http://`、`http://[invalid` 被 native 放行进 ShellExecuteW 而 facade `new URL()` 拒绝（同构断裂） | 90398aaf：url crate（WHATWG URL Standard，与 Node 同规范）完整解析门 + 双侧畸形语料（拒 http:/http:///[invalid/空格 host；放行 bare mailto:/file:/file:x——语料逐行经 Node new URL() 实证） |
| I2b（NOT-CLOSED 追击） | 分类层仍有词法残留：内嵌 tab/newline（WHATWG 任意位置剥除；Node 实证 `"ht\ntps://x"` → https:）被 native 误判 relative | f5ede85b：classify_target URL 分支 parser 驱动单源化（路径/盘符/UNC 优先序保持），scan_scheme/margin-trim 删除；双侧语料补 tab/newline 与 C0 边距行（`ht\ntps://`、`https://exa\nmple.com`、`\u0000` 前缀放行；`ab\n:x` → blocked("ab")） |

## 真机验收证据（6.1）

darwin 本机（opener_probe）：open(https) 默认浏览器受理、open(绝对文件) 默认应用
受理、reveal Finder 定位（真实桌面动作）、三个 typed 拒绝载荷精确（relative/
scheme ftp/path-quote）。Windows 真机：cargo 28/28（I2b 后，0 警告）；GUI 弹出
在 ssh session 0 不可见，列 Owner 真机清单（诚实声明）。

## 已知边界（诚实声明）

1. Windows GUI 可见动作（浏览器/资源管理器）待 Owner 桌面确认。
2. 6.2 全量门 CI run 链接于 PR 后回填；7.3 GO 以 I4 综合裁决为准。

## Git 证据

- 实现波：be5b3d6e（crate+facade）+ b8a9b321/723c03c6（打包注册）+ bdfd2c07（spec）。
- 复核修复：90398aaf（I2 P1）+ f5ede85b（I2b）+ opener_probe 真机探针（124b38df）。
