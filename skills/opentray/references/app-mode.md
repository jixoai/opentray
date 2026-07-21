<!--
Orthogonal intents (maintained 2026-07-21; original user request: summarize the
skill-creator-v2 appMode adaptation as a public consumer tutorial with decisions for
different runtime scenarios):
1. Select the desktop Shell role independently from other window style facts.
2. Separate retained-window reveal, warm Dock reopen, and cold process relaunch.
3. Define production lifecycle commands and development supervisor launch vectors.
4. Provide persistent diagnostics and an acceptance matrix.
-->

# Application Mode

Use this reference when a WebView should behave like a normal desktop
application, when a pinned macOS Dock entry must relaunch the product, or when a
development server and background process must be reconstructed together.

## Contents

- [Choose The Window Role](#choose-the-window-role)
- [Create An Ordinary App Window](#create-an-ordinary-app-window)
- [Keep Style Facts Orthogonal](#keep-style-facts-orthogonal)
- [Separate Warm And Cold Launch](#separate-warm-and-cold-launch)
- [Choose A Production Entry](#choose-a-production-entry)
- [Persist A Development Supervisor](#persist-a-development-supervisor)
- [Diagnose A Failed Relaunch](#diagnose-a-failed-relaunch)
- [Acceptance Matrix](#acceptance-matrix)

## Choose The Window Role

```text
Need an ordinary desktop application window?
|
+-- yes -> style.appMode: true
|          |
|          +-- live Dock click -> reopenRequested
|          |                     -> latest active retained app window
|          |                     -> toVisible() -> focus()
|          |
|          `-- process exited -> stable Darwin .app
|                                -> opentray-launch.json
|                                -> appLaunch supervisor
|
`-- no  -> style.appMode: false
           |
           +-- tray utility / popover / widget
           +-- autoHide chosen independently
           `-- keepOnTop expresses only z-order
```

| Product shape | Window choice | Notes |
| --- | --- | --- |
| Ordinary desktop app | `appMode: true`, usually `autoHide: false` | Prefer native frame unless custom chrome is a product requirement. |
| Tray utility or popover | `appMode: false` | Choose `autoHide` and `keepOnTop` from interaction needs. |
| Mixed app | One retained `true` main window plus a separate retained `false` panel | Do not mutate one window between unrelated Shell roles. |
| Background service | No WebView | A tray can exist without an application window. |

OpenTray core supports Linux, but `@opentray/ext-webview` currently publishes
native WebView runtimes only for macOS and Windows.

## Create An Ordinary App Window

Declare application identity in runtime options and window role in the WebView
style. A WebView title or favicon does not replace `appName` or `appIcon` as the
Dock/taskbar identity.

```ts
import { WebviewExt } from "@opentray/ext-webview";
import { createTray } from "opentray";

const tray = (await createTray(
  {
    id: "com.example.editor",
    icon: { "text-only": "ED" },
    menu: {
      items: [{ type: "item", id: 1, title: "Open Editor", primaryEvent: true }],
    },
  },
  {
    appId: "com.example.editor",
    appName: "Example Editor",
    appIcon,
  },
)).extend(WebviewExt);

const appWindow = tray.createWebviewWindow({
  url,
  width: 960,
  height: 720,
  nativeWindowApi: true,
  style: {
    appMode: true,
    autoHide: false,
    frameless: false,
  },
});

let bootstrapped = false;
const reveal = async () => {
  if (!bootstrapped) {
    await appWindow.show();
    bootstrapped = true;
    return;
  }
  await appWindow.toVisible();
  await appWindow.focus();
};

tray.onMenuClick(async ({ itemId }) => {
  if (itemId !== 1) return;
  if (bootstrapped && (await appWindow.isVisible())) {
    await appWindow.close();
  } else {
    await reveal();
  }
});

await reveal();
```

Keep one `WebviewWindowHandle` for the retained session. `close()` hides that
session without discarding its page runtime; `toVisible()` handles both hidden
and minimized states. Use `destroy()` only when the page runtime itself must be
discarded. Drive Show/Hide menu text from `isVisible()` and `visibleChange`, not
from an unverified private boolean.

## Keep Style Facts Orthogonal

`appMode` means only "participate as an ordinary desktop application window."
It does not imply:

- `keepOnTop`
- `autoHide`
- `frameless`
- material or transparency
- titlebar composition
- current visibility or focus

Use `keepOnTop` only for explicit z-order behavior. It is not a substitute for
application participation and is usually unnecessary for a normal app window.

## Separate Warm And Cold Launch

```text
warm reopen
  live broker + consumer
       -> Darwin reopenRequested
       -> @opentray/ext-webview selects the most recently active
          bootstrapped window whose current style has appMode: true
       -> toVisible() -> focus()
       -> appLaunch is not executed

cold relaunch
  consumer has exited
       -> user opens the stable Darwin .app
       -> carrier reads Contents/Resources/opentray-launch.json
       -> carrier executes appLaunch once, without a shell
```

Warm reopen is automatic after an app-mode window has completed its first
`show()`. The lower-level `tray.onAppReopenRequested(...)`,
`WebviewWindowHandle.toVisible()`, and `focus()` APIs remain available when an
app needs a policy other than the default most-recently-active window.

Cold relaunch is currently a macOS carrier capability. A Windows taskbar entry
or Linux window-list entry is not a persistent post-exit launcher merely because
the window uses `appMode`.

## Choose A Production Entry

`appLaunch` is an executable vector, not shell source:

```ts
await createTray(options, {
  appId: "com.example.editor",
  appName: "Example Editor",
  appLaunch: {
    command: process.execPath,
    args: [absoluteCliEntrypoint, "start"],
    cwd: projectRoot,
  },
});
```

When `appLaunch` is omitted or `null`, OpenTray snapshots `process.execPath`,
`process.argv.slice(1)`, and `process.cwd()`. That default is correct only when
the current invocation is already the product's durable public entry.

Persist the application's lifecycle command, such as `dist/cli.js start`, not a
raw daemon child such as `dist/daemon.js`. A durable lifecycle command should:

| Observed state | Required action |
| --- | --- |
| No daemon | Start the complete application graph and open the main window. |
| Healthy daemon | Send an open/focus intent instead of exiting silently. |
| Daemon registry exists but OpenTray is unreachable | Stop the stale owner and rebuild the complete runtime graph. |

The stable Darwin bundle defaults to
`~/.opentray/apps/<encoded-package>/<App Name>.app`. Set `appBundle.path` when
the application needs a predetermined path. Managed bundles reinitialize in
place by default; set `appBundle.reinitialize: false` only for a compatible
plugin-generated bundle that OpenTray should validate without replacing.

## Persist A Development Supervisor

A Dock cold launch has Finder/LaunchServices environment, not the interactive
terminal's `PATH`. The persisted command must reconstruct the complete
development graph: frontend server, application daemon, WebView URL, and
OpenTray session.

For a Vite-owned graph, persist this shape:

```ts
appLaunch: {
  command: absoluteNodeExecutable,
  args: [absoluteViteEntrypoint, "--host", "127.0.0.1"],
  cwd: absoluteWebuiDirectory,
}
```

The Vite config or its application plugin must then own the daemon and WebView
lifecycle. Do not persist:

- bare `pnpm dev`
- a `.bin/vite` shim
- a shell command string
- only the daemon child
- any command graph that depends on terminal-only `PATH` entries

When development and production share one app identity, the development
supervisor must take ownership in this order:

```text
stop production daemon
  -> wait for production PID exit and IPC endpoint release
  -> start Vite supervisor
  -> start development daemon
  -> claim one OpenTray session
```

This takeover is an application responsibility. OpenTray persists and executes
the declared vector; it cannot infer how a consumer's daemon, Vite server, IPC
registry, or proxy should be rebuilt.

Source-link development has one additional preparation step: build and stage
the matching OpenTray facade, broker/carrier, and native extension artifacts
before running the consumer:

```bash
# Run from the linked OpenTray source checkout before starting the consumer.
pnpm run prepare:linked-consumer
```

A registry install must remain coherent after a normal package-manager install
and must not require that source-only step.

## Diagnose A Failed Relaunch

Inspect evidence in this order:

1. Read `<App>.app/Contents/Resources/opentray-launch.json`; verify `command`,
   `args`, and `cwd` describe the complete supervisor.
2. Execute that exact vector manually from its recorded `cwd`. A command that
   exits silently or starts only a daemon is an application-entry defect.
3. Read the adjacent `opentray-launch.log` for descriptor parsing, spawn PID,
   spawn errors, and relaunched child stdout/stderr.
4. Read `~/.opentray/<package-version>/<caller-label>/runtime/broker.log` for
   broker readiness, bundle identity convergence, and native runtime failure.
5. Read the consumer's own daemon/supervisor log for IPC ownership and WebView
   URL readiness.

The stable bundle is usually under
`~/.opentray/apps/<encoded-package>/<App Name>.app`; an explicit
`appBundle.path` replaces that location. Manual cache deletion or broker restart
may provide diagnostic evidence, but it is not part of the consumer contract.

## Acceptance Matrix

| Case | Expected result |
| --- | --- |
| Close or minimize a running app window, then click its Dock entry | The retained MRU app-mode window becomes visible and focused. |
| Fully exit the consumer, then click a pinned macOS Dock entry | The stable carrier starts the complete application supervisor and opens usable content. |
| Broker exits while the consumer daemon remains | The public lifecycle command repairs ownership and rebuilds the runtime graph. |
| Start development while a production daemon owns the same identity | Development performs the bounded takeover and produces exactly one Dock identity/session. |
| Click the tray primary item repeatedly | One retained window toggles from native `isVisible()` / `visibleChange`; no duplicate WebView is created. |
