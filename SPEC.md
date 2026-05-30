# OpenTray Specification

> **For Claude:** This is the authoritative specification for the OpenTray project. All implementation decisions should reference this document.

**Goal:** Build a cross-platform Desktop Status Platform that lets any Node.js application publish lightweight desktop status surfaces — from basic menus to rich popups and platform-specific advanced APIs — via a single `npm install`.

**License:** MIT

**Architecture:** A Rust broker owns physical OS tray entries. Node/Deno/Bun clients publish `Tray` contributions to broker-owned `Surface`s over newline-delimited JSON-RPC. Extensions are loaded as dynamic shared libraries (.so/.dylib/.dll) into the broker process when a surface needs native capabilities.

**Tech Stack:** Rust (tray-icon, ksni, objc2, windows-sys, zbus), TypeScript (ESM/CJS dual, strict mode), npm per-platform packages.

---

## 1. Project Structure

```
opentray/
├── SPEC.md                        # This document
├── HANDOFF.md                     # Context for new development sessions
│
├── crates/
│   ├── opentray-spec/             # Shared types, protocol definitions, C ABI
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── protocol.rs        # JSON-RPC message types (serde)
│   │   │   ├── menu.rs            # MenuItem, Menu types
│   │   │   ├── event.rs           # TrayEvent types
│   │   │   ├── icon.rs            # Icon types (RGBA, file path, base64)
│   │   │   └── ext.rs             # Extension C ABI interface
│   │   └── Cargo.toml
│   │
│   ├── opentray-core/             # Surface broker, tray contributions, extension loader
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── surface.rs         # Surface registry, SurfaceRef, aggregation rules
│   │   │   ├── tray.rs            # Tray contribution model, TrayHandle
│   │   │   ├── lease.rs           # Client lease lifecycle and cleanup
│   │   │   ├── ext_loader.rs      # Dynamic library loading (libloading)
│   │   │   └── ext_context.rs     # ExtContext (C ABI safe wrappers)
│   │   └── Cargo.toml
│   │
│   ├── opentray-darwin/           # macOS: NSStatusItem via objc2
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   │
│   ├── opentray-windows/          # Windows: Shell_NotifyIcon via windows-sys
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   │
│   ├── opentray-linux/            # Linux: SNI + DbusMenu via ksni/zbus
│   │   ├── src/lib.rs
│   │   └── Cargo.toml
│   │
│   └── opentray-bin/              # CLI binary entry point
│       ├── src/main.rs            # Broker CLI, auto-start entry, debug stdio mode
│       ├── src/transport.rs       # Unix socket / Named Pipe / stdio transports
│       └── Cargo.toml
│
├── extensions/                    # Official extensions (separate Cargo projects)
│   └── opentray-ext-webview/      # Layer 1: Rich popup via WebView
│       ├── src/lib.rs             # Compiled as .dylib/.so/.dll
│       └── Cargo.toml
│
├── packages/
│   ├── cli/                       # npm: opentray
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── surface.ts         # Surface creation, defaultSurface resolution, env propagation
│   │   │   ├── tray.ts            # createTray(), TrayHandle
│   │   │   ├── protocol.ts        # JSON-RPC types
│   │   │   ├── transport.ts       # Broker discovery, auto-start, socket/pipe client
│   │   │   ├── binary.ts          # Binary path resolution, permissions, broker spawn
│   │   │   └── ext.ts             # Extension discovery and loading
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── spec/                      # npm: @opentray/spec
│   ├── ext-webview/               # npm: @opentray/ext-webview
│   ├── ext-badge/                 # npm: @opentray/ext-badge
│   ├── ext-island/                # npm: @opentray/ext-island
│   ├── darwin-arm64/              # npm: @opentray/darwin-arm64
│   ├── darwin-x64/                # npm: @opentray/darwin-x64
│   ├── windows-arm64/             # npm: @opentray/windows-arm64
│   ├── windows-x64/               # npm: @opentray/windows-x64
│   ├── linux-arm64/               # npm: @opentray/linux-arm64
│   └── linux-x64/                 # npm: @opentray/linux-x64
│
├── .github/workflows/
│   └── build.yml                  # Cross-compile + release for 6 targets
│
├── Cargo.toml                     # Workspace root
└── rust-toolchain.toml
```

---

## 2. Core API (Layer 0)

Layer 0 is not "one process owns one tray icon". The platform law is:

```
Surface = a broker-owned desktop entry and aggregation boundary
Tray    = a client-owned status contribution mounted onto a Surface
Lease   = the lifecycle contract that removes a Tray when its client exits
```

This is the core distinction that makes OpenTray useful for CLI and AI-skill ecosystems: many processes can contribute status without creating unbounded tray icons, while any developer can still create an independent surface when their product needs one.

### 2.1 Surface Model

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceOptions {
    /// Stable namespace for this surface owner, e.g. "com.example.agent".
    pub app_id: String,
    /// Optional display title for the physical tray entry.
    pub title: Option<String>,
    /// Optional icon for the physical tray entry.
    pub icon: Option<Icon>,
    /// If true, this surface becomes the default target in the current client process.
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceRef {
    /// Broker-issued stable id. It must be serializable for env propagation.
    pub surface_id: String,
    /// Owner namespace used for discovery and conflict isolation.
    pub app_id: String,
}
```

**Surface laws:**

1. A `Surface` owns exactly one physical OS tray entry.
2. A `Surface` can aggregate zero, one, or many `Tray` contributions.
3. Multiple surfaces may exist at the same time; they are isolated by `surface_id` and `app_id`.
4. `createSurface({ appId, default: true })` only changes the current process default unless the returned `SurfaceRef` is explicitly propagated.
5. Cross-process default propagation uses `OPENTRAY_SURFACE`; it does not mutate already-running processes.

**Default surface resolution order:**

1. Explicit `surface` argument passed to `createTray`.
2. `OPENTRAY_SURFACE` environment variable.
3. Process-local default set by `createSurface({ default: true })`.
4. Broker user default.
5. Built-in OpenTray default surface.

### 2.2 Surface Aggregation Rules

By default, a surface renders each mounted tray contribution as an isolated submenu. This keeps third-party CLI tools and skill extensions from polluting the surface owner's top-level menu.

```text
Agent Surface
├── Notifications Skill
│   ├── Open
│   └── Clear
├── Git Skill
│   ├── Commit
│   └── Sync
└── Surface Settings
```

**Aggregation laws:**

1. A non-owner tray contribution is rendered as a top-level submenu titled by its `title` or `app_id`.
2. Only the surface owner can define a custom top-level layout for the surface.
3. A surface owner may opt a trusted tray into a custom region by explicit `tray_id` or capability grant.
4. A tray contribution never receives events from another tray contribution.
5. A tray contribution can update only its own menu, icon, tooltip, popup, and extension state.

### 2.3 Tray Contribution Model

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayOptions {
    /// Stable id inside the target surface. Generated when omitted.
    pub tray_id: Option<String>,
    /// Stable namespace for the contributing CLI/skill/app.
    pub app_id: Option<String>,
    pub title: Option<String>,
    pub tooltip: Option<Tooltip>,
    pub icon: Icon,
    pub menu: Option<Menu>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tooltip {
    pub title: String,
    pub description: String,
}
```

**Tray laws:**

1. A `Tray` is a contribution, not a physical tray icon.
2. A `Tray` is mounted onto exactly one `Surface`.
3. Client process death or stdin disconnect releases its lease and removes its tray contribution.
4. Menu item ids are scoped to `(surface_id, tray_id)` so independent clients cannot collide.
5. Events are routed back only to the client lease that owns the target tray.

### 2.4 Broker Auto-Start and Standalone Fallback

The npm package makes the broker nearly invisible to developers:

1. `createSurface()` and `createTray()` first try to connect to the user-level broker.
2. If no broker is listening, the package starts `opentray broker` in the background.
3. If `OPENTRAY_NO_BROKER=1`, the package starts an in-process standalone broker for the current process only.
4. Standalone mode is a fallback and test/debug tool; shared surfaces across independent processes require the user-level broker.
5. Broker startup must be idempotent. Concurrent clients racing to start the broker must converge to one live broker.

### 2.5 Permission and Capability Model

`OPENTRAY_SURFACE` selects the target surface; it is not a permission token.

**Permission laws:**

1. Every client connection has a lease id owned by the broker.
2. Every tray contribution is scoped to `(lease_id, surface_id, tray_id)`.
3. `app_id` is identity metadata for discovery, grouping, and policy; it is not sufficient authority.
4. Sensitive actions, such as top-level layout injection or native platform APIs, require an explicit capability grant.
5. Capability grants are represented as broker-issued tokens or persisted broker policy; env selection alone cannot grant them.

Initial P0 may ship with only default isolation and no user-facing grant UI. The protocol must still reserve capability fields so P1/P2 do not need a breaking redesign.

### 2.6 Rust Trait Interface

```rust
/// Platform-agnostic physical surface backend. Each platform crate implements this.
pub trait SurfaceBackend: Send + Sync + 'static {
    fn set_icon(&self, icon: &Icon) -> Result<()>;
    fn set_tooltip(&self, title: &str, description: &str) -> Result<()>;
    fn set_title(&self, title: &str) -> Result<()>;
    fn set_menu(&self, menu: &Menu) -> Result<()>;
    fn set_visible(&self, visible: bool) -> Result<()>;
    fn rect(&self) -> Result<Rect>;

    /// Platform-specific: show native menu at position
    fn show_menu_at(&self, x: i32, y: i32) -> Result<()>;

    /// Return platform-specific event receiver
    fn events(&self) -> crossbeam_channel::Receiver<TrayEvent>;
}
```

### 2.7 Menu Model

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MenuItem {
    Item {
        id: u32,
        title: String,
        #[serde(default = "default_true")]
        enabled: bool,
        shortcut: Option<String>,
    },
    Check {
        id: u32,
        title: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        checked: bool,
    },
    Radio {
        id: u32,
        title: String,
        #[serde(default = "default_true")]
        enabled: bool,
        #[serde(default)]
        checked: bool,
        group: u32,
    },
    Separator,
    Submenu {
        title: String,
        #[serde(default = "default_true")]
        enabled: bool,
        items: Vec<MenuItem>,
    },
}
```

### 2.8 Event Model

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TrayEvent {
    Ready { surface_id: String },
    MenuClick { surface_id: String, tray_id: String, item_id: u32 },
    TrayClick { surface_id: String, button: MouseButton, x: i32, y: i32 },
    TrayDoubleClick { surface_id: String, button: MouseButton, x: i32, y: i32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton { Left, Right, Middle }
```

### 2.9 Icon Model

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Icon {
    /// Raw RGBA pixel data
    Rgba { data: Vec<u8>, width: u32, height: u32 },
    /// PNG/JPEG encoded bytes
    Encoded { data: Vec<u8> },
    /// File system path
    File { path: String },
}
```

---

## 3. Broker Transport and JSON-RPC Protocol

### 3.1 Transport Model

The protocol payload is always newline-delimited JSON-RPC, but the transport depends on mode:

| Mode | Transport | Purpose |
|------|-----------|---------|
| User broker (macOS/Linux) | Unix domain socket | Multi-process shared surfaces |
| User broker (Windows) | Named Pipe | Multi-process shared surfaces |
| Explicit broker process | stdin/stdout | Debugging, tests, and embedded host control |
| Standalone fallback | in-process channel | `OPENTRAY_NO_BROKER=1`, tests, single-process tools |

The Node package hides transport selection. Developers call `createSurface()` or `createTray()`; the package resolves, starts, or embeds the broker as needed.

### 3.2 Wire Format

- Newline-delimited JSON (`\n` separator)
- One JSON object per line
- **stderr** for debug logging in process modes (never mixed into protocol frames)
- Protocol version field in init message
- Socket/pipe paths are discovered from platform config/runtime dirs and can be overridden with `OPENTRAY_BROKER_ENDPOINT`.

### 3.3 Node → Rust

```jsonc
// Initialize client session
{"type": "init", "version": 1}

// Surface management
{"type": "create-surface", "appId": "com.example.agent", "title": "Agent", "icon": {...}, "default": true}
{"type": "resolve-default-surface"}

// Tray contribution management
{"type": "create-tray", "surface": {"surfaceId": "...", "appId": "com.example.agent"}, "tray": {"icon": {...}, "title": "...", "menu": {...}}}
{"type": "destroy-tray", "surfaceId": "...", "trayId": "..."}

// Dynamic updates
{"type": "set-tray-menu", "surfaceId": "...", "trayId": "...", "menu": {...}}
{"type": "set-tray-icon", "surfaceId": "...", "trayId": "...", "icon": {...}}
{"type": "set-tray-tooltip", "surfaceId": "...", "trayId": "...", "title": "...", "description": "..."}
{"type": "set-surface-title", "surfaceId": "...", "title": "..."}
{"type": "set-surface-icon", "surfaceId": "...", "icon": {...}}
{"type": "set-surface-visible", "surfaceId": "...", "visible": true}
{"type": "show-surface-menu", "surfaceId": "...", "x": 100, "y": 200}

// Extension management
{"type": "load-ext", "surfaceId": "...", "name": "webview", "path": "/path/to/ext.dylib"}
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {...}}
{"type": "unload-ext", "surfaceId": "...", "name": "webview"}

// Shutdown
{"type": "exit"}
```

### 3.4 Rust → Node

```jsonc
{"type": "ready", "version": 1}
{"type": "surface-created", "surface": {"surfaceId": "...", "appId": "com.example.agent"}}
{"type": "default-surface", "surface": {"surfaceId": "...", "appId": "com.example.agent"}}
{"type": "tray-created", "surfaceId": "...", "trayId": "..."}
{"type": "event", "event": {"type": "menuClick", "surfaceId": "...", "trayId": "...", "itemId": 1}}
{"type": "event", "event": {"type": "trayClick", "surfaceId": "...", "button": "left", "x": 100, "y": 200}}
{"type": "event", "event": {"type": "trayDoubleClick", "surfaceId": "...", "button": "left", "x": 100, "y": 200}}
{"type": "ext-event", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {...}}
{"type": "error", "message": "..."}
```

### 3.5 Error Handling Rules

1. **Every protocol frame from Rust must be valid JSON.** Non-JSON goes to stderr only in process modes.
2. **Node side wraps `JSON.parse` in try/catch.** Never crash on malformed input.
3. **Protocol version mismatch** → Rust sends `{"type": "error", "message": "version mismatch"}` and exits gracefully.
4. **Rust broker crash** → Node detects via process exit or socket disconnect, not via stdout.
5. **Client disconnect** → broker releases every tray lease owned by that client.
6. **Reconnect** → client republishes idempotent surface/tray declarations using stable `app_id` and optional `tray_id`.

---

## 4. Platform Implementations

### 4.1 macOS (`opentray-darwin`)

**Reference:** tray-icon crate (tauri-apps/tray-icon) macOS implementation

| Component | API | Notes |
|-----------|-----|-------|
| Tray icon | `NSStatusItem` via `objc2` | Supports template icon (auto dark/light) |
| Menu | `NSMenu` / `NSMenuItem` via `objc2-app-kit` | Submenu, separator, checkmark native |
| Click events | `NSStatusItem.button` action selector | Left/right click via event monitor |
| Icon format | NSImage from RGBA/PNG data | Template icon via `.setIsTemplate(true)` |

**Requirements:**
- `objc2` 0.6, `objc2-app-kit` 0.3, `objc2-foundation` 0.3
- Must run on main thread (`runtime::LockOSThread`)
- CGo equivalent: Objective-C FFI via objc2 (pure Rust, no C compiler needed at build time)

**Size target:** ~2 MB stripped (Release, LTO, panic=abort)

### 4.2 Windows (`opentray-windows`)

**Reference:** tray-icon crate Windows implementation

| Component | API | Notes |
|-----------|-----|-------|
| Tray icon | `Shell_NotifyIconW` (Win32) | Unicode, via `windows-sys` |
| Menu | `CreatePopupMenu` / `InsertMenuItemW` | Native Win32 menu |
| Click events | `WM_USER` callback message | via hidden window `WNDPROC` |
| Icon format | HICON from ICO/PNG bytes | Use `CreateIconFromResourceEx` (no temp file!) |
| Explorer restart | `RegisterWindowMessage("TaskbarCreated")` | Re-register icon on explorer crash |

**Critical fixes vs tray-icon:**
- **No temp file for icons** — use `CreateIconFromResourceEx` from memory, not `LoadImage` from temp file
- **DPI awareness** — call `SetProcessDpiAwarenessContext` or manifest it
- **Graceful cleanup** — call `Shell_NotifyIcon(NIM_DELETE)` on exit to prevent ghost icon
- **Resource cleanup** — `DestroyIcon`, `DestroyMenu`, `DeleteObject` in `Drop` implementations

**Requirements:**
- `windows-sys` 0.60+ (no C dependencies)

**Size target:** ~1.5 MB stripped

### 4.3 Linux (`opentray-linux`)

**Reference:** ksni crate (iovxw/ksni) — SNI + DbusMenu implementation

| Component | API | Notes |
|-----------|-----|-------|
| Tray icon | `org.kde.StatusNotifierItem` via `zbus` | Pure Rust D-Bus, no GTK |
| Menu | `com.canonical.dbusmenu` via `zbus` | Full protocol: GetLayout, Event, ItemsPropertiesUpdated |
| Click events | SNI `Activate(x,y)` + `SecondaryActivate(x,y)` | Left and middle click |
| Icon format | ARGB pixmap via SNI `IconPixmap` property | Convert RGBA→ARGB for D-Bus |
| Registration | `org.kde.StatusNotifierWatcher.RegisterStatusNotifierItem` | Auto-reconnect on tray host restart |

**ksni integration approach:**
- Implement `ksni::Tray` trait on an internal struct
- Adapt ksni's `MenuItem` types from opentray's `MenuItem` model
- Use `ksni::Handle::update()` for dynamic menu/icon updates
- ksni handles D-Bus reconnection and signal emission automatically

**ksni DbusMenu capabilities confirmed (95/100 score):**
- All 7 DbusMenu methods fully implemented
- Full menu types: StandardItem, CheckmarkItem, RadioGroup (auto-exclusive), Separator, SubMenu
- Properties: label, enabled, toggle-type, toggle-state, shortcut, visible, icon-name, icon-data
- Automatic `ItemsPropertiesUpdated` signal emission via hash-based property diffing
- `LayoutUpdated` signal with proper revision tracking

**Requirements:**
- `ksni` 0.3.4 (MIT license, pure Rust, zbus 5 D-Bus)
- Zero system dependencies (no GTK, no libappindicator)

**Size target:** ~2 MB stripped

**Wayland support:** Works on Wayland (SNI is D-Bus protocol, display-server-agnostic), requires a tray host like KDE Plasma, swaybar, or waybar with SNI support.

---

## 5. Extension System

### 5.1 Architecture

Extensions are **dynamically loaded shared libraries** (.so/.dylib/.dll) running in the **same process** as the broker. Extensions attach to surfaces, not directly to arbitrary client processes.

```
opentray broker
  ├── Surface registry (Layer 0)
  ├── Physical surface backends (tray-icon + ksni)
  └── libloading::Library::new("opentray_ext_webview")
       └── Runs in same process, shares surface handles
```

### 5.2 C ABI Interface (ABI stability)

Rust ABI is not stable. The extension interface MUST use `extern "C"` for cross-version compatibility.

```rust
// opentray-spec/src/ext.rs

/// Opaque context handle. Extension can only access through C ABI functions.
#[repr(C)]
pub struct ExtContext {
    /// Version of the extension API
    pub api_version: u32,
    /// Surface id this extension instance is attached to.
    pub surface_id: *const c_char,
    /// Send a JSON command to the core
    pub send_command: extern "C" fn(cmd_json: *const c_char, cmd_len: u32) -> i32,
    /// Get physical surface rect (x, y, width, height)
    pub get_rect: extern "C" fn(out: *mut Rect) -> i32,
    /// Subscribe to surface events
    pub on_event: extern "C" fn(callback: extern "C" fn(event_json: *const c_char, len: u32)),
}

/// Every extension must export this symbol.
#[no_mangle]
pub extern "C" fn opentray_ext_init(ctx: *const ExtContext) -> i32;

/// Every extension must export this symbol.
#[no_mangle]
pub extern "C" fn opentray_ext_command(cmd_json: *const c_char, cmd_len: u32) -> i32;

/// Every extension must export this symbol.
#[no_mangle]
pub extern "C" fn opentray_ext_deinit() -> i32;
```

### 5.3 Extension Discovery

```bash
# CLI commands manage the user-level broker and extensions
opentray broker             # Runs the broker explicitly
opentray surface list       # Lists broker-owned surfaces
opentray ext:webview        # Loads opentray_ext_webview.{so,dylib,dll} for a surface
opentray ext:badge          # Loads opentray_ext_badge.{so,dylib,dll} for a surface

# Full form for disambiguation
opentray ext --surface=<surface-id> --use=webview
```

**Discovery order:**
1. Adjacent to binary: `./extensions/opentray_ext_{name}.{so,dylib,dll}`
2. Platform config dir: `~/.config/opentray/extensions/` (Linux), `~/Library/Application Support/opentray/extensions/` (macOS), `%APPDATA%/opentray/extensions/` (Windows)
3. `OPENTRAY_EXT_PATH` environment variable

### 5.4 Extension npm Packages

```
@opentray/ext-webview
  ├── package.json           # "name": "@opentray/ext-webview"
  ├── platforms/
  │   ├── darwin-arm64.opentray_ext_webview.dylib
  │   ├── darwin-x64.opentray_ext_webview.dylib
  │   ├── windows-x64.opentray_ext_webview.dll
  │   ├── windows-arm64.opentray_ext_webview.dll
  │   ├── linux-x64.opentray_ext_webview.so
  │   └── linux-arm64.opentray_ext_webview.so
  └── install.js             # postinstall: copy dylib to opentray extensions dir
```

```json
// opentray npm package (packages/cli) detects extensions
{
  "name": "opentray",
  "peerDependencies": {
    "@opentray/ext-webview": "optional"
  }
}
```

---

## 6. Extension Specifications

### 6.1 @opentray/ext-webview (Layer 1: Rich Popup)

**Purpose:** Show a borderless WebView window anchored to a surface's physical tray entry.

| Platform | Implementation | WebView Engine |
|----------|---------------|----------------|
| macOS | NSPopover + WKWebView | System built-in (0 MB) |
| Windows | Borderless window + WebView2 | System built-in on Win10+ (0 MB) |
| Linux | Borderless window + wry/WebKitGTK | WebKitGTK (~50 MB, system package) |

**Protocol additions:**

```jsonc
// Node → Rust
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {
  "type": "show", "html": "<div>Hello</div>", "width": 360, "height": 480
}}
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {"type": "hide"}}
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {"type": "navigate", "url": "https://..."}}
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {"type": "evaluate", "js": "..."}}

// Rust → Node
{"type": "ext-event", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {"type": "message", "payload": {...}}}
{"type": "ext-event", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {"type": "shown"}}
{"type": "ext-event", "surfaceId": "...", "trayId": "...", "ext": "webview", "data": {"type": "hidden"}}
```

**Positioning logic:**
- macOS: Use `NSPopover.show(relativeTo:of:preferredEdge:)` — automatic
- Windows: Use `Shell_NotifyIconGetRect` or `GetCursorPos` + calculate based on taskbar position (top/bottom/left/right)
- Linux: Use D-Bus `Geometry` signal from SNI, or fallback to `GetCursorPos` equivalent

**Features:**
- Show/hide toggle on tray click
- Auto-close on focus loss
- Dark/light mode detection (match system theme)
- Custom HTML/CSS/JS content
- Bi-directional messaging between WebView JS and Node.js

### 6.2 @opentray/ext-badge (Layer 2: Platform APIs)

**Purpose:** Access platform-specific tray/taskbar advanced features.

| Platform | Features |
|----------|----------|
| Windows | `ITaskbarList3`: progress bar, overlay icon, thumbnail toolbar, Jump List |
| macOS | Dock badge count, template icon, dynamic icon generation |
| Linux | SNI `Status` property (Active/Passive/NeedsAttention), `Title` property |

**Protocol additions:**

```jsonc
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "badge", "data": {"type": "set-count", "count": 5}}
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "badge", "data": {"type": "set-progress", "value": 0.7, "state": "normal"}}
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "badge", "data": {"type": "set-overlay", "icon": {...}}}
{"type": "ext-command", "surfaceId": "...", "trayId": "...", "ext": "badge", "data": {"type": "set-jump-list", "items": [...]}}
```

### 6.3 @opentray/ext-island (Layer 3: Dynamic Island — Roadmap)

**Purpose:** Compact↔expanded state transitions with animation, inspired by iPhone Dynamic Island and macOS Live Activities.

**Status:** Research phase. Depends on platform API availability:
- macOS: Live Activities in macOS 26 Tahoe (announced WWDC 2025)
- Windows: No native equivalent
- Linux: No native equivalent

---

## 7. Node.js TypeScript API

### 7.1 Core Usage

```typescript
import * as opentray from 'opentray'

// Optional: create an independent aggregate surface and make it the process default.
const surface = await opentray.createSurface({
  appId: 'com.example.agent',
  title: 'Agent',
  icon: Buffer.from(surfaceIconBase64, 'base64'),
  default: true,
})

// Optional: pass this env to child CLI processes so their defaultSurface resolves here.
const childEnv = surface.withEnv(process.env)

// Default: mounts onto opentray.defaultSurface.
const tray = await opentray.createTray({
  appId: 'com.example.agent.skill.notifications',
  icon: Buffer.from(base64Png, 'base64'),
  tooltip: { title: 'My App', description: 'Ready' },
  menu: {
    items: [
      { type: 'item', id: 1, title: 'Open', enabled: true },
      { type: 'separator' },
      { type: 'check', id: 2, title: 'Notifications', enabled: true, checked: true },
      { type: 'submenu', title: 'Options', items: [
        { type: 'radio', id: 3, title: 'Light', enabled: true, checked: true, group: 1 },
        { type: 'radio', id: 4, title: 'Dark', enabled: true, checked: false, group: 1 },
      ]},
      { type: 'separator' },
      { type: 'item', id: 99, title: 'Quit', enabled: true },
    ]
  }
})

tray.on('menuClick', ({ itemId }) => {
  if (itemId === 99) tray.dispose()
})

tray.on('trayClick', ({ button }) => {
  console.log(`Tray ${button} clicked`)
})

// Dynamic updates
await tray.setMenu({ items: [...] })
await tray.setIcon(newIconBuffer)
await tray.setTooltip({ title: 'Updated', description: 'Idle' })
await tray.dispose()
```

**Dedicated surface usage:**

```typescript
import * as opentray from 'opentray'

const dedicated = await opentray.createSurface({
  appId: 'com.example.product',
  title: 'Example Product',
  icon: Buffer.from(surfaceIconBase64, 'base64'),
})

const tray = await opentray.createTray({
  appId: 'com.example.product.main',
  icon: Buffer.from(base64Png, 'base64'),
  menu: { items: [...] },
}, dedicated)
```

### 7.2 Extension Usage

```typescript
import * as opentray from 'opentray'
import { WebViewExtension } from '@opentray/ext-webview'

const tray = await opentray.createTray({ ... })
const webview = await tray.loadExtension('webview')

await webview.show({
  html: `<div class="panel">
    <h2>Notifications</h2>
    <button onclick="opentray.send('clear')">Clear</button>
  </div>`,
  width: 360,
  height: 480,
})

webview.on('message', (data) => {
  console.log('WebView says:', data)
})
```

### 7.3 Default Surface API

```typescript
export const defaultSurface: SurfaceRef

export interface SurfaceOptions {
  appId: string
  title?: string
  icon?: IconInput
  /**
   * Sets the process-local default surface. Use `surface.withEnv()` to affect
   * child processes.
   */
  default?: boolean
}

export interface SurfaceRef {
  readonly surfaceId: string
  readonly appId: string
  /**
   * Writes OPENTRAY_SURFACE into an env object so child processes resolve this
   * surface as their default target.
   */
  withEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
}

/**
 * Connects to or auto-starts the user-level broker, creates a surface, and
 * optionally makes it the process-local default surface.
 */
export function createSurface(options: SurfaceOptions): Promise<SurfaceRef>

/**
 * Connects to or auto-starts the user-level broker, resolves the target
 * surface, and publishes a lease-owned tray contribution.
 */
export function createTray(
  options: TrayOptions,
  surface?: SurfaceRef,
): Promise<TrayHandle>
```

### 7.4 Package Design

```json
{
  "name": "opentray",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "bin", "platforms"],
  "scripts": {
    "postinstall": "node dist/postinstall.js"
  },
  "optionalDependencies": {
    "@opentray/darwin-arm64": "0.1.0",
    "@opentray/darwin-x64": "0.1.0",
    "@opentray/windows-arm64": "0.1.0",
    "@opentray/windows-x64": "0.1.0",
    "@opentray/linux-arm64": "0.1.0",
    "@opentray/linux-x64": "0.1.0"
  }
}
```

**TypeScript strict config:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

## 8. Build & Distribution

### 8.1 Rust Build

```toml
# Cargo.toml workspace
[workspace]
members = [
    "crates/opentray-spec",
    "crates/opentray-core",
    "crates/opentray-darwin",
    "crates/opentray-windows",
    "crates/opentray-linux",
    "crates/opentray-bin",
]

[profile.release]
opt-level = "z"
lto = true
strip = true
panic = "abort"
codegen-units = 1
```

### 8.2 Cross-Compilation Matrix

| Target | Runner | Notes |
|--------|--------|-------|
| `x86_64-apple-darwin` | `macos-13` | Intel Mac |
| `aarch64-apple-darwin` | `macos-14` | Apple Silicon (native runner) |
| `x86_64-pc-windows-msvc` | `windows-latest` | |
| `aarch64-pc-windows-msvc` | `windows-latest` | May need `cargo-zigbuild` or native ARM runner |
| `x86_64-unknown-linux-gnu` | `ubuntu-latest` | Static link where possible |
| `aarch64-unknown-linux-gnu` | `ubuntu-latest` | `cross` or `cargo-zigbuild` |

### 8.3 Binary Size Targets

| Platform | Target Size |
|----------|-------------|
| macOS (arm64) | ~1.5 MB |
| macOS (x64) | ~1.5 MB |
| Windows (x64) | ~1.5 MB |
| Windows (arm64) | ~1.5 MB |
| Linux (x64) | ~2 MB (zbus adds weight) |
| Linux (arm64) | ~2 MB |

### 8.4 Postinstall Script

```javascript
// Handles: binary permissions, macOS quarantine, extension discovery
const { execSync } = require('child_process')
const path = require('path')

const binPath = path.join(__dirname, 'bin', 'opentray')
try {
  // Fix execute permission
  execSync(`chmod +x "${binPath}"`)
  // Remove macOS quarantine
  execSync(`xattr -cr "${path.dirname(binPath)}"`, { stdio: 'ignore' })
} catch {}
```

---

## 9. Dependency Inventory

### Rust Dependencies

| Crate | Version | Platforms | License | Purpose |
|-------|---------|-----------|---------|---------|
| `serde` | 1.x | All | MIT/Apache | JSON serialization |
| `serde_json` | 1.x | All | MIT/Apache | JSON-RPC protocol |
| `crossbeam-channel` | 0.5 | All | MIT/Apache | Event channel |
| `libloading` | 0.8 | All | ISC | Extension dynamic loading |
| `objc2` | 0.6 | macOS | MIT | Objective-C bridge |
| `objc2-app-kit` | 0.3 | macOS | MIT | NSStatusItem/NSMenu |
| `objc2-foundation` | 0.3 | macOS | MIT | NSString/NSData |
| `windows-sys` | 0.60 | Windows | MIT/Apache | Win32 API |
| `ksni` | 0.3.4 | Linux | MIT | SNI + DbusMenu |
| `zbus` | 5.x | Linux | MIT | D-Bus (via ksni) |
| `png` | 0.17 | All | MIT | PNG decoding |

**Total system dependencies:** Zero (no GTK, no libappindicator, no CGo)

### Node Dependencies

**Runtime:** None (binary embedded, child_process spawn)

**Dev:** `typescript`, `vitest`, `tsdown` (build)

---

## 10. Key Technical Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Rust | Binary size (1.5-2 MB vs Go 4-6 MB), memory (2-5 MB vs 8-15 MB), zero system deps on Linux |
| Core libraries | tray-icon + ksni | tray-icon: most mature macOS/Win (Tauri-backed, 14M downloads). ksni: only production-grade DbusMenu in Rust (95/100 score) |
| Surface model | Broker-owned surfaces + client tray contributions | Supports shared aggregate entries and dedicated entries without splitting the developer API or duplicating platform backends |
| Surface aggregation | Non-owner trays become isolated submenus by default | Prevents unrelated CLI tools and skill extensions from polluting a surface owner's top-level menu |
| Default surface | Explicit arg > `OPENTRAY_SURFACE` > process default > broker default > built-in default | Lets one developer create an aggregate surface while extensions and child CLIs use `createTray()` with almost no awareness |
| Broker transport | Unix socket / Named Pipe for shared broker; stdio and in-process fallback for debug/tests | Keeps developers unaware of the broker while still supporting multi-process aggregation |
| IPC protocol | Newline-delimited JSON-RPC payloads | Proven pattern (systray-portable), simple, transport-agnostic, easy to debug |
| Auto-start | `createSurface()` / `createTray()` auto-start broker unless `OPENTRAY_NO_BROKER=1` | Preserves near-zero developer ceremony while keeping shared surfaces available across processes |
| Permission model | Env selects target; lease/capability grants authorize mutation | Prevents `OPENTRAY_SURFACE` from becoming an ambient privilege escalation mechanism |
| Extension loading | Dynamic library (libloading) attached to surfaces | Same process, shared surface handles, zero IPC overhead. C ABI for version stability |
| Menu model | Tagged enum (serde) | Type-safe, cross-platform, directly serializable to JSON-RPC |
| License | MIT | All dependencies are MIT or MIT/Apache dual. No Apache-only dependencies |

---

## 11. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| ksni D-Bus on some Linux DEs | Medium | Medium | Test on KDE/GNOME/wlroots; fallback documentation |
| Rust extension ABI breakage | Low | High | C ABI interface; pin MSRV |
| Windows ARM64 cross-compile | Medium | Low | Use native ARM runner if available |
| macOS Gatekeeper blocks binary | High | Medium | postinstall xattr -cr; document code signing |
| WebView not available on headless Linux | Certain | Low | webview extension is optional; core works without it |
| Dynamic library quarantine on macOS | High | Medium | Same postinstall handling as broker binary |
| Broker unavailable or crashed | Medium | High | Node package auto-starts broker; client leases reconnect and republish idempotent tray contributions |
| Surface namespace collision | Medium | Medium | Broker-issued `surface_id`; `app_id` is discovery metadata, not the sole identity |
| Menu aggregation abuse | Medium | Medium | Non-owner trays are isolated submenus unless the surface owner grants layout capability |
| Env-based target spoofing | Medium | Medium | `OPENTRAY_SURFACE` selects only the target; broker lease and capability checks still gate mutations |

---

## 12. Milestones

| Phase | Scope | Duration |
|-------|-------|----------|
| **P0: Core** | Broker, Surface model, Tray contribution leases, Node.js package | 5-7 days |
| **P1: Physical tray** | SurfaceBackend implementations for macOS/Windows/Linux | 4-5 days |
| **P2: Extensions** | Extension loader + ext-webview | 5-7 days |
| **P3: Platform APIs** | ext-badge (progress, overlay, badge) | 3-5 days |
| **P4: Polish** | CI, per-platform npm, docs, tests | 2-3 days |
| **P5: Dynamic Island** | ext-island (research + macOS first) | TBD |
