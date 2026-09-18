# add-ext-opener — Self-Review（实现阶段）

> 评审人：编排者。对象：实现（facade + shared schema + 原生 crate + 打包）。
> 性质：**实现自评**——Codex 实现复核待进行（pending），本档不代勾。

## 总判定

实现落地：`@opentray/spec` 冻结 schema（`OpenerBackendCapabilities` DTO、
`OPENER_ALLOWED_SCHEMES = http/https/file/mailto`、四码错误族）、facade
`packages/ext-opener/src/{index,shared}.ts`（纯分类矩阵 + transport 组合）、
原生 crate `crates/opentray-ext-opener`（darwin NSWorkspace / win32 ShellExecuteW +
explorer /select 构造层）、embedded 打包（四目标 + contract.json）。

## 冻结契约自查（对照 design-reference）

- 目标矩阵：绝对路径（POSIX/drive/UNC/`\\?\` 字面）verbatim 派发、不规范化；
  `C:x` drive-relative typed 拒（reason:"drive-relative"）；相对路径拒
  （reason:"relative"）；URL 经 `new URL()` 解析、scheme 大小写不敏感过白名单，
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

## 已知边界（诚实声明）

1. Codex 实现复核 **pending**——本档为编排者实现自评，无第三方对抗轮。
2. 双平台真机受理取证（默认浏览器/默认应用/reveal 人工或截图取证）未收口。
3. tasks.md 尚未勾选（编排者收口时统一处理）。

## Git 证据

- 本档（docs 波）之前：实现 commits 见 `git log --oneline -- packages/ext-opener crates/opentray-ext-opener packages/spec`。
- verify:spec-consistency / vision-driven test：docs 波后重跑（见 change 收口记录）。
