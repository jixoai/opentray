<!--
Orthogonal intents (2026-07-17; original user request):
1. Expose native WebView window controls and their measurable overlay geometry.
2. Let Windows overlay caption controls use explicit opaque background and symbol colors.
3. Keep macOS controls native and transparent rather than emulating Windows composition.
4. Keep frameless shell ownership and explicit user-resize intent consistent across macOS and Windows.
5. Teach retained WebView tray primary actions through operational visibility, not local booleans.
6. Prevent Windows native host/DWM residue through persistent parent-surface ownership and ordered child commits.
-->

# @opentray/ext-webview

Official rich popup extension for OpenTray.

## Role

- Provide borderless tray-adjacent popup panels.
- Use platform WebView engines through the native extension layer.
- Route WebView messages through the owning `appId` / `trayId`.

This package is an extension atom. It must not become the owner of core tray lifecycle.

The facade stays platform-neutral. Supported native libraries are optional platform packages named `@opentray/ext-webview-<os>-<arch>`, and the runtime host resolves them through the dynamic extension discovery law when a mounted WebView capability loads `@opentray/ext-webview`. Official WebView native packages are currently published for macOS and Windows only; Linux is unsupported for this extension.

The platform dylib owns the full WebView protocol and native runtime. `opentray` forwards scoped extension traffic to it, but does not keep a core-side WebView parser or native WebView builder.

## Install

```bash
pnpm add opentray @opentray/ext-webview
```

When locking a compatible package closure, use the same protocol-line tag for both packages:

```bash
pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B
```

Use `alpha-A-B` for alpha packages on the same protocol line. Do not install platform WebView packages directly; `@opentray/ext-webview` resolves the supported native package through optional dependencies.

`WebviewExt.artifact` records the facade package, canonical contract manifest, and target package mappings. OpenTray resolves that descriptor from the facade's own dependency closure, so an unmanaged platform package in the consumer root cannot shadow the installed WebView runtime.

## First Panel

Call `createTray()` directly and mount WebView through `tray.extend(WebviewExt)`. The first `show()` loads the native extension. A primary tray item should always state its next action, use `toVisible()` for a retained session, and use `close()` to hide without destroying page state:

```ts
import { createTray } from "opentray";
import { WebviewExt } from "@opentray/ext-webview";

const primaryItemId = 1;
const menu = (visible: boolean) => ({
  items: [
    {
      type: "item" as const,
      id: primaryItemId,
      title: visible ? "Hide Example" : "Show Example",
      primaryEvent: true,
    },
  ],
});

const tray = (
  await createTray(
    {
      id: "com.example.panel",
      icon: { "text-only": "OT" },
      menu: menu(false),
    },
    { appId: "com.example.panel", appName: "Panel" }
  )
).extend(WebviewExt);
const panel = tray.createWebviewWindow({
  html: "<main>Hello</main>",
  width: 360,
  height: 220,
});

let bootstrapped = false;
let visibilitySubscribed = false;
let stopVisibleChange: (() => void) | undefined;
const subscribeVisibility = () => {
  if (visibilitySubscribed) return;
  visibilitySubscribed = true;
  stopVisibleChange = panel.listen("visibleChange", ({ payload }) =>
    void tray.setMenu(menu(payload.visible)),
  );
};
tray.onMenuClick(async ({ itemId }) => {
  if (itemId !== primaryItemId) return;
  if (!bootstrapped) {
    await panel.show();
    bootstrapped = true;
    subscribeVisibility();
    await tray.setMenu(menu(true));
  } else if (await panel.isVisible()) {
    await panel.close();
  } else {
    await panel.toVisible();
  }
});
```

Register any native window listener only after the first successful `show()`. During final teardown, invoke every unlisten callback, call `destroy()` on the WebView handle, then close the tray/runtime connection. This prevents event polling and native sessions from outliving the example process.

`createTray()` is the public creation entrypoint. The runtime ships as a packaged executable (`bin/opentray`); `createTray()` spawns it on demand and talks the OpenTray newline-JSON protocol over a socket. Application code does not import a Node binding, host a native main loop, or wrap tray creation in a worker — the calling process is the caller, and the executable owns the native event loop and session lifecycle.

Use `attachWebview(tray)` only as a compatibility adapter for older code. New code should prefer `tray.extend(WebviewExt)` so multiple trays can mount isolated WebView instances.

## Maturity Truth

Read the current platform story as four different truths, not one vague support flag:

- `stable`: current human-visible acceptance path
- `alpha`: published contract or package path that is still pre-stable for real user-facing runtime behavior
- `unsupported by design`: the runtime deliberately rejects a request because it does not truthfully map to the current substrate
- `unavailable by context`: the capability exists, but the current WebView session does not have authoritative data for that specific request

Current WebView maturity:

- macOS: `stable` for the window capability surface documented below
- Windows: `stable` for the WebView2-backed window capability surface documented below
- Linux: `unsupported by design`; OpenTray core still supports Linux, but `@opentray/ext-webview` no longer publishes Linux native packages
- requesting `platform.windows.*` from the macOS runtime, or unknown macOS material/material-state values: `unsupported by design`
- tray bounds with no authoritative tray anchor in the current session: `unavailable by context`

## Window Capability

`@opentray/ext-webview` owns its native window capability surface inside the extension atom. The runtime host only forwards extension traffic.

macOS support includes:

- frameless windows through native `NSWindow` style projection
- transparent WebView/window background through Wry + AppKit
- material backgrounds through `window-vibrancy`
- keep-on-top window level on macOS
- whole-window opacity through `style.opacity`
- titlebar overlay geometry through `navigator.opentrayWindow.overlay`
- native app-region dragging through `startAppRegionDrag()`
- minimize, maximize, and restore window-state controls
- operational visibility through `isClosed()`, `isVisible()`, `toVisible()`, and `visibleChange`
- common native focus-loss dismissal through `style.autoHide`, defaulting to `true` and suppressed by `keepOnTop`
- adjustable native window-frame corner radius through `style.platform.macos.cornerRadius`
- native title and icon state
- declarative `document.title` / native-title synchronization
- declarative favicon / native-icon synchronization, with best-effort native projection
- screen details through `navigator.screen` / `navigator.opentrayScreen`
- tray bounds through `navigator.opentray.tray.getBounds()`
- source-scoped native capability policy with local-only defaults for remote safety

Windows support includes:

- visible WebView2-backed windows through Wry
- `show`, `hide`, `destroy`, `setContent`, `navigate`, `evaluate`, and `postMessage`
- `navigator.window` / `navigator.opentrayWindow` bridge injection with source-scoped `nativeApiPolicy`
- `close`, `moveTo`, `resizeTo`, `minimize`, `maximize`, `restore`, `getWindowState`, `isClosed`, `isVisible`, `toVisible`, `isMaximized`, and `isMinimized`
- `getStyle` / `setStyle` for common `frameless`, `resizable`, `background`, `keepOnTop`, `autoHide`, and `opacity`
- `windowControlsOverlay` geometry, Windows caption-button `backgroundColor` / `symbolColor`, `startAppRegionDrag()`, and subscription-driven bridge events
- title sync and native window/taskbar icon projection for RGBA icons, local icon files, and PNG data URLs
- Windows DWM background materials through `style.background`: `auto`, `mica`, `acrylic`, and `tabbed`
- Windows 11 corner preference through `style.platform.windows.cornerPreference`: `default`, `doNotRound`, `round`, and `roundSmall`
- current-monitor screen snapshot through `navigator.screen` / `navigator.opentrayScreen`
- tray bounds projection through `navigator.opentray.tray.getBounds()`

Full Windows multi-monitor enumeration remains a follow-up; the current screen API is a current-monitor snapshot.

Visual effects stay capability-gated. Unsupported or platform-fragile effects must reject with typed unsupported errors rather than faking success.

For glass or blur-style surfaces, two things must line up at once:

- native background must be one mutually exclusive mode: `transparent`, `semantic: blur`, or `platformMaterial`
- the page must leave some regions genuinely transparent instead of covering the whole window with opaque HTML or CSS blur overlays

`style.opacity` is a separate whole-window shell alpha from `0` through `1`. It composes with `style.background`, but it does not choose a backing mode: `opacity: 0.72` keeps an opaque background opaque unless you also request `background: "transparent"`, semantic blur, or a platform material.

`style.resizable` controls user-driven resizing and is independent from programmatic `resizeTo(...)`:

- framed windows default to `resizable: true`
- frameless windows default to `resizable: false`
- an explicit `resizable` value survives later `frameless` changes
- Windows frameless windows with `resizable: true` reserve a six-CSS-pixel edge/corner band and resize through the native HWND; pages do not implement a pointer-move `resizeTo()` loop
- macOS maps the same intent to `NSWindowStyleMask::Resizable`

### Frameless Resize And Native Scrollbars

On Windows, a regular Chromium vertical scrollbar coexists with the `right` and `bottomRight` soft-resize gestures of a frameless WebView. The injected capture-phase detector measures the six-CSS-pixel edge band against `window.innerWidth`, then the native HWND owns the resize interaction. A normal page scrollbar does not require a reserved outer gutter or a custom scrollbar for right-edge resizing to work.

During that soft-resize interaction the runtime updates the HWND/WebView bounds and repaints in place. It does not run a shell transition, synthetic geometry pulse, timer, or private recovery message. Material `WM_SIZE` ordering is native host paint first, then WebView2 controller bounds, WRY child bounds, and parent-position notification. A pure window move only notifies the WebView parent. Retained reveal recommits the parent surface immediately after the window becomes visible; style/background changes complete the parent before committing the WebView child. Frameless `WM_NCCALCSIZE` handling owns every message form, so resize, minimize, and restore do not reintroduce a native titlebar.

An application may still make its scrolling container narrower than the viewport, or use a custom/overlay scrollbar, when its own edge controls or layout must avoid the reserved six-pixel resize band. That is a product layout choice, not an OpenTray workaround for normal native scrollbars. Smoke-test nonstandard page hit testing and scrollbar implementations with the target interaction.

Treat `style.background` as the single source of truth for native backing and material composition:

- `{ kind: "opaque" }` means an opaque native/WebView backing
- `{ kind: "transparent" }` means a clear native/WebView backing with no material
- `{ kind: "semantic", token: "blur" }` means the runtime should choose the platform blur material, currently Windows Acrylic and macOS `hudWindow`
- `{ kind: "platformMaterial", material: "..." }` means a substrate-specific material name, such as Windows `mica` or macOS `hudWindow`
- material modes clear the native/WebView backing as part of the same transaction; callers must not combine a separate transparent flag with material fields

Material selection has a second axis: background state. Use `background.state` to choose whether the system material follows the window focus state or stays forced active/inactive:

- `followsWindowActiveState` keeps the platform default behavior
- `active` requests the vivid active appearance, which is often the right choice for tray panels and accessory-app utility surfaces
- `inactive` requests the subdued inactive material appearance

macOS maps the state to `NSVisualEffectState`. Windows maps the state through its DWM backdrop projection and non-client activation handling so `followsWindowActiveState`, `active`, and `inactive` remain part of the same background atom.

If the page paints every pixel itself, the native material is still present, but users will not see it.

For tray panels or other glass-like borderless surfaces, keep the native and page responsibilities separate. The native layer owns the outer material, transparency, and platform corners; the page owns content structure inside that box. Avoid covering the whole native material with opaque page layers or treating page-level shadows, fake blur, and root decoration as a substitute for the native shell. Lightweight panels are closer to cards than documents, so a root-level document scrollbar usually means the window size or card composition needs a product decision.

## Direct Window API

Mount WebView on a tray, then create a tray-scoped window. The first window command loads the native extension automatically:

```ts
import { WebviewExt } from "@opentray/ext-webview";
import { createTray } from "opentray";

const tray = (
  await createTray({
    id: "com.example.status",
    icon: { "text-only": "OT" },
    tooltip: { title: "Status", description: "Background service" },
  })
).extend(WebviewExt);

const webview = tray.createWebviewWindow({
  html: "<main><h1>OpenTray</h1></main>",
  width: 420,
  height: 260,
  devtools: true,
});

await webview.show();
```

Run a runtime-host-free protocol example that sends WebView `show`, `navigate`, `postMessage`, and `hide` commands through the normal OpenTray extension command path:

```bash
pnpm --filter @opentray/ext-webview example:webview
```

Inside this repo, `pnpm --filter opentray example:webview-control` is the API exercise demo, while `pnpm --filter opentray example:tray-panel` is the canonical tray-anchored glass recipe. `pnpm --filter opentray example:win32-bug` is the Windows A/B comparator for `native-material-host-paint-probe-20260716.exe`: it enables an environment-gated native probe state and renders only the equivalent centered buttons in a fully transparent WebView. The hidden HWND completes material and initial geometry before WebView2 creation; ordinary windows keep the production `BLACK_BRUSH` material base and reject probe commands. Production `clearWhiteBlock` still recommits only the configured native host surface and never mutates shell state, focus, geometry, or WebView bounds.

The comparator's frameless toggle intentionally uses the standalone probe's native resize frame, system menu, style-derived DWM non-client policy, and native resize path. Its `WM_NCCALCSIZE` handler first delegates to `DefWindowProcW`, preserves the left/right/bottom native resize insets, and then projects only the client top to the system-reported `DWMWA_VISIBLE_FRAME_BORDER_THICKNESS`. This removes the caption-height gap above WebView2 without changing the already-correct side geometry. The source geometry smoke requires both `getBounds() - window.outerWidth` and `getBounds() - window.outerHeight` to remain within 0-4 logical pixels. Production frameless windows remain full-client and keep application-level soft resize.

Windows source examples now select that comparator host topology independently from probe instrumentation. `example:webview-control -- --no-overlay` is the direct native-shell A/B path against `example:win32-bug`; default webview-control overlay keeps the same pre-WebView host construction and adds only the post-WebView AppWindow titlebar stage. Ordinary applications do not inherit the comparator switch. Comparator topology still obeys `style.appMode`: the default remains outside the taskbar and Alt+Tab.

For ordinary Windows overlay windows, cold start completes Win32/DWM material and host geometry before WebView2, then initializes AppWindow titlebar overlay after WebView2 establishes COM and before final child bounds/show. Host-side native window events use one single-flight poller; a transport failure stops polling and is reported once.

The manual walkthrough for all three CLI examples lives in [../cli/examples/EXAMPLE.md](../cli/examples/EXAMPLE.md).

To expose the injected page API, enable it on the window options before the first `show()`:

```ts
const webview = tray.createWebviewWindow({
  html: "<main><h1>OpenTray</h1></main>",
  width: 420,
  height: 260,
  title: "OpenTray WebView",
  style: {
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
  },
  windowControlsOverlay: true,
  nativeWindowApi: true,
  bindWindowGlobals: true,
  nativeScreenApi: true,
  bindScreenGlobals: true,
  nativeTrayApi: true,
  titleSync: {
    documentToWindow: true,
    windowToDocument: true,
  },
  iconSync: {
    faviconToWindow: true,
    windowToFavicon: true,
  },
  devtools: true,
  nativeApiPolicy: {
    defaultSrc: ["'local'"],
    window: ["https://example.com"],
    screen: ["https://example.com"],
    tray: ["https://example.com"],
    titleSync: ["https://example.com"],
    iconSync: ["https://example.com"],
  },
});

await webview.show();
```

Window session law:

- `createWebviewWindow(options)` is the bootstrap declaration for one tray-scoped window session
- the first `show(...)` for a tray creates the native window session
- `hide()` only hides that session; it does not destroy the page runtime
- after the first successful show, `show()` restores visibility and does not replay bootstrap width, height, style, content, or native API flags
- `visible` means the session is neither closed/hidden nor minimized; use `isClosed()` and `isVisible()` to query those facts, and use `toVisible()` to show a hidden session or restore a minimized session without rebuilding it
- explicit content replacement belongs to `setContent({ type: "setContent", html | url })` or `navigate(url)`
- explicit size and style changes belong to `resizeTo(...)`, `moveTo(...)`, `setStyle(...)`, `setBackground(...)`, `setMinimumSize(...)`, and `setMaximumSize(...)`
- explicit session teardown belongs to `destroy()`

This is intentional. `show(...)` is the visibility/bootstrap verb, not the implicit reload or reset verb. Tray click handlers should create one handle and call `show()` on that handle repeatedly; do not create a new window, reapply startup style, or resend startup size on every tray activation.

Without `nativeApiPolicy`, page-exposed native capability is local-only by default. Remote URLs do not receive `navigator.window`, `navigator.screen`, global bindings, or page-native sync unless their source is explicitly allowed.

Browser/device permissions use a separate policy surface. Do not overload `nativeApiPolicy` for camera, microphone, geolocation, notifications, clipboard read, autoplay, local fonts, sensors, MIDI system exclusive, file read/write, multiple downloads, or window management:

```ts
const webview = tray.createWebviewWindow({
  html: "<main />",
  browserPermissionPolicy: {
    camera: { sources: ["'local'"], decision: "prompt" },
    microphone: { sources: ["'local'"], decision: "allow" },
  },
  permissionManagerPolicy: {
    defaultSrc: ["'local'"],
    remoteOrigins: ["https://example.com"],
  },
});
```

Download routing is a separate top-level window option, not part of `nativeApiPolicy`:

```ts
const webview = tray.createWebviewWindow({
  html: "<main />",
  download: {
    enabled: true,
    saveAs: false,
  },
  browserPermissionPolicy: {
    multipleDownloads: {
      sources: ["'local'"],
      decision: "allow",
    },
  },
});
```

`download` defaults to `{ enabled: true, saveAs: false }`, so local HTML can use standard `<a download>` or blob downloads with zero extra configuration. Local pages are allowed by default; remote pages stay denied unless `browserPermissionPolicy.multipleDownloads` explicitly allows them. The lifecycle events `downloadstarted`, `downloadprogress`, `downloadcompleted`, `downloadfailed`, and `downloadcanceled` flow through the same `navigator.opentrayWindow.listen(...)` / `webview.listen(...)` bus as other native window events. Each payload keeps the existing `filename` field and adds `suggestedFilename`, which carries the pre-deduped substrate suggestion when available and `null` when the platform does not expose a distinct suggestion.

`permissionManagerPolicy` controls whether `opentrayPermissions` can be injected as a permission-management object. Remote origins do not receive that object by default, even when a permission family is allowlisted. Durable permission facts use the default app-scoped JavaScript permission store from `createAppScopedWebviewPermissionStore({ appId })`; the store is namespaced by OpenTray `appId` and does not use WebView page storage as the source of truth.

Call `startPermissionManager()` on the WebView window handle to drain page-side `opentrayPermissions` messages into the app-scoped store. Apps can pass `permissions.store` to use a custom adapter; otherwise the default store is created from the OpenTray app identity.

```ts
const stopPermissions = webview.startPermissionManager();
```

Native prompt behavior depends on what the platform WebView substrate exposes. Dedicated download hooks now exist, so standard silent downloads are supported, but current Wry WebKit/WebView2 hooks still do not expose a stable all-permission decision callback. Browser-engine grants outside the dedicated download path remain typed unsupported until OpenTray owns that substrate hook, and `multipleDownloads: { decision: "prompt" }` currently fails closed instead of rendering a download-specific prompt UI.

When enabled, the page receives:

- `navigator.window`
- `navigator.opentrayWindow`
- `navigator.screen`
- `navigator.opentrayScreen`
- `navigator.opentray.tray`
- `navigator.opentrayPermissions` when `permissionManagerPolicy` allows the current source
- optional `window.close()` / `window.moveTo()` / `window.resizeTo()` overrides when `bindWindowGlobals` is `true`
- optional `window.getScreenDetails()` override when `bindScreenGlobals` is `true`
- `navigator.opentrayWindow.overlay` when `windowControlsOverlay` is `true`

The injected capability follows a typed facade, with a raw `invoke(cmd, payload)` escape hatch for parity with the private bridge:

- `await navigator.window.getCapabilities()`
- `await navigator.window.listen("resized", handler)`
- `await navigator.window.show()` and `await navigator.window.hide()` to control visibility without replacing content
- `await navigator.window.isClosed()`, `isVisible()`, and `toVisible()` for operational tray visibility
- `await navigator.window.resizeTo(520, 320)`
- `await navigator.window.minimize()`, `maximize()`, and `restore()`
- `await navigator.window.getWindowState()`, `isMaximized()`, and `isMinimized()`
- `await navigator.window.setStyle({ frameless: true, opacity: 0.82, platform: { macos: { cornerRadius: 18 } } })`
- `await navigator.window.devtools.open()`, `close()`, and `isOpen()` when the session was created with `devtools: true`
- `await navigator.opentrayWindow.overlay.getTitlebarAreaRect()`
- `await navigator.opentrayWindow.startAppRegionDrag()`
- `await navigator.window.setTitle("OpenTray Status")`
- `await navigator.window.setIcon({ type: "href", href: "/favicon.ico" })`
- `await navigator.window.setIcon(null)` to clear the logical native icon
- `await navigator.screen.getScreenDetails()`
- `await navigator.opentray.tray.getBounds()`
- `await navigator.window.invoke("getCapabilities")` when a page intentionally wants raw command parity

From the host side, keep the lifecycle verbs explicit:

- `await webview.show({ ... })` to create-or-show the tray session
- `await webview.show()` to restore an already-created session without resetting page, size, style, or native bridge state
- `await webview.hide()` to hide without destroying the page runtime
- `await webview.close()` to close/hide the retained session, or `await webview.toVisible()` to reveal or restore it
- `await webview.isClosed()` / `await webview.isVisible()` when a tray menu needs one operational Show/Hide predicate
- `await webview.setContent({ type: "setContent", html })` to replace local HTML content explicitly
- `await webview.navigate("https://example.com/status")` as the URL-focused content replacement alias
- `await webview.resizeTo(360, 240)` and `await webview.moveTo(10, 20)` for host-owned geometry changes
- `await webview.devtools.open()`, `close()`, and `isOpen()` for the instance-owned devtools channel when `devtools: true` was declared before the first show
- `await webview.destroy()` to destroy the tray-scoped session

`devtools` is a WebView creation setting, not a late-bound toggle. Set `devtools: true` on the first `show({ ... })` / `createWebviewWindow({ ... })` if that session should admit inspector commands. Repeated `show()` does not rebuild the underlying WebView, so changing `devtools` later requires `destroy()` and a fresh show. Read `getCapabilities()` before showing close/state UI: macOS can expose open/close/state, while Windows currently exposes open only. Release builds still compile the native inspector API; windows that omit `devtools: true` keep devtools unavailable by default. Wry does not expose a cross-platform native switch for hiding only the DevTools context-menu item while preserving normal page/input context menus.

For common placement, use `WebviewPlacementKit` rather than a special panel API:

```ts
import { WebviewExt, WebviewPlacementKit } from "@opentray/ext-webview";

const tray = (await createTray(options)).extend(WebviewExt);
const panel = tray.createWebviewWindow({
  html,
  width: 328,
  height: 244,
  nativeWindowApi: true,
});

await panel.show();
const placementWatch = await new WebviewPlacementKit({ tray }).watch(panel, {
  placement: "tray",
  width: 328,
  height: 244,
  placementMargin: 8,
});
```

Supported placements include `tray`, `cursor`, `screen-center`, the four screen edges, the four screen corners, and edge-snapping modes such as `edge`, `edge-x`, and `edge-y`. `watch()` keeps placement continuous as tray, screen, target size, or margin inputs change, but it waits for the live bounds to settle before applying a new native placement so user drag/resize wins while interaction is in flight. For tray placement, transient zero-size or off-screen tray bounds are rejected; when a previous valid tray anchor exists, the kit uses that last-good anchor instead of moving the window to a portable fallback. `applyOnce()` is available for deliberate one-shot placement, while `apply()` aliases the continuous `watch()` path. The result reports `kind` and `source` so callers can distinguish native geometry, `last-good` recovery, and portable fallback.

Window, screen, and tray `Rect` values exposed by OpenTray use desktop logical pixels. `WebviewPlacementKit`, `styleKit`, `mediaQueryKit`, `moveTo`, `resizeTo`, `getBounds`, and `getScreenDetails` all share that coordinate system. Do not apply `devicePixelRatio` correction in host placement code; native runtimes handle physical-pixel conversion at their platform boundary. Overlay titlebar geometry is the separate page-layout API and is converted to CSS pixels by the injected bridge.

Current native support:

- macOS: `close`, `moveTo`, `resizeTo`, `getCapabilities`, `getStyle`, `setStyle`
- macOS: `minimize`, `maximize`, `restore`, `getWindowState`, `isMaximized`, `isMinimized`, and native app-region drag
- macOS: instance-scoped devtools open/close/state through `devtools: true` plus `navigator.window.devtools` / `webview.devtools`
- macOS: `keepOnTop` and common `autoHide`; native blur hides only when `autoHide && !keepOnTop`
- macOS: whole-window opacity through `setStyle({ opacity: 0.82 })`
- macOS: `style.platform.macos.cornerRadius` through layer-backed theme-frame clipping
- macOS: `getTitle`, `setTitle`, `getIcon`, `setIcon`
- macOS: titlebar overlay geometry through `windowControlsOverlay`
- macOS: `navigator.screen.getScreenDetails`
- macOS: tray bounds projection through `navigator.opentray.tray.getBounds()`
- macOS: transparent background and material effects through `style.background`, including `hudWindow`, `sidebar`, `windowBackground`, `contentBackground`, and `underWindowBackground`
- macOS: global override binding through `bindWindowGlobals` and `bindScreenGlobals`
- Windows: visible WebView2-backed windows, lifecycle verbs, content replacement/navigation, `evaluate`, `postMessage`, common window bridge commands, title/icon sync, current-monitor screen snapshot, tray bounds projection, and global override binding through `bindWindowGlobals` / `bindScreenGlobals`
- Windows: `frameless`, `background`, `keepOnTop`, `autoHide`, `opacity`, and `style.platform.windows.cornerPreference`
- Windows: instance-scoped devtools open through `devtools: true`; close/state remain typed unsupported because current Wry/WebView2 does not expose honest runtime state there
- Linux: no official native WebView runtime package is published. An exact-file `artifact` may still be used for private experiments, but the official package treats Linux WebView as unsupported.

Release builds include the native inspector API by default so downstream developers can debug release-mode examples and apps through the explicit host/page API. This does not make every WebView inspectable: the per-window `devtools: true` gate is still required, so ordinary release windows keep devtools unavailable by default.

Keep the unsupported taxonomy explicit:

- runtime absent: no official WebView native package exists for the host platform, or a custom exact-file `artifact` could not be resolved
- platform-family mismatch: a Windows/Linux style family is requested on the macOS runtime, macOS material/corner style is requested on Windows, or a platform-specific family is otherwise requested on the wrong substrate
- declarative gate: the runtime could provide a capability, but the current WebView session did not enable it, such as overlay geometry without `windowControlsOverlay`
- context unavailable: the capability exists, but the current session has no authoritative data, such as tray bounds when no tray anchor was injected

## Authority Model

Keep the capability ownership lines explicit:

- Trusted backend tray geometry is the core-routed capability: `await tray.getBounds()`
- Page tray geometry is the WebView projection of that same tray capability: `await navigator.opentray.tray.getBounds()`
- The page tray API is intentionally a projection, not a second authority. Today it is injected from show-time tray context so the page can anchor layout without keeping a long-lived runtime-host callback alive inside the WebView runtime.
- `navigator.opentrayWindow` and `navigator.opentrayScreen` are extension-owned page APIs. They are not runtime-wide contracts in `opentray-core`.
- `screen` stays in `@opentray/ext-webview` for now because its event model, coordinate-space law, and cross-platform substrate differences are not yet proven shared enough for core.
- The package also exports page-side global typings for `navigator.window`, `navigator.opentrayWindow`, `navigator.opentrayScreen`, `navigator.opentray`, and `window.getScreenDetails()` so TypeScript page code matches the injected runtime shape.

The page bridge does not currently expose maturity labels through `getCapabilities()`. For now, treat README, skills, and the release channel as the authoritative maturity surface.

## Events

Native events are subscription-driven. The extension only pushes page callbacks for events with active listeners; it does not poll or broadcast window state to pages that did not subscribe.

Common event names:

- `stylechange`: emitted after `setStyle(...)` changes the native style state
- `titlechange`: emitted after `setTitle(...)` or enabled document-title sync changes native title state
- `iconchange`: emitted after `setIcon(...)` or enabled favicon sync changes native icon state
- `windowstatechange`: emitted after page visibility and standard state commands
- `visibleChange`: emitted only when operational visibility changes between visible and closed/hidden or minimized, including native auto-hide
- `moved` / `resized`: emitted after extension-owned move or resize requests
- `overlay.geometrychange`: emitted through `navigator.opentrayWindow.overlay.listen("geometrychange", ...)`

For favicon-to-native-icon projection, prefer a materialized PNG data URL such as a `canvas.toDataURL("image/png")` result. URL-backed or SVG favicons may remain logical icon state when the platform cannot convert them into a native image handle.

Native tray-window dismissal defaults to this state machine:

```text
native blur
  +-- autoHide: false -> remain visible
  +-- keepOnTop: true -> remain visible
  `-- otherwise      -> hide retained session -> visibleChange(false)
```

Use `autoHide: false` when the application owns a page exit animation, a protected confirmation flow, or a diagnostic window that must remain visible while DevTools has focus.

## Window Recipes

Native framed window:

```ts
await webview.show({
  type: "show",
  html,
  width: 420,
  height: 260,
  title: "Status",
  nativeWindowApi: true,
});
```

Overlay titlebar:

```ts
await webview.show({
  type: "show",
  html,
  width: 680,
  height: 420,
  nativeWindowApi: true,
  windowControlsOverlay: {
    backgroundColor: "#0F6CBD",
    symbolColor: "#FFFFFF",
  },
  style: {
    background: { kind: "semantic", token: "blur" },
  },
});
```

`windowControlsOverlay: true` remains the system-color form. On Windows, the object form
accepts opaque `#RRGGBB` colors for the native minimize/maximize/close control cluster. macOS
keeps its native transparent controls and accepts the same declaration without emulating opaque
Windows buttons. The overlay safe area always comes from native titlebar insets; do not estimate
its width from a fixed caption-button count.

In the page, use overlay geometry to avoid native window controls and start native dragging from your custom titlebar:

```ts
const pageWindow = navigator.opentrayWindow;
const rect = await pageWindow.overlay?.getTitlebarAreaRect();
customTitlebar.style.paddingLeft = `${rect?.x ?? 0}px`;
customTitlebar.addEventListener("pointerdown", () => {
  void pageWindow.startAppRegionDrag();
});
```

Borderless glass shell:

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
    resizable: true,
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

In borderless mode, render your own controls and keep them synchronized with native state:

```ts
const pageWindow = navigator.opentrayWindow;
await pageWindow.listen("windowstatechange", ({ payload }) => {
  maximizeButton.toggleAttribute("data-active", payload.maximized);
});

minimizeButton.onclick = () => void pageWindow.minimize();
maximizeButton.onclick = () => void pageWindow.maximize();
restoreButton.onclick = () => void pageWindow.restore();
```

## Screen-Aware Recipes

Screen details follow the `window.getScreenDetails()` mental model:

```ts
const details = await navigator.opentrayScreen.getScreenDetails();
const screen = details.currentScreen ?? details.screens[0];
```

Pin a small widget to a visible screen corner:

```ts
const margin = 16;
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
await navigator.opentrayWindow.resizeTo(320, 180);
await navigator.opentrayWindow.moveTo(
  screen.visibleFrame.x + screen.visibleFrame.width - 320 - margin,
  screen.visibleFrame.y + margin
);
```

Desktop pets and small companion widgets usually use the same corner-pinned shell, but update their page animation independently from native window movement. Island-like live information streams usually start at the top-center of `visibleFrame`, stay `keepOnTop`, and listen for `resized` / `windowstatechange` only when they need to recompute layout.

## Tray-Anchored Panel Recipe

Use tray bounds when a tray click should open a WebView-owned custom panel instead of a guessed popup:

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

Inside the page, use the same tray capability family when the HTML layout needs to align an arrow, animation origin, or edge treatment with the tray anchor:

```ts
const trayBounds = await navigator.opentray.tray.getBounds();
if (trayBounds.rect) {
  panel.dataset.anchorX = String(trayBounds.rect.x + trayBounds.rect.width / 2);
}
```

For a full runnable example that also folds in `primaryEvent`, `navigator.opentrayScreen.getScreenDetails()`, `frameless`, material background, and `keepOnTop`, run:

```bash
cargo build -p opentray-bin -p opentray-ext-webview
pnpm --filter opentray example:tray-panel
```

Inside the repo on macOS and Windows, that debug-runtime example automatically points the source-tree runtime host at the freshly built local WebView dynamic library when `OPENTRAY_EXT_PATH` is not already set, so manual tray-panel iteration does not depend on staging platform packages first.
