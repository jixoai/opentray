# Tasks

- [ ] 1.1 vendor icon.rs：premultiplied area-average 降采样（仅缩小）+ 托盘物理槽位尺寸 + `Icon` 保留 rgba；纯函数单测
- [ ] 1.2 vendor mod.rs：win32 `set_icon_as_template` 落地（着色换 HICON）+ `WM_SETTINGCHANGE` 模板图标重渲染；着色纯函数单测
- [ ] 1.3 opentray-spec：Win32Icon/LinuxIcon 支持 `isTemplate`（可选键，默认 false）+ round-trip 测试
- [ ] 1.4 backend projection：win32/linux icon-only 选择透传 `is_template`
- [ ] 1.5 `cargo test`（vendor + spec + backend）+ release 构建 + cp-bin
- [ ] 1.6 skill-creator：win32 候选传 `isTemplate: true`；junction 联调，Owner 目检托盘（清晰度 + 亮暗纯色 + 主题翻转重渲染）
- [ ] 1.7 两仓提交发布（changeset + 版本 bump + push-to-main CI）
