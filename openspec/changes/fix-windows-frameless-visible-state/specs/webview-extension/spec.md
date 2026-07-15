## ADDED Requirements

### Requirement: WebView visibility SHALL be an operational state projection

`@opentray/ext-webview` SHALL define `visible` as `!closed && !minimized` for an existing native WebView window session. `closed` SHALL mean that the session native window is hidden/not projected, not that `destroy()` has torn down the session. Raw platform visibility alone SHALL NOT be exposed as this public `visible` projection.

The host `WebviewWindowHandle` and the page `navigator.opentrayWindow` / enabled `navigator.window` facade SHALL expose `isClosed(): Promise<boolean>`, `isVisible(): Promise<boolean>`, and `toVisible(): Promise<void>`. `toVisible()` SHALL show a closed/hidden session, restore a minimized session, and be idempotent when the session is already visible. It SHALL NOT replace content, recreate the session, or act as a general boolean setter.

`WebviewWindowState.visible` SHALL use this same operational projection. The extension SHALL expose a typed `visibleChange` event with payload `{ visible: boolean }`; it SHALL emit only when that projection changes.

#### Scenario: A tray host restores a minimized window without branching on native state

- **GIVEN** a tray host owns an existing `WebviewWindowHandle`
- **AND** its native window is minimized
- **WHEN** the host calls `isVisible()` and then `toVisible()`
- **THEN** `isVisible()` resolves `false`
- **AND** the native session is restored without recreation
- **AND** a `visibleChange` event reports `{ visible: true }`.

#### Scenario: A page reveals a hidden window idempotently

- **GIVEN** a page has the native window API enabled
- **AND** its native window is hidden by `close()` or `hide()`
- **WHEN** it calls `toVisible()` twice
- **THEN** the first call shows the existing session
- **AND** the second call does not introduce another state transition
- **AND** exactly one `visibleChange` event reports `{ visible: true }`.

### Requirement: Visibility capability SHALL remain extension-owned and platform-aligned

Visibility commands, state projection, and page bridge injection SHALL remain inside the WebView extension atom. The Rust command parser, Windows projection, macOS projection, TypeScript facade, and browser-global typing SHALL accept the same `isClosed`, `isVisible`, and `toVisible` contract. `opentray-core` and the generic broker SHALL NOT branch on WebView visibility commands.

#### Scenario: Host and page use one extension contract

- **GIVEN** a consumer uses either `WebviewWindowHandle` or `navigator.opentrayWindow`
- **WHEN** it queries or restores operational visibility
- **THEN** each path reaches the same extension-owned command family
- **AND** no generic tray/runtime API is introduced for WebView window visibility.

### Requirement: Windows frameless projection SHALL own every non-client calculation

For a Windows WebView whose effective style is frameless, every `WM_NCCALCSIZE` path SHALL expose the full host rectangle as client area. The result SHALL NOT depend on the message `wParam` form. Frameless style projection SHALL continue to remove `WS_THICKFRAME` and disable DWM non-client rendering.

The host SHALL apply its DWM non-client policy and DWM client-surface attributes before its final `SetWindowPos(..., SWP_FRAMECHANGED, ...)` recalculation. That recalculation SHALL preserve z-order, position, size, and shell visibility state. The host SHALL NOT depend on a synthetic resize, minimize, restore, hide/show, or window rebuild to remove native titlebar pixels.

#### Scenario: A frameless window survives a non-client recalculation

- **GIVEN** a Windows WebView window has `style.frameless: true`
- **WHEN** Win32 recalculates non-client geometry during style, resize, minimize, or restore handling
- **THEN** the native titlebar/frame is not reintroduced into the client projection
- **AND** the page still reaches the host outer edges.

#### Scenario: A frameless style change repaints native chrome without a shell-state reset

- **GIVEN** a Windows WebView transitions to `style.frameless: true`
- **WHEN** the host applies the native window style
- **THEN** DWM non-client rendering is disabled before the final frame recalculation
- **AND** no minimize, restore, hide/show, synthetic resize, or host rebuild occurs
- **AND** residual native titlebar pixels are not visible after the transition.

### Requirement: Windows frameless soft resize SHALL not change shell state

For `style.frameless: true` with `style.resizable: true`, application-level soft resize SHALL retain pointer capture until the pointer interaction ends or is canceled. During that interaction, the runtime MAY synchronously apply WebView bounds and repaint host surfaces, but it SHALL NOT call `ShowWindow`, minimize, restore, hide/show, rebuild the host window, or invoke the shell-state transparent white-block clear path.

Transparent white-block cleanup remains available for ordinary native resize and explicit resize paths where it does not run inside the frameless soft-resize capture lifecycle.

#### Scenario: A continuous frameless resize does not flicker or terminate after one pixel

- **GIVEN** a Windows WebView has `frameless: true`, `resizable: true`, and a translucent background
- **WHEN** the operator drags a soft-resize edge across multiple pixels
- **THEN** the native window continuously follows the pointer until mouse release
- **AND** the resize interaction retains capture
- **AND** no minimize/restore shell transition occurs during the drag.

#### Scenario: Minimizing a frameless resizable window keeps it minimized

- **GIVEN** a Windows WebView has `frameless: true` and `resizable: true`
- **WHEN** the operator or page minimizes the window
- **THEN** it remains minimized until an explicit restore or `toVisible()`
- **AND** no native titlebar residue is projected.

### Requirement: WebView tray-primary examples SHALL project operational visibility

Every runnable CLI example that owns a retained `WebviewWindowHandle` SHALL declare one `primaryEvent` menu item. The item SHALL read `Show Example` while the retained session is not operationally visible and `Hide Example` while it is visible. Its handler SHALL use `show()` only to bootstrap the first native session, `toVisible()` to reveal an existing hidden or minimized session, and `close()` to hide the retained session. The example SHALL subscribe to `visibleChange` and update the menu from that event so page/native visibility changes cannot leave a stale action label. It SHALL register that listener only after the first successful `show()` creates the native session, and it SHALL stop the listener before closing its tray/runtime connection.

#### Scenario: A primary tray action reveals and hides one retained example window

- **GIVEN** a source WebView example has created its window handle but has not shown it yet
- **WHEN** the operator activates `Show Example`
- **THEN** the example bootstraps the window once and the primary item changes to `Hide Example`
- **WHEN** the operator activates `Hide Example`
- **THEN** the example closes the native projection without destroying the session
- **AND** the primary item changes to `Show Example`
- **WHEN** the operator activates `Show Example` again
- **THEN** the example calls `toVisible()` on the retained session instead of recreating content or replaying bootstrap options.

#### Scenario: An example listener does not outlive its native session

- **GIVEN** a WebView example has constructed a retained handle but has not shown it yet
- **WHEN** it performs the first successful `show()`
- **THEN** it registers `visibleChange` and any other native window listener after that native session exists
- **AND** it stops every returned listener, destroys the native session, and then closes the runtime
- **AND** no extension command is sent before the native session exists or after the connection ends.

### Requirement: Windows frameless artifact clear SHALL occur after safe terminal transitions

When Windows auto artifact clearing is enabled, a visible non-maximized frameless WebView SHALL run the existing rendering-artifact clear after it has been projected frameless and after a completed application-level soft-resize releases pointer capture. The cleanup applies regardless of opaque versus translucent background because native chrome residue is independent of the WebView backing family.

The host SHALL NOT run the shell-state artifact clear while a frameless soft-resize interaction owns pointer capture, during a minimized state, or while maximized. It SHALL continue to use the existing background-gated behavior for framed windows.

#### Scenario: Frameless entry clears opaque native-chrome residue

- **GIVEN** a visible normal Windows WebView is changed to `style.frameless: true`
- **AND** its background is opaque
- **WHEN** the native style projection completes
- **THEN** the runtime runs the rendering-artifact clear
- **AND** the window remains operationally visible with no native titlebar residue.

#### Scenario: Frameless soft resize clears only after capture ends

- **GIVEN** a visible non-maximized frameless Windows WebView with `resizable: true`
- **WHEN** the operator completes a soft-resize drag
- **THEN** pointer capture is released before artifact cleanup begins
- **AND** the runtime clears the rendering artifact after the interaction
- **AND** no shell-state repair runs during the drag.

### Requirement: Windows operational visibility SHALL follow native state completion

The Windows host SHALL maintain one authoritative operational-visibility projection for command paths and native state messages. It SHALL update that projection after a native `WM_SIZE` transition so minimize/restore initiated by a page control, system command, or shell path emits exactly one `visibleChange` after the Win32 state is observable. A command-side check MAY emit earlier when the state is already observable, but it SHALL update the same projection and SHALL NOT duplicate a native completion event.

#### Scenario: A page minimizes a retained window

- **GIVEN** a runnable source WebView example has a visible retained session and a `visibleChange` listener
- **WHEN** the page calls `minimize()`
- **THEN** the native `WM_SIZE` completion projects `visible: false`
- **AND** the primary tray item changes to `Show Example`
- **AND** no second false visibility transition is emitted.

### Requirement: Windows frameless reveal cleanup SHALL wait for post-reveal composition

When `show()` or `toVisible()` reveals a normal frameless Windows window, the runtime SHALL enqueue at most one private HWND cleanup message instead of invoking the shell-state artifact repair inside the `ShowWindow` call stack. When that message is handled, it SHALL clear the pending marker before checking the current artifact predicate. It SHALL skip repair when the window is hidden/minimized, maximized, or an application-level soft-resize capture remains active.

#### Scenario: Restoring a frameless material window clears residue without user resize

- **GIVEN** a retained frameless Windows WebView with a material background is minimized
- **WHEN** the tray calls `toVisible()`
- **THEN** the runtime restores the same native session
- **AND** one queued post-reveal cleanup runs only after the next HWND message turn
- **AND** the material is visible without requiring the user to resize the window.

### Requirement: Windows native resize recovery SHALL be terminal-only

The Windows host SHALL treat continuous `WM_SIZE` as geometry/surface work, not as authority to run the shell-state artifact repair. During a native `WM_ENTERSIZEMOVE` interaction it SHALL only record whether a size change occurred. After `WM_EXITSIZEMOVE`, one observed resize MAY queue one artifact repair through the existing post-transition boundary. A pure native move SHALL queue no repair.

This rule applies to ordinary framed and material-backed windows as well as the existing frameless soft-resize exclusion. The host SHALL NOT run `SW_SHOWMINNOACTIVE -> SW_RESTORE` on a recurring timer or throttle while the operator is continuously resizing.

#### Scenario: A material-backed native resize does not repeatedly refresh the shell

- **GIVEN** a visible normal WebView has a material or transparent background
- **WHEN** the operator drags a native resize edge across many `WM_SIZE` messages
- **THEN** each message updates geometry and native surfaces without a shell-state reset
- **AND** one repair is queued only after `WM_EXITSIZEMOVE` when the interaction observed a resize
- **AND** the operator does not see recurring minimize/restore refreshes during the drag.

#### Scenario: A native move does not request terminal repair

- **GIVEN** a visible normal WebView begins and ends a native move interaction without resizing
- **WHEN** the host receives `WM_ENTERSIZEMOVE` and then `WM_EXITSIZEMOVE`
- **THEN** it does not queue an artifact repair.
