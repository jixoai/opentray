# d19-extension-event-port — Self-Review（评审之思）

> 评审人：编排者。对象：合并线 HEAD（批次 A/B/C + win 迁移全合入）。
> 方法：对照 design-reference.md（B'' 规范附录）、spec delta、tasks.md；所有子代理报告均经亲复跑抽验。

## 总判定

**达成 Phase 1+2 全部验收标准，进入发布流程。** 双平台证据：

| 验收标准（spec delta） | mac | win |
|---|---|---|
| 空闲原生回调无命令直达 facade | ✓（drained=12 与 tap 精确吻合） | ✓ 无头（direct_sources=1；桌面交互级因 SSH 无 GUI 会话由单测覆盖+Owner 桌面确认） |
| 16ms 轮询退役（drain=0） | ✓（对照 121 次→0，timeline 取证） | ✓（drainWindowEvents=0，3s 空闲命令=0） |
| 伪造身份不可表达 | ✓ hub 确定性套件 | ✓ 同（共享套件） |
| 会话关竞态/代际隔离 | ✓ 无 sleep 确定性交错 | ✓ 同 |
| 兼容矩阵（E0 legacy 共存） | ✓ fixture + ext-badge 5/5 | ✓ 真机 |

## 与 design-reference 的偏差（全部有记录）

1. FFI enum 判别值改裸 u32 + from_u32 校验（UB 防护，批次 A 摩擦 1）。
2. Latest 背压不重试（旧快照不得覆盖新 pending；resync 是修复路径——批次 B 设计内决策）。
3. focus/blur live 证据两平台均 SKIPPED（mac：GUI 会话锁定；win：SSH 无桌面）——生产者等价性由门控单测覆盖（双平台各 3-4 用例），**发布后 Owner 桌面确认项**。
4. Windows moved/resized 两条 drain 独有记录随队列退役（不在冻结家族；geometry 由 per-view geometryChange 承担）。
5. 分隔符/绝对路径 fixture 双例修复（批次 A/B 先在测试 bug，真机复验抓出）。

## 新发现并已修

- 只写队列发版阻塞（批次 C 移交注记②）→ win 批次彻底退役写端（f5447a7e）。
- Windows 端口死码告警 5→2（迁移后消除；余 2 为先在）。

## 遗留（不阻塞发布）

- Owner 桌面：win 空闲推送交互确认 + mac/win focus-blur live 证据。
- 未来：UnloadExt 落地时的 lease 协议（B'' v2 预留）。

## Git 证据

工作树 clean；批次 A 8 commits / B-mac 2 / B-win 1 / C-mac 2 / C-win 2 / 修复合并 4；测试 mac（bin 62/core 33/spec 48/ext-webview 157 + TS 71/124/123）win（ext-webview 171/bin 60）全绿。
