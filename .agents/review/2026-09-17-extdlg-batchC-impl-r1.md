# Batch C TS Facade Implementation Review R1

范围：`packages/` facade 集成（C-facade commits 2348d6e6/98d343cd/20cea78d）及修复提交 `3449868b`。

## P0/P1 台账

- **原 P1（空 filters 语义违约）：已闭合。** 原
  `packages/ext-dialog/src/shared.ts:487` 将显式 `filters: []` 判为无效，违背
  design-reference §1.2 / living spec 的“空/缺省 = 全部文件”。`3449868b` 让空数组
  在 `:493` 通过，并在 `filePickCommandOptions` `:955` 与
  `savePickCommandOptions` `:990` 归一化为省略 wire 字段；这也避开 Darwin
  `setAllowedContentTypes([])` 的“不可选任何文件”语义，Win32 空列表则不会调用
  `SetFileTypes`。
- 修复测试 `packages/ext-dialog/src/index.test.ts:479` 同时覆盖 `pickFile` 与
  `pickSavePath`，断言成功结果和 `options` 中没有 `filters`；既有
  `defaultFilterIndex` 对缺省 filters 的前置拒绝仍在 `:471` 覆盖；源码的
  `index >= 0` 分支也会拒绝显式空数组，但新增回归没有直接传
  `{ filters: [], defaultFilterIndex: 0 }`（P2 覆盖增强项）。未发现新的 P0/P1。

## 测试质量抽查

- facade 的 show 终帧严格解包、错误映射、命名空间/按钮/索引 preflight、重载及路径
  canonicalize 仍由既有测试覆盖；Accepted/terminal 的真实 pending 时序由 CLI transport
  层负责，facade mock 直接提供已结算的 terminal 不构成语义替代。
- 空 filters 的两种 picker wire 断言是确定性的；建议后续补一条“显式空 filters +
  defaultFilterIndex 仍 typed 拒绝”的测试，封住归一化与索引校验的组合边界。
- 本机独立执行 `pnpm --filter ./packages/ext-dialog exec vitest run`：**22/22 通过**。
  提交说明中的 Bun 22/22 为补充双运行时证据；本轮未重复启动 Bun。测试无 sleep 或
  非确定性竞态依赖。

## 发布链与评分

- **代码批次 C：GO。** 原 P1 已由实现、wire 断言和 Node 22/22 复验闭环；与批次 B
  `9.0/10` 相比，本批次评分 **9.1/10**。扣分来自本轮未独立重跑 Bun/跨平台 GUI
  以及上述组合边界测试缺口，不影响 facade 代码闭合。
- **发布链：NO-GO（后续交付项未闭合）。** `AGENTS.md:549` 的 Dialog/Sound law
  仍标为 provisional；`openspec/changes/add-ext-dialog/tasks.md:73-76` 的法则定稿、
  公共 `skills/opentray` 文档、minor changeset、合并 main/version/push/CI/npm 发布
  仍未完成。完成这些及批次 E/全量门后再进入发布 GO。
