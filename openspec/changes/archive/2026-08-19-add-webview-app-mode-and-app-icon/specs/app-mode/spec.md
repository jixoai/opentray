## RENAMED Requirements

FROM: `Windows WebView switcher visibility SHALL be explicit`
TO: `WebView application mode SHALL project system Shell membership`

## MODIFIED Requirements

### Requirement: WebView application mode SHALL project system Shell membership

The WebView extension SHALL expose common `style.appMode: boolean`. The durable fact SHALL mean that the window is a normal application surface which participates in the platform's standard application Shell. It SHALL default to `false`, preserving tray utility behavior. `appMode` SHALL be independent from `frameless`, `resizable`, `keepOnTop`, `autoHide`, opacity, background, title, icon metadata, and comparator topology.

On Windows, `appMode: true` SHALL project `WS_EX_APPWINDOW` and remove `WS_EX_TOOLWINDOW`; `appMode: false` SHALL project `WS_EX_TOOLWINDOW` and remove `WS_EX_APPWINDOW` for every host topology. The public TypeScript and protocol contracts SHALL remove `style.platform.windows.showInSwitchers`; an internal adapter MAY retain a temporary implementation variable while this migration is applied, but it SHALL not be exported or documented as a compatibility alias.

On platforms without a truthful Shell projection, the extension SHALL report capability absence or reject the request with a typed unsupported error. It SHALL NOT claim app-mode success by changing title, icon, z-order, or a local boolean alone.

#### Scenario: Default WebView remains a tray utility

- **GIVEN** a WebView is created without `style.appMode`
- **WHEN** its native style is projected
- **THEN** the effective app mode is `false`
- **AND** the window remains outside the platform's normal application Shell where the backend supports that distinction.

#### Scenario: Windows app mode participates in task switching

- **GIVEN** a Windows WebView sets `style.appMode: true`
- **WHEN** either production or comparator topology projects the native style
- **THEN** the window has `WS_EX_APPWINDOW`
- **AND** the window does not have `WS_EX_TOOLWINDOW`
- **AND** it participates in the taskbar and Alt+Tab.

#### Scenario: Windows tray mode stays out of task switching

- **GIVEN** a Windows WebView uses `style.appMode: false`
- **WHEN** its native style is projected
- **THEN** the window has `WS_EX_TOOLWINDOW`
- **AND** the window does not have `WS_EX_APPWINDOW`.

#### Scenario: App mode does not force z-order

- **GIVEN** a WebView uses `style.appMode: true` and `keepOnTop: false`
- **WHEN** it is revealed and later loses focus
- **THEN** the runtime does not turn on keep-on-top as a side effect
- **AND** any dismissal follows the independent `autoHide` policy.

#### Scenario: Unsupported Shell membership remains explicit

- **GIVEN** a platform backend cannot project truthful app-mode Shell membership
- **WHEN** a caller requests `style.appMode: true`
- **THEN** the capability result reports the absence or the operation rejects with a typed unsupported error
- **AND** the runtime does not silently report success.

### Requirement: WebView application mode SHALL preserve retained-session visibility semantics

The existing operational visibility contract SHALL remain authoritative for app-mode windows: `visible` SHALL mean `!closed && !minimized`; `close()` or a native close action SHALL hide the same retained session; `toVisible()` SHALL reveal or restore it without recreating content; and `visibleChange` SHALL be emitted only when the operational projection changes. Shell membership SHALL follow the visible app-mode projection and SHALL not change session ownership.

#### Scenario: Closing an app-mode window removes Shell membership but retains the session

- **GIVEN** a visible app-mode WebView owns one retained native session
- **WHEN** the operator invokes the native close action or the host calls `close()`
- **THEN** operational visibility becomes `false`
- **AND** the taskbar/Dock/application-switcher projection is removed
- **AND** exactly one `visibleChange` event reports `{ visible: false }`
- **AND** the page, content, and session remain retained for later reveal.

#### Scenario: Tray primary action reveals the same app-mode session

- **GIVEN** an app-mode WebView session is hidden but not destroyed
- **WHEN** its owning tray's `primaryEvent` handler calls `toVisible()`
- **THEN** the same native session becomes visible and active
- **AND** the Shell projection returns
- **AND** the page state and geometry are not reinitialized.

#### Scenario: Destroy removes the app-mode session authoritatively

- **GIVEN** an app-mode WebView session is retained or visible
- **WHEN** its owning session calls `destroy()` or closes
- **THEN** the native window and Shell projection are removed
- **AND** no later tray event can reveal that destroyed session.
