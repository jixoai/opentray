> Orthogonal intents (maintained 2026-09-28 Asia/Shanghai): win32 titlebar
> overlay must light up on machines whose only Windows App Runtime is the
> OS-provisioned (CBS) install, without requiring the WinAppSDK bootstrap
> DLL or a system runtime installer.
>
> Original request (2026-09-28 Asia/Shanghai, skill-creator 联调轮): Owner
> 实机（Win11 26200）只有 CBS 预置运行时（1.6 / 2.2 家族，
> SystemApps 下有 FrameworkUdk.dll 但 CBS 发行不含 Bootstrap.dll），
> `windowControlsOverlay` 的 show 全链 126 失败（`Microsoft.WindowsAppRuntime.
> Bootstrap.dll could not be loaded`），窗口被降级。

## Why

`ensure_windows_app_runtime_available` (crates/opentray-ext-webview/src/
windows/appwindow.rs) only reaches the AppWindow titlebar overlay through
`MddBootstrapInitialize` exported by `Microsoft.WindowsAppRuntime.Bootstrap.dll`
(distributed with the WinAppSDK redist / SDK, never with CBS). Machines whose
runtime is OS-provisioned therefore fail `window-show` even though the runtime
itself (FrameworkUdk, WinRT classes) is fully present on disk.

Probe evidence on the Owner machine (temporary integration test, since
deleted):

- `FrameworkUdk.dll` loads from each CBS dir and `Windowing_GetWindowIdFromWindow`
  works;
- `RoGetActivationFactory("Microsoft.UI.Windowing.AppWindow")` fails with
  REGDB_E_CLASSNOTREGISTERED while the package graph is empty;
- `TryCreatePackageDependency(user=null, family=<CBS dir name>, minVersion=0,
  arch=None)` + `AddPackageDependency(rank=0)` **succeeds** for the
  `Microsoft.WindowsAppRuntime.CBS.2_…` family, after which the same
  activation succeeds.

So the OS-public Package Dependency APIs are a complete substitute for the
missing bootstrap on CBS machines: `MddBootstrapInitialize` is itself a
wrapper over that pair, and the overlay path needs nothing else from the
bootstrapper.

Probe rulings worth freezing:

- arch must be `PackageDependencyProcessorArchitectures_None` (0);
  `Neutral` (1) fails resolution with 0x80670016 on this machine.
- minVersion `0.0.0.0` is accepted and matches any installed build.
- The 1.6 family dir passes the name filter but `AddPackageDependency` fails
  (0x80070002 — incomplete provisioning), so the fallback must iterate
  families until one resolves.

## What Changes

- `ensure_windows_app_runtime_available` gains a final fallback tier after
  all bootstrap candidates fail: for each CBS dir (existing
  `windows_app_runtime_cbs_dirs` enumeration, which requires
  `Microsoft.WindowsAppRuntime.Bootstrap.dll` today — the fallback instead
  filters dirs that contain `Microsoft.Internal.FrameworkUdk.dll`),
  `TryCreatePackageDependency` + `AddPackageDependency` with the frozen
  probe parameters (process lifetime). First success marks the runtime
  available; bootstrap-path behavior on machines that have the DLL is
  unchanged.
- `load_windows_app_runtime_library` keeps its candidate chain; after a
  successful package-graph fallback the bare-name LoadLibrary resolves
  FrameworkUdk through the graph, and the CBS dir itself is appended as an
  absolute-path last resort (LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR) so a
  partially-provisioned graph still yields a loadable UDK.
- Failure stays the existing typed `Unsupported` error when neither tier
  works — no capability is faked.
- windows crate features for opentray-ext-webview gain
  `Win32_Storage_Packaging_Appx` + `Win32_Security` (Package Dependency
  bindings).

## Capabilities

### Modified Capabilities

- `@opentray/ext-webview` win32 runtime: `windowControlsOverlay` becomes
  usable on OS-provisioned (CBS) Windows App Runtime machines without the
  bootstrap DLL or a system install.
