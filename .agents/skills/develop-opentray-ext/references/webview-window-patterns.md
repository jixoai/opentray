# WebView Window Patterns

Use this reference when extending or documenting `@opentray/ext-webview` window behavior. Prefer effect-driven scenario cards over abstract API inventories: OpenTray capabilities are orthogonal, so future agents should learn how to compose atoms for a visible product effect and then ask the user which effect they want.

## Reading Map

Use this chapter map instead of reading linearly when the user starts from an effect:

- If the question is "who owns the chrome?", jump between [Native Framed Window](#scenario-card-native-framed-window), [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls), and [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell).
- If the question is "how does the tray click open it?", pair [Tray-Launched WebView Surface](#scenario-card-tray-launched-webview-surface) and [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) with [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md).
- If the question is "how should translucent content be styled?", start in [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) and reuse the `hudWindow` content law in [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell), [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget), and [Island-Like Live Stream](#scenario-card-island-like-live-stream).
- If the question is "how should the whole window fade?", keep `style.opacity` separate from the background material path in [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) before composing it with glass or panel scenarios.
- If the question is "how does screen awareness change the layout?", read [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget), then [Island-Like Live Stream](#scenario-card-island-like-live-stream), then come back to [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) for tray-constrained placement.

## Platform Law

The WebView extension owns window protocol, native projection, page injection, and event payloads. `opentray`, `opentray-core`, and `crates/opentray-bin` stay generic and must not parse WebView window commands.

Events are subscription-driven. Do not add polling loops or unconditional page pushes for window state. If a native observer becomes necessary, install it only when a relevant listener exists and tear it down when the last listener is removed.

Retained WebView tray surfaces use one `primaryEvent` item whose label states the next action: `Show Example` while `isVisible()` is false and `Hide Example` while true. Bootstrap only once with `show()`, reveal a retained hidden/minimized session with `toVisible()`, hide it with `close()`, and update the menu from `visibleChange`. Do not keep a parallel local visibility boolean.

Native APIs exposed to a page are a security boundary. Keep the CSP-like `nativeApiPolicy` model: grant each capability family explicitly, keep local-only defaults for remote content, and avoid hidden broad grants.

## Maturity Truth

Teach four truths explicitly when helping a user design against `@opentray/ext-webview`:

- `stable`: the current human-visible acceptance path
- `alpha`: published contract/package path that is still prerelease for visible runtime behavior
- `unsupported by design`: the request does not truthfully map to the current substrate or capability family
- `unavailable by context`: the capability exists, but the current session has no authoritative data

Current repo truth for window patterns:

- macOS patterns in this file are the current `stable` visible reference path
- Windows patterns in this file are the current `stable` WebView2 visible reference path for common lifecycle, bridge, window-control behavior, background material/corner preferences, and native icon projection
- Linux is unsupported for `@opentray/ext-webview`; do not publish or depend on `@opentray/ext-webview-linux-*` packages until a visible native runtime is real
- do not explain missing platform-specific runtime behavior as "almost stable"; call it alpha, typed unsupported, or unavailable by context
- do not call tray-bounds `kind: "unavailable"` a platform unsupported error

## Authority Map

Keep the ownership split explicit when describing or extending the API:

- `TrayHandle.getBounds()` is the trusted backend authority for tray geometry. It is broker-routed and tray-owned.
- `TrayHandle.onMenuClick()` / `listen(...)` are the trusted SDK-level event helpers for tray-scoped events. Use raw `connection.onEvent(...)` only when testing broker frames or building a custom transport.
- `navigator.opentray.tray.getBounds()` is the page projection of that same tray capability. Treat it as injected page context, not as a second system authority.
- `attachWebview(tray)` is the trusted host-side extension facade for `show`, `hide`, `navigate`, `evaluate`, and `postMessage`.
- `navigator.opentrayWindow` and `navigator.opentrayScreen` are extension-owned page APIs. They are not generic `opentray-core` contracts today.
- `WebviewPlacementKit`, `styleKit`, and `mediaQueryKit` are backend TypeScript composition helpers. Do not expose those kits as page APIs. If page UI needs to trigger backend placement, sizing, or style behavior, send a small intent through `navigator.opentray.ipc.postMessage(...)` and let backend code drain and handle it.
- Host-side screen authority belongs to the WebView extension capability (`webviewTray.getScreenDetails()`), not to `WebviewWindowHandle` or `navigator.opentrayWindow`. Page-side screen projection stays `navigator.opentrayScreen.getScreenDetails()`.
- The facade package should export browser-global typings that match the injected page surface (`navigator.window`, `navigator.opentrayWindow`, `navigator.opentrayScreen`, `navigator.opentray`, and `window.getScreenDetails()`). Do not document runtime properties that the public TypeScript surface cannot express.
- If we later add a host-side `webview.window` controller, keep it inside the ext package boundary. Do not move WebView window verbs into `opentray-core`.
- `screen` stays in `@opentray/ext-webview` until a second non-WebView consumer proves a shared backend law for topology snapshots, coordinate space, permission gating, and listener-driven events.

## How To Reason

Start with the visible interaction, not the Rust or TypeScript field:

- Does the user want the operating system to own the titlebar, only the controls, or none of the chrome?
- Should the surface feel like a normal window, a translucent utility panel, a desktop widget, or a tray-launched custom menu?
- Should tray icon click open a native menu, direct-trigger a primary item, or open a WebView-owned menu surface?
- Is the content local and trusted, or remote and capability-scoped?
- Does the window need screen-aware placement, or only a fixed default size?
- Does the user need live monitor topology events? If yes, call out that this is the next platform-law modeling point, not a simple boolean.

## Platform Capability Matrix Radar

The current macOS window work is still a regular extension atom because one runtime owns one platform substrate: AppKit `NSWindow` + Wry `WKWebView` + `window-vibrancy`. Keep future platform rows explicit instead of flattening them into vague `blur` or `corner` booleans.

The next real platform-law shift should happen when Windows/Linux material, corner, and screen-event behavior must be modeled together:

| Capability family | macOS current substrate | Windows likely substrate | Linux likely substrate | Modeling rule |
| --- | --- | --- | --- | --- |
| Material/background | `NSVisualEffectView` via `window-vibrancy`; future macOS liquid-glass naming may diverge. | DWM/Mica/Acrylic/Tabbed/host-backdrop families vary by Windows version. | GTK/libadwaita/compositor-specific transparency and blur vary by desktop. | Keep common shell state small; model native backing and material as one `style.background` atom, with semantic tokens only when the runtime can truthfully project them. |
| Whole-window opacity | `NSWindow.setAlphaValue(...)`. | `WS_EX_LAYERED` plus `SetLayeredWindowAttributes` for shell alpha. | Compositor/window-manager-specific and currently unsupported. | Keep `style.opacity` as common shell alpha only; do not fold it into `style.background`, material state, or page CSS opacity. |
| Corners | Layer-backed theme-frame clipping can project numeric radius; system shell corners remain platform-owned when unset. | Windows 11 exposes rounded-corner preferences, while older versions differ or lack system corners. | Window manager/compositor decides; app-side clipping may not equal native shell corners. | Keep numeric radius or enum corner preference inside the platform family that can truthfully project it. |
| Screen details/events | `NSScreen` and `NSWindow.screen()` provide current snapshots; event observers should be listener-driven. | Win32 display topology and DPI events have their own coordinate and scale rules. | X11/Wayland/GTK monitor events and permissions vary by stack. | Keep `getScreenDetails()` standard-like, but model event source, coordinate space, and permission/capability per substrate before broadening. |

Do not pre-build `navigator.opentrayWindow.macos26|win11|gtk.*` namespaces only from speculation. First expose stable common capability state. Introduce substrate namespaces only when a concrete backend has behavior that cannot be truthfully represented by the common contract plus capability metadata.

When a user asks for a cross-platform effect right now, ask which truth they want:

- "stable now on macOS and Windows"
- "unsupported by design on Linux"
- "future substrate plan only"

That keeps the conversation aligned with what the current runtime can actually prove.

## Scenario Card: Native Framed Window

Effect: a normal desktop window with OS titlebar, border, resizing, title, and optional icon.

Atoms composed: tray-owned extension command, WebView show command, native title/icon projection, optional local page bridge.

Why this design: the platform already has the correct affordances for a plain utility window. Keeping `frameless` off avoids forcing page code to reimplement close, drag, resize, accessibility, or platform conventions.

Benefit: the user gets the most predictable behavior, and the app can still opt into title/icon sync or native APIs later without changing the tray or broker law.

Ask the user: "Should this behave like a normal app window with OS chrome, or do you need custom titlebar/body chrome?"

Minimal shape:

```ts
await webview.show({
  type: "show",
  html,
  width: 420,
  height: 260,
  title: "Status",
  icon: { type: "href", href: "/favicon.ico" },
  nativeWindowApi: true,
  titleSync: { documentToWindow: true, windowToDocument: true },
});
```

## Scenario Card: Overlay Titlebar With Native Controls

Effect: a custom titlebar/content row is drawn by the page, but native window controls remain visible and own close/minimize/fullscreen behavior.

Atoms composed: `windowControlsOverlay`, `overlay.getTitlebarAreaRect()`, `overlay.geometrychange`, transparent/material style, `startAppRegionDrag()`.

Why this design: overlay keeps the control cluster native while giving the page layout ownership over the title/content area. The page reads geometry instead of guessing traffic-light/button positions, and drag uses native tracking instead of repeated `moveTo(...)` calls.

Benefit: product teams can build branded titlebars without losing platform controls or creating laggy drag behavior.

Ask the user: "Do you want native controls to remain visible, with only the titlebar content customized?"

Implementation note: native material is not the same thing as CSS blur. To get a real glass surface, the extension must set one mutually exclusive `style.background` mode (`transparent`, `semantic: blur`, or `platformMaterial`) and the page must leave at least some regions transparent. If the HTML paints a fully opaque layer over the whole window, the native material is technically active but visually hidden.

Background law: `style.background` is the single source of truth for native backing and native material. Do not model transparent, macOS material, and Windows backdrop as independent mutable axes. The valid modes are `opaque`, `transparent`, `platformMaterial`, and semantic tokens such as `blur`. Platform fields remain for orthogonal style families such as corner preference/radius.

Opacity law: `style.opacity` is the single source of truth for whole native-window shell alpha. It is not a background kind, not material intensity, and not page CSS opacity. `opacity: 0.72` must leave an opaque background opaque unless the caller separately requests `background: "transparent"`, semantic `blur`, or a platform material.

Projection law: `transparent` clears backing with no material; `platformMaterial` clears backing and applies a substrate material; semantic `blur` resolves to Windows Acrylic and macOS `hudWindow`. Material state belongs inside the same background atom as `background.state`. On macOS this maps to `NSVisualEffectState`. On Windows the current DWM path maps `followsWindowActiveState`, `active`, and `inactive` by rewriting the non-client activation state before DWM samples the backdrop; this is the intentional Win32 substrate for now, not a separate platform flag.

Windows default-window law: ordinary WebView windows start with `background: opaque`. Do not default Windows to transparent just because transparent-first composition has special DWM requirements; tray panels, glass shells, and diagnostic transparent probes must request `background: "transparent"` or a material mode explicitly.

Windows transparent first-show law: create plain transparent WebView2 host HWNDs with `WS_EX_NOREDIRECTIONBITMAP` before first `ShowWindow`. Without it, DWM can expose an opaque white initial redirection bitmap that does not track normal WebView or DOM repaint behavior. DWM backdrop materials such as Mica/Acrylic/Tabbed need the redirection surface, so remove this ex-style for material backgrounds and add it back only for plain transparent windows. For Windows material backgrounds, reuse `window-vibrancy`'s Mica/Acrylic/Tabbed projection, keep the WebView backing clear, and give the top-level HWND a continuously painted black client base. Do not use `WS_EX_LAYERED`, WebView child opacity hacks, or a separate tao test window as a substitute for this host contract. The separate `style.opacity` atom is the exception: whole-window alpha intentionally uses `WS_EX_LAYERED` plus `SetLayeredWindowAttributes`, and it may disable `WS_EX_NOREDIRECTIONBITMAP` while opacity is below `1` because layered alpha needs a redirection-compatible compositor path.

Windows background reset law: treat `style.background` as a host-surface family selector, not a paint-only toggle. The real families are plain opaque/transparent with `WS_EX_NOREDIRECTIONBITMAP` plus a Softbuffer fill, and material/semantic blur with the DWM redirection surface plus a black native client painter. Runtime changes are transactional and in-place: publish the next paint policy, suppress synchronous child commits, clear prior backdrop families, apply the target Win32/DWM/AppWindow style, commit the full parent client surface, then update WebView backing and bounds. Do not rebuild the HWND/WebView pair for background changes; rebuilding while WebView2 is attached reintroduces the `tauri#10318` / `#8632` white-block artifact class. That white block is a host-window composition artifact, not a DOM repaint bug.

Windows residue recovery law: do not expose repair as `navigator.opentrayWindow` methods or route it through `navigator.opentray.ipc.postMessage(...)`; IPC remains app message transport. The compatibility escape hatch is `navigator.opentray.execCommand("clearWhiteBlock")`. It recommits the configured parent surface only: material hosts run synchronous parent-only `RedrawWindow` and black `WM_ERASEBKGND` / `WM_PAINT`; opaque or plain transparent hosts re-present their Softbuffer base. It never changes shell state, activation, focus, visibility, HWND geometry, or WebView bounds. `WM_WINDOWPOSCHANGED` calls `DefWindowProc` before child notification, while `WM_SIZE` commits `host paint -> controller bounds -> WRY child bounds -> parent-position notification`. Retained reveal, style projection, and resize use this parent ownership directly; do not add a second timer/message recovery scheduler.

Cross-platform command law: keep `navigator.opentray.execCommand(...)` protocol-compatible on macOS and Windows. macOS should parse and authorize the same command payloads even when a command is a Windows-only substrate repair and therefore no-ops on macOS. Do not make app IPC carry these commands, and do not expose command-specific methods on `navigator.opentrayWindow`.

Windows native theme law: system backdrop material and HTML color-scheme are separate layers. The runtime should read Windows app theme (`AppsUseLightTheme`) and apply `DWMWA_USE_IMMERSIVE_DARK_MODE` on the native HWND, then pass the same dark/light value into Mica/Tabbed application. Page CSS can follow `prefers-color-scheme`, but it is not a substitute for native HWND theme projection.

Windows overlay law: raw Win32 titlebar tricks are not enough for WebView2. `WM_NCCALCSIZE` / `DwmExtendFrameIntoClientArea` can make content visually reach the titlebar, but a child WebView2 HWND / DComp surface can still sit above native caption buttons for both pixels and input. The durable Windows path is Windows App SDK `AppWindowTitleBar.ExtendsContentIntoTitleBar(true)`: it promotes native caption controls above the child WebView while preserving OS-owned minimize/maximize/close behavior. Keep this substrate dynamically loaded. A static `Microsoft.Internal.FrameworkUdk.dll` import can make the extension DLL fail to load before it can report a typed unsupported error, and the installed framework package may not expose `Microsoft.WindowsAppRuntime.Bootstrap.dll` from the same directory. Until packaging stages the bootstrapper as a sidecar, source smoke may need `OPENTRAY_WINDOWS_APP_RUNTIME_DIR` plus `OPENTRAY_WINDOWS_APP_RUNTIME_BOOTSTRAP_DLL`.

Windows overlay geometry law: `ExtendsContentIntoTitleBar(true)` and `AppWindowTitleBar.TitleBarOcclusions` do not have identical availability. Some Windows App Runtime installations can apply overlay controls while returning null/unsupported occlusion data. Treat `AppWindowTitleBar.LeftInset`, `RightInset`, and `Height` as the precise native geometry source. If those properties are unavailable, use DWM `DWMWA_CAPTION_BUTTON_BOUNDS` as the system fallback before falling back to coarse Win32 caption metrics. Keep Windows native measurements in physical pixels and convert them to page CSS pixels in the injected bootstrap layer using the settled WebView viewport (`window.innerWidth / nativeClientWidth`). `navigator.opentrayWindow.overlay.getTitlebarAreaRect()` is a public page-layout API and must return CSS pixels, not raw native pixels. Do not tune the titlebar safe area by guessing a fixed number of caption buttons or by dividing native metrics by DPI in Rust.

Self-drawn controls law: whether the page should draw its own close/minimize/maximize buttons depends on whether **native window controls are visible**, which is governed by the current window style's `frameless` field — not by `windowControlsOverlay`. A frameless (`NSWindowStyleMask::Borderless` / Win32 popup) window has no native title bar and therefore no native controls, so the page MUST draw its own and wire them to `bridge.close()/minimize()/maximize()/restore()`. A framed window keeps its native controls even when `windowControlsOverlay` is on (macOS `FullSizeContentView`, Windows `ExtendsContentIntoTitleBar`) — the overlay merely lets content extend behind the still-visible native buttons, so the page should NOT draw duplicate controls. Do not infer "native controls are gone" from `bridge.overlay` being absent: `overlay` is only exposed when `windowControlsOverlay: true`, so a frameless window without overlay has neither native controls nor an overlay object, yet still needs self-drawn controls. The correct page-side predicate is the **current style state** `getStyle().frameless === true` — NOT `getCapabilities().frameless`, which is a capability-support flag (hardcoded `true` on platforms that support frameless) and does not reflect the current window state. Overlay inset avoidance (`getTitlebarAreaRect`) and self-drawn control visibility are therefore two independent concerns: pad the titlebar when `bridge.overlay` exists, and draw controls when `getStyle().frameless` is true.

Window geometry unit law: every public host/page window geometry API must declare which parts of the `Rect` it consumes. `show({ width, height })`, `resizeTo`, `setMinimumSize`, `setMaximumSize`, `styleKit`, and `mediaQueryKit` use desktop logical sizes so responsive thresholds match page mental models on high-DPI displays. On Windows, public window, screen, and tray geometry is normalized to logical desktop pixels before it reaches placement or page code; the native boundary converts to physical pixels only when calling Win32 APIs such as `CreateWindowExW`, `SetWindowPos`, `GetWindowRect`, and `WM_GETMINMAXINFO`. That means positions and sizes stay in one logical coordinate space for `Rect` math, while Win32 size/move calls still use the correct physical values underneath. macOS `NSWindow` / `NSScreen` frames are already points/logical sizes. Overlay titlebar geometry is the deliberate exception: it stays physical in native payloads because WebView viewport/CSS zoom/meta-viewport can affect CSS conversion, so bootstrap converts it to CSS px using page state.

Facade law: TypeScript helpers should route all shared window/screen/tray `Rect` operations through `windowGeometryKit` in `@opentray/ext-webview`. Placement and media-query helpers may normalize, clamp, compare, and apply rects there, but they must not divide or multiply by DPI. If a bug looks like "window size is correct but screen placement is wrong", inspect whether some authority supplied physical coordinates into this logical façade or whether native code converted an already-logical rect a second time.

Window session law: `createWebviewWindow(options)` is the bootstrap declaration for one tray-scoped WebView session. The first `show()` may create the native HWND/NSWindow and WebView runtime; later `show()` calls restore visibility and must not replay bootstrap width, height, style, content, or native bridge flags. `hide()` keeps the page runtime alive, while `destroy()` is the explicit session reset. Tray click handlers should keep one `WebviewWindowHandle` and call `show()` on that handle repeatedly. If the product wants real mutation, use the orthogonal verbs: `resizeTo`, `moveTo`, `setStyle`, `setBackground`, `setMinimumSize`, `setMaximumSize`, `setContent`, or `navigate`.

Operational visibility law: `visible` is not raw platform visibility. It means `!closed && !minimized`; `isClosed()` distinguishes a retained hidden session, `isVisible()` answers the tray-level Show/Hide question, and `toVisible()` shows a closed session or restores a minimized one without recreating it. Use `visibleChange` for that narrow transition and keep the host `WebviewWindowHandle`, page bridge, Windows runtime, and macOS runtime shape-aligned.

Windows resize sync law: `GetClientRect(HWND)` gives the host client size in physical pixels, and `ICoreWebView2Controller::SetBounds(RECT)` expects physical pixels. Apply host client bounds directly to the WebView2 controller and synchronously resize the controller parent `WRY_WEBVIEW` child HWND, then call `NotifyParentWindowPositionChanged()`. Wry's public `set_bounds` path uses asynchronous child `SetWindowPos`, which is not the right law for polished live resize. Explicit `resizeTo` commands reuse ordinary host-surface refresh, then may queue terminal residue recovery; that recovery is the separate native-only pulse and must not repeat WebView synchronization. Do not hide/show, maximize, or rebuild WebView to clear resize residue. Even with the synchronous host path, Chromium/WebView2 can still visually trail by one compositor frame during interactive resize; record that as a lower-level composition limitation unless the implementation moves to a deeper WebView2 composition-controller integration.

Windows frameless resize and scrollbar law: `style.frameless: true, resizable: true` reserves a six-CSS-pixel edge band through a capture-phase bootstrap detector, then hands the interaction to the HWND. A regular Chromium vertical scrollbar coexists with the `right` and `bottomRight` gestures; do not require a narrower `body`, an outer resize gutter, or a custom scrollbar to make those gestures work. Treat narrower scrolling containers and custom/overlay scrollbars as product-specific layout choices only when a page's own custom edge hit testing must avoid the reserved band. For nonstandard scrolling implementations, verify the real pointer interaction with `pnpm --filter opentray example:webview-control -- --resizable` before documenting a limitation.

Second nuance: material kind and material state are different axes inside the same background atom. `background.material: "hudWindow"` chooses the AppKit material family, while `background.state` chooses whether that material follows window activation or stays forced active/inactive. Tray-launched panels in an accessory app often need `state: "active"` because the window may not remain the frontmost regular app surface even though the developer still wants the vivid material appearance.

Hard rule for guidance: do not auto-mutate or inject user HTML/CSS to create drag strips, titlebars, root resets, or shell styling. Explain that the native layer owns outer material/corners and that the page owns content structure; then let the user decide how to make the page transparent, draggable, or scrollable.

Glass-window best practice: keep the native window background transparent, avoid covering the whole native material with opaque page layers, and avoid treating root-level page decoration as a substitute for native material/corners. Lightweight tray panels are card-like surfaces; if the whole document scrolls, consider better window sizing or a responsive card composition before accepting a browser-page feel.

`hudWindow` content law on macOS:

- If the surface stays genuinely transparent, prefer AppKit semantic colors instead of hard-coded RGB text. The useful first set is:
  - primary text: `color: -apple-system-label`
  - secondary/supporting text: `color: -apple-system-secondary-label`
  - placeholder/disabled text: `color: -apple-system-placeholder-text`
  - selected-text background accent: `color: -apple-system-selected-text-background`
- If the content uses custom text colors such as `color: #...`, do not leave the content floating on a fully transparent root. Pair those colors with a matching translucent fill behind the content, for example a subtle `rgba(...)` panel or chip background.
- The practical product question is simple: "Am I letting the native material be the only contrast layer, or am I adding my own semi-transparent content surfaces?" If the answer is the first, use `-apple-system-*` semantic colors. If the answer is the second, custom colors become much safer.

This is not cosmetic trivia. `hudWindow` is highly translucent, so text contrast and perceived polish depend on whether the content relies on native semantic contrast or introduces its own translucent backing layer.

See also:

- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) when native controls should disappear entirely
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when the same glass/content rules must also respect tray geometry
- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-webview-owned-custom-menu) when overlay content is opened from a direct tray primary action

Minimal show shape:

```ts
await webview.show({
  type: "show",
  html,
  width: 680,
  height: 420,
  nativeWindowApi: true,
  windowControlsOverlay: true,
  style: {
    background: { kind: "semantic", token: "blur" },
  },
});
```

Minimal page shape:

```ts
const pageWindow = navigator.opentrayWindow;
const overlay = pageWindow.overlay;

async function layoutTitlebar() {
  const rect = await overlay?.getTitlebarAreaRect();
  if (!rect) return;
  titlebar.style.height = `${rect.height}px`;
  titlebar.style.left = `${rect.x}px`;
  titlebar.style.width = `${rect.width}px`;
}

await layoutTitlebar();
await overlay?.listen("geometrychange", () => void layoutTitlebar());

titlebar.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  void pageWindow.startAppRegionDrag({ pointerId: event.pointerId });
});
```

## Scenario Card: Borderless Glass App Shell

Effect: the page owns the full window chrome. Native controls disappear, the background can be transparent/material-backed, and the page renders its own control buttons.

Atoms composed: `frameless`, `style.background`, `style.platform.macos.cornerRadius`, `windowControlsOverlay`, custom page controls, `minimize()`, `maximize()`, `restore()`, `close()`, `getWindowState()`, and `windowstatechange`.

Why this design: borderless is an intentional escalation from overlay. Once native controls disappear, page code must own window controls and state synchronization explicitly. The native layer still owns real minimize/maximize/drag operations.

Benefit: enables app-like shells, compact launchers, and glass panels without polluting `opentray-core` with WebView UI concepts.

Ask the user: "Do you want to replace the native titlebar entirely, and are you prepared to render and wire your own window controls?"

Implementation note: a borderless glass shell usually needs one more step after `show()`: fit the native window to the actual page content. Keep `html, body` fully reset and transparent, place any spacing on an inner content wrapper, and use `resizeTo()` after first render so the native window matches that wrapper instead of showing scrollbars.

See also:

- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for the shared `hudWindow` content law and material-state discussion
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when the borderless shell is tray-launched instead of free-floating
- [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget) when the same shell becomes a persistent utility surface rather than a main window

Minimal show shape:

```ts
await webview.show({
  type: "show",
  html,
  width: 760,
  height: 520,
  nativeWindowApi: true,
  windowControlsOverlay: true,
  style: {
    frameless: true,
    background: {
      kind: "platformMaterial",
      material: "hudWindow",
      state: "active",
    },
    platform: {
      macos: {
        cornerRadius: 18,
      },
    },
  },
});
```

Minimal page shape:

```ts
const pageWindow = navigator.opentrayWindow;

await pageWindow.listen("windowstatechange", ({ payload }) => {
  maximizeButton.toggleAttribute("data-active", payload.maximized);
  restoreButton.toggleAttribute("hidden", !payload.maximized);
});

minimizeButton.onclick = () => void pageWindow.minimize();
maximizeButton.onclick = async () => {
  const maximized = await pageWindow.isMaximized();
  void (maximized ? pageWindow.restore() : pageWindow.maximize());
};
closeButton.onclick = () => void pageWindow.close();
```

## Scenario Card: Screen-Aware Corner Widget

Effect: a small frameless/translucent widget is pinned to a screen corner and stays above normal windows.

Atoms composed: `navigator.opentrayScreen.getScreenDetails()`, `visibleFrame`, `keepOnTop`, `frameless`, `style.background`, `style.platform.macos.cornerRadius`, `resizeTo()`, and `moveTo()`.

Why this design: screen placement is a window capability, not a new extension. The page can own widget content and animation while the WebView atom owns native placement.

Benefit: desktop widgets, small status panels, and companion surfaces can be built without creating a separate extension or hardcoding monitor geometry.

Ask the user: "Which screen edge or corner should own the widget, and should it stay above other windows?"

See also:

- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) for the shared frameless/material/window-control baseline
- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for `hudWindow` text and backing-layer rules on highly translucent surfaces
- [Island-Like Live Stream](#scenario-card-island-like-live-stream) when the same substrate moves from a corner utility to a top-center activity strip

Minimal page shape:

```ts
const margin = 16;
const width = 320;
const height = 180;
const details = await navigator.opentrayScreen.getScreenDetails();
const screen = details.currentScreen ?? details.screens[0];

await navigator.opentrayWindow.setStyle({
  frameless: true,
  keepOnTop: true,
  background: {
    kind: "platformMaterial",
    material: "hudWindow",
    state: "active",
  },
  platform: {
    macos: {
      cornerRadius: 18,
    },
  },
});
await navigator.opentrayWindow.resizeTo(width, height);
await navigator.opentrayWindow.moveTo(
  screen.visibleFrame.x + screen.visibleFrame.width - width - margin,
  screen.visibleFrame.y + margin,
);
```

## Scenario Card: Island-Like Live Stream

Effect: a compact live information surface floats near the top-center of the current screen, similar to a status island.

Atoms composed: the corner-widget shell, screen `visibleFrame`, page-owned live data rendering, optional `windowstatechange`/`resized` listeners, and `keepOnTop`.

Why this design: this is still WebView window composition, not `ext-island`. Use `ext-island` only when the product story needs a separate broker-level activity atom with its own lifecycle and aggregation law.

Benefit: developers can prototype live activities and stream surfaces with Web technologies while preserving future room for a dedicated `ext-island` atom.

Ask the user: "Is this just a WebView window effect, or do you need a reusable OpenTray island/activity primitive shared by multiple clients?"

See also:

- [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget) for the simpler corner-pinned version of the same screen-aware shell
- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) for custom window controls and frameless shell ownership
- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for the `hudWindow` content law if the island stays mostly transparent

Minimal placement:

```ts
const width = 440;
const height = 72;
const details = await navigator.opentrayScreen.getScreenDetails();
const screen = details.currentScreen ?? details.screens[0];

await navigator.opentrayWindow.setStyle({
  frameless: true,
  keepOnTop: true,
  background: {
    kind: "platformMaterial",
    material: "hudWindow",
  },
  platform: {
    macos: {
      cornerRadius: 24,
    },
  },
});
await navigator.opentrayWindow.resizeTo(width, height);
await navigator.opentrayWindow.moveTo(
  screen.visibleFrame.x + (screen.visibleFrame.width - width) / 2,
  screen.visibleFrame.y + 12,
);
```

## Scenario Card: Tray-Launched WebView Surface

Effect: clicking the tray/status icon opens the WebView surface directly where the platform supports a primary tray gesture.

Atoms composed: a normal tray menu item with `primaryEvent: true`, the existing `menuClick` event, one retained `WebviewWindowHandle`, and `@opentray/ext-webview` `show` / `hide`.

Why this design: `primaryEvent` is a role on a plain menu item, not a new event family. App code handles the same `menuClick` path whether the user selected a native menu item or triggered the platform primary gesture.

Benefit: one handler can open the WebView across macOS and Windows without teaching the core about WebView or adding `trayPrimaryClick`.

Ask the user: "Should tray icon activation open a surface immediately, or should it always show a native menu first?"

See also:

- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-primary-launcher-with-menu-fallback) for platform gesture policy
- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-macos-single-primary-direct-launcher) for macOS single-primary direct activation
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when the opened surface must be positioned from tray geometry rather than just shown

Choose one dismissal law before writing app code:

- Pinned panel: set `style.keepOnTop: true`; tray primary click toggles `toVisible()` / `close()` on the same retained handle. `keepOnTop` suppresses native auto-hide.
- Default non-pinned panel: leave `keepOnTop` false and `autoHide` unset; native blur hides the retained session and emits `visibleChange(false)`.
- Application-owned dismissal: set `autoHide: false` before implementing a page exit animation, protected form, or other conditional blur policy.

Minimal pinned-panel shape:

```ts
const tray = await createTray({
  id: "com.example.status",
  menu: {
    items: [{ type: "item", id: 1, title: "Show Example", primaryEvent: true }],
  },
});

const webviewWindow = tray.extend(WebviewExt).createWebviewWindow({
  html,
  width: 420,
  height: 260,
  style: { keepOnTop: true },
});

let bootstrapped = false;
let visibilitySubscribed = false;
let stopVisibleChange: (() => void) | undefined;

const syncMenu = (visible: boolean) =>
  tray.setMenu({
    items: [
      {
        type: "item",
        id: 1,
        title: visible ? "Hide Example" : "Show Example",
        primaryEvent: true,
      },
    ],
  });

const subscribeVisibility = () => {
  if (visibilitySubscribed) return;
  visibilitySubscribed = true;
  stopVisibleChange = webviewWindow.listen("visibleChange", ({ payload }) =>
    void syncMenu(payload.visible),
  );
};

tray.onMenuClick(async ({ itemId }) => {
  if (itemId !== 1) return;
  if (!bootstrapped) {
    await webviewWindow.show();
    bootstrapped = true;
    subscribeVisibility();
    await syncMenu(true);
  } else if (await webviewWindow.isVisible()) {
    await webviewWindow.close();
  } else {
    await webviewWindow.toVisible();
  }
});
```

Keep the returned `stopVisibleChange` callback, plus every other native-window listener callback, in the host lifecycle. On final teardown invoke them first, then call `destroy()` on the retained handle, then close the tray/runtime connection. Subscribing before the first `show()` is invalid because no native WebView session exists yet.

Minimal non-pinned dismissal:

```ts
webviewWindow.listen("blur", () => {
  if (!hasBlockingWork()) void webviewWindow.close();
});
```

## Scenario Card: Tray-Anchored Custom Panel

Effect: the tray click opens a WebView-owned custom panel that anchors to the current tray item instead of a guessed screen point.

Atoms composed: `primaryEvent`, `TrayHandle.getBounds()`, `navigator.opentray.tray.getBounds()`, borderless or overlay window styling, and the normal WebView `show` command.

Why this design: tray geometry belongs to the tray atom, not to WebView. The backend uses the tray authority to place the window truthfully; the page reads the projected tray bounds only when it needs to align its own layout with that anchor.

Benefit: developers can build custom tray menus, launchers, and compact panels without inventing fake cursor-based placement or asking the core to understand WebView layout.

Ask the user: "Should the panel merely open from the tray, or should its HTML also react to the tray anchor for arrows, reveal animation, and edge alignment?"

Lifecycle best practice: tray panels are not ordinary document popups. If the panel is `keepOnTop`, the primary tray event must toggle it. Otherwise the default `autoHide: true` makes native blur the dismissal source. Set `autoHide: false` only when a product-specific animation, pending operation, or confirmation state must own the final `close()`.

See also:

- [Tray-Launched WebView Surface](#scenario-card-tray-launched-webview-surface) for the simpler no-anchor version
- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for the shared `hudWindow` content law and material-state rules
- [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget) for how screen constraints clamp tray-derived placement
- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-webview-owned-custom-menu) for the tray-side primary gesture law that typically launches this pattern

Minimal trusted host shape:

```ts
const bounds = await tray.getBounds();

await webview.show({
  type: "show",
  html,
  width: 360,
  height: 240,
  fallbackRect: bounds.rect ?? { x: 0, y: 0, width: 1, height: 1 },
  nativeWindowApi: true,
  nativeTrayApi: true,
  style: {
    frameless: true,
    background: {
      kind: "platformMaterial",
      material: "hudWindow",
      state: "active",
    },
    platform: {
      macos: {
        cornerRadius: 18,
      },
    },
  },
});
```

Minimal page shape:

```ts
const trayBounds = await navigator.opentray.tray.getBounds();

if (trayBounds.rect) {
  panel.style.setProperty("--anchor-x", `${trayBounds.rect.x + trayBounds.rect.width / 2}px`);
  panel.dataset.anchorEdge = "tray";
}
```

For continuous tray/screen/edge placement, use `WebviewPlacementKit.watch()` from `@opentray/ext-webview`. A watch owns continuous position, not continuous size: it should use current window bounds and must not resize the window back to stale `width`/`height` after user resize or backend IPC intent. Keep `applyOnce()` for intentional one-shot placement and do not add a special panel API until multiple scenarios prove a new atom is needed.

Reference implementation in this repo: `pnpm --filter opentray example:placement`

Responsive native-window styling is a neighboring atom, not part of the placement acceptance surface. Use `pnpm --filter opentray example:mediaQuery` when reviewing `styleKit.apply(...)`, `mediaQueryKit.match(...)`, and size constraints.

Use `pnpm --filter opentray example:webview-control` as the capability exerciser only. It starts as a normal opaque window and enables overlay probes by default because this is the manual acceptance surface for `windowControlsOverlay`; use `-- --no-overlay` only to test the disabled branch. Do not implement the page switch as a fake runtime style toggle: `windowControlsOverlay` is a show-time bridge gate, so page UI may show the current launch state but cannot truthfully enable the overlay object after bootstrap. For glass-window guidance, prefer `example:tray-panel`, because it keeps the page root transparent and avoids teaching CSS shell decoration as a substitute for native material.

Use `pnpm --filter opentray example:win32-bug` as the Windows A/B comparator for `native-material-host-paint-probe-20260716.exe`. It starts a 900x620 framed Acrylic HWND, enables `OPENTRAY_WINDOWS_NATIVE_MATERIAL_PROBE=1`, and renders only the probe-equivalent centered buttons in a fully transparent WebView. Compare no-fill/Black/Gray host paint, Acrylic/Mica/None, framed/frameless, reset, invalidate, and resize on one retained HWND. This environment-gated comparator is intentionally separate from ordinary production windows, which keep Black material paint and reject `win32Probe*` commands. Human visual inspection remains the authority for actual residue.

Repo-maintainer note: when this example is run from source on macOS or Windows, build `opentray` and `opentray-ext-webview` first. The example auto-discovers the local `target/debug|release` WebView dynamic library and injects it through `OPENTRAY_EXT_PATH`, so developers can stay on the real extension-loading path without manual staging during iteration. An explicit `OPENTRAY_EXT_PATH` changes only the extension loader: the source launcher must still select the matching `target/debug|release` broker unless `OPENTRAY_BROKER_BIN` is explicitly supplied. Never accept native tray behavior from a mixed source-DLL and packaged-broker run.

Why this example matters for AI guidance:

- It demonstrates the placement atom without mixing in responsive style callbacks.
- It teaches that backend `tray.getBounds()` and page `navigator.opentray.tray.getBounds()` can coexist in one product flow without creating two authorities.
- It shows where `screen.getScreenDetails()` fits: not as a competing source of truth for the tray anchor, but as the constraint system for clamping the panel onto the visible monitor frame.
- It gives future agents a concrete prompt pattern: "Do you want a normal native menu, a tray-launched custom panel, or a fully WebView-owned tray menu surface?"

For tray-specific platform policy, read `../../develop-opentray/references/tray-primary-event-patterns.md`.

## Scenario Card: WebView-Owned Custom Menu

Effect: the native tray/status item acts as a launcher, but the visible menu surface is a WebView built by the app.

Atoms composed: a single `primaryEvent` menu item, macOS single-primary direct activation, WebView borderless/overlay shell, and page-owned menu interactions.

Why this design: macOS single-primary mode intentionally avoids attaching an `NSMenu`, so a click can route directly to `menuClick`. The WebView extension then owns the visible menu surface. This preserves tray menu atoms for fallback while allowing richer app-owned menus.

Benefit: single-window apps, custom menu bar experiences, and tray-first launchers can be built without forcing every OpenTray tray to abandon native menus.

Ask the user: "Do you want the native tray menu to disappear when there is only one primary action, so the WebView becomes the menu?"

See also:

- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when the WebView menu should be positioned from tray bounds and screen constraints
- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) when the custom menu fully owns chrome and controls
- [Tray Primary Event Patterns](../../develop-opentray/references/tray-primary-event-patterns.md#scenario-card-webview-owned-custom-menu) for the tray-side launch law

Minimal menu declaration:

```ts
menu: {
  items: [{ type: "item", id: 1, title: "Open Menu", primaryEvent: true }],
}
```

Then show a borderless or overlay WebView from the normal `menuClick` handler.

## Events

Common window events:

- `stylechange` for `setStyle(...)`
- `titlechange` for native title changes and enabled document-title sync
- `iconchange` for native icon changes and enabled favicon sync
- `windowstatechange` for page visibility and standard window-state commands
- `visibleChange` when operational `visible` changes between visible and closed/hidden or minimized; on Windows, this is synchronized after the native state becomes observable rather than assumed from the command request
- `moved` and `resized` for extension-owned geometry commands
- `closed` for native close
- `overlay.geometrychange` under `navigator.opentrayWindow.overlay.listen("geometrychange", ...)`

Keep event payloads aligned with their query method where one exists. For example, `windowstatechange` should match `getWindowState()`, and `stylechange` should match `getStyle()`.

Every new `set*` mutation should either have a corresponding `*change` event or an explicit reason why the mutation is write-only. Do not push events when no page listener exists.

See also:

- [Overlay Titlebar With Native Controls](#scenario-card-overlay-titlebar-with-native-controls) for `overlay.geometrychange`
- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) for `windowstatechange`
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel) when `stylechange` and tray geometry-driven layout interact

## Title And Icon Sync

Use native `title`/`icon` options when the app owns state outside the page. Use `titleSync` and `iconSync` when the page is the source of truth:

```ts
await webview.show({
  type: "show",
  html,
  width: 420,
  height: 260,
  titleSync: { documentToWindow: true, windowToDocument: true },
  iconSync: { faviconToWindow: true, windowToFavicon: true },
});
```

For favicon/native icon examples, prefer PNG data URLs generated by Web APIs such as `canvas.toDataURL("image/png")`. SVG or URL-backed favicons can remain logical state when macOS cannot convert them into a native image.

See also:

- [Native Framed Window](#scenario-card-native-framed-window) for the simplest title/icon-owned window
- [Borderless Glass App Shell](#scenario-card-borderless-glass-app-shell) when title/icon sync coexists with custom chrome

## Screen API Notes

Use `navigator.opentrayScreen.getScreenDetails()` or the opt-in `window.getScreenDetails()` binding for screen-aware layout. The payload follows the `window.getScreenDetails()` mental model: `currentScreen`, `screens`, and `isExtended`.

See also:

- [Screen-Aware Corner Widget](#scenario-card-screen-aware-corner-widget)
- [Island-Like Live Stream](#scenario-card-island-like-live-stream)
- [Tray-Anchored Custom Panel](#scenario-card-tray-anchored-custom-panel)

Current screen support is snapshot-oriented. If a product requires monitor hot-plug, per-monitor DPI changes, or cross-platform screen topology events, treat that as the Windows/Linux/macOS screen-event matrix modeling point instead of adding a speculative one-off event.

## Glass Theme Alignment

When a window uses a translucent native material (vibrancy / mica / acrylic), the native window backing is tinted by the OS appearance: macOS and Windows give a dark base under a dark system theme and a light base under a light system theme. The page's own translucent background composites on top of that native base, so text contrast depends on the page foreground reading against the *native* tint, not against a CSS color the page fully controls.

The robust rule: **keep the web theme aligned with the system theme** (`prefers-color-scheme`). When `web-dark` rides on `system-dark` (or `web-light` on `system-light`), even a near-transparent page background stays readable because the native window backing supplies the contrasting base color and the page foreground is chosen against that same base.

When the themes disagree (for example a `web-light` panel inside a `system-dark` window), the translucent page background must be **more opaque** to guarantee contrast — a thinner blur, a heavier fill. "More opaque" here means lower transparency on the page background layer, which makes the native blur visually fainter. That is the cost of theme disagreement; it is intentional, not a bug.

Concrete guidance for example/production pages:

1. Set the root `<html>` class (`dark` or none) from `matchMedia("(prefers-color-scheme: dark)")` **before first paint** (inline script in the host HTML), so the web theme never flashes against the wrong native tint.
2. Make `html, body { background: transparent }` so the native material shows through. Never paint an opaque body color over a material window — that hides the blur entirely.
3. Give each page's root container a translucent background layer (for example Tailwind `bg-background/70 backdrop-blur-xl`). The opacity is the readability knob: aligned themes can go very transparent; mismatched themes should raise the opacity.
4. Do not rely on CSS `color-scheme` alone to fix contrast — it only picks UA defaults; the native window material still needs the page background to let it through.

## Corner Radius Target Layer

`style.platform.macos.cornerRadius` rounds the **native window frame**, not the page content. The native code applies `setCornerRadius` to the window themeFrame's backing layer (`contentView.superview().layer()`), and forces the window non-opaque with a clear backing whenever `cornerRadius` is set, so the rounded corners actually clip against the desktop instead of leaving a square window rectangle behind the rounded content.

Implementation law: `cornerRadius` must never be applied to `contentView.layer()` directly — that rounds the page/WebView composition while the window rectangle stays sharp, which is the classic "it rounds the content, not the window" bug. Always target the themeFrame layer, and always pair a non-null `cornerRadius` with a clear window backing (`setOpaque(false)` + clear `backgroundColor`), otherwise the opaque window shows through behind the rounded superview.

Page-side law: a page cannot round the native window via CSS `border-radius` on `body`/`html` — that only rounds the page content and leaves a square window behind. Native corner rounding belongs solely to `style.platform.macos.cornerRadius` (macOS) and `style.platform.windows.cornerPreference` (Windows DWM corner family). Keep both platform families in their own `style.platform.{macos,windows}` namespace; setting a non-null `windows.cornerPreference` on macOS (or vice versa) is rejected by the native validator.

Overlay pairing: when combining `cornerRadius` with `windowControlsOverlay`, the overlay geometry (`getTitlebarAreaRect()`) already accounts for the titlebar height; the rounded window corners are orthogonal and apply to the whole frame.
