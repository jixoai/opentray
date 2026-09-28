# Tasks

- [x] 1.1 appwindow.rs：`ensure_windows_app_runtime_available` 追加 Package Dependency 直挂回退（探针冻结参数：minVersion 0 / arch None / Process lifetime；逐 CBS 家族直至成功）
- [x] 1.2 `load_windows_app_runtime_library`：候选链追加 CBS 目录绝对路径（LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR）兜底
- [x] 1.3 Cargo.toml：windows 依赖 features 增 `Win32_Storage_Packaging_Appx` + `Win32_Security`
- [x] 1.4 `cargo test -p opentray-ext-webview`（197 全绿）+ release 构建（DLL 3,170,816 B vs 0.32.0 发行 3,163,136 B）
- [x] 1.5 联调（Owner 实机）：`example:webview-control` overlay 点亮、无 126、Owner 目检通过（2026-09-28）
