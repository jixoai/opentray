# opentray

Developer-facing OpenTray package.

Install it directly in the application or service that owns the tray lifetime:

```bash
pnpm add opentray
```

Use `latest` for the newest published package. When installing official extensions, use one protocol-line tag across the package set:

```bash
pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B
```

Use `alpha-A-B` for alpha packages on the same protocol line. Replace `A-B` with the current OpenTray protocol-line tag from `@opentray/spec`; do not mix `latest` and protocol-line tags unless you are debugging install drift.

## Role

- Expose `createTray()` as the public creation entrypoint.
- Bind tray handles to the current runtime host context.
- Route official extension packages through public OpenTray contracts.
- Resolve platform runtime artifacts without exposing `Space`, `Surface`, or a public broker object.

`packages/cli` is the only unscoped npm package in this monorepo.

## Native Artifact Authority

Official `TrayExtension` implementations declare a platform-neutral `artifact` descriptor. On first use, the Node SDK resolves the platform package relative to the facade package that declared it, validates the facade, contract, and platform package manifests, and sends one real native-library path to the broker. The broker does not scan consumer `node_modules` directories or reconstruct npm, pnpm, Yarn, or Bun layouts.

Low-level custom extensions use an exact-file artifact. `OPENTRAY_EXT_PATH` and source-tree paths are diagnostic inputs; a normal package-manager install must be sufficient for official extensions.

## Tray-First API

For the first app, call `createTray()` directly. The quickstart stays in one file and does not ask the user to wire a worker or a host loop first:

```ts
import {
  createTray,
  type CreateTrayHandle,
  type CreateTrayOptions,
  type TrayIcon,
} from "opentray";

const icon: TrayIcon = { "text-only": "OT" };
let tray: CreateTrayHandle;
const options: CreateTrayOptions = {
  id: "com.example.first-app",
  icon,
  menu: {
    items: [
      {
        title: "Quit",
        primaryEvent: true,
        onMenuClick: () => void tray.destroy(),
      },
    ],
  },
};

tray = await createTray(options, {
  appId: "com.example.first-app",
  appName: "First App",
});
```

`createTray()` remains the direct tray API when the caller already owns the runtime process shape.

```ts
import { createTray } from "opentray";

const tray = await createTray({
  id: "com.example.status",
  icon: {
    type: "file",
    path: "./assets/tray-icon.png",
    text: "Status",
    "text-only": "Status",
  },
  tooltip: {
    title: "Status",
    description: "Background service is running",
  },
  menu: {
    items: [
      {
        title: "Open",
        primaryEvent: true,
        onMenuClick: () => {
          // Open an app-owned window, command, or extension surface.
        },
      },
      "-",
      ["More", ["Settings", "Quit"]],
    ],
  },
});
```

Visible tray text belongs to `icon.text`, `icon["text-only"]`, or `icon["icon-text"].text`. If no visible icon/text survives projection, native tray backends fall back to the runtime `appName`. The current tray-first API does not export `createSpace()`, `createSurface()`, `resolveDefaultSpace()`, or `TrayHandle.setTitle()`.

The package re-exports common application-facing types including `CreateTrayOptions`, `TrayIcon`, `TrayMenu`, `TrayTooltip`, `TrayEvent`, and `TrayBoundsResult`. Use those public names instead of deriving SDK shapes with `typeof` in application code.

Top-level `createTray(...)` and its returned `setMenu(...)` accept app-facing
menu shorthand. Lower-level `createClient(...)` remains protocol-only for tools
that need exact wire shapes.

`primaryEvent` is a role on a normal menu item and emits the usual `menuClick`.
Use `tray.onTrayClick(...)` when you want to listen to raw tray-icon clicks
without making a menu item the primary route.

## Darwin App Bundle

On macOS, `createTray()` launches the broker from a stable caller-owned bundle.
The default is derived from the caller package name:
`~/.opentray/apps/@scope+name/App Name.app`. The bundle is regenerated in place
on each managed start, so the Dock identity uses the caller's `appName` and
`appIcon` before the first window is shown.

```ts
const tray = await createTray(options, {
  appId: "com.example.first-app",
  appName: "First App",
  appIcon,
  appBundle: {
    // Relative paths resolve from the caller package root.
    path: "dist/First App.app",
    // A plugin-generated bundle can be validated without mutation.
    reinitialize: false,
  },
});
```

`appBundle.reinitialize` defaults to `true`. A prebuilt bundle must contain the
matching broker, `Info.plist`, target, icon, and OpenTray manifest; incompatible
bundles fail with a typed error instead of being silently rebuilt.

## Runtime Ownership

OpenTray does not ask developers to create a public broker object. The application process or an application-owned background service imports `opentray`, calls `createTray()`, and owns its event handlers. Calling the returned handle's `destroy()` removes the tray and closes the caller-owned broker session; repeated calls share the same teardown. Process exit remains the final fallback rather than a required cleanup mechanism.

Platform runtime packages carry the packaged runtime executable at `bin/opentray` or `bin/opentray.exe`.

When a local consumer links this workspace, refresh native package artifacts explicitly instead of relying on `pnpm run build` alone:

```bash
pnpm run npm:cp-bin:runtime
pnpm run npm:cp-bin:webview
```

Use `pnpm run npm:cp-bin` to refresh both the packaged runtime executable and the current platform WebView native library. Without `--target`, it compares existing `target/debug` and `target/release` artifacts and copies the newest binary for each kind. Pass `--target debug`, `-t debug`, or `--target release` to build and copy a specific target into the package projection:

```bash
pnpm run npm:cp-bin
pnpm run npm:cp-bin -- --target debug
pnpm run npm:cp-bin:webview -- -t debug
```

By default, `createTray()` routes through the local runtime host and starts it on first use when needed. It resolves the broker executable from the installed current-platform package first; source-tree contributors can either stage fresh package artifacts with `npm:cp-bin*` or point directly at a debug broker with `OPENTRAY_BROKER_BIN`. The executable host remains the source of truth for tray lifecycle, session cleanup, and native event routing on supported platforms.

Runtime options may also carry app identity facts. For a Darwin runtime, the
identity catalog and App handle look like this:

```ts
import { createTray, type AppIcon, type AppIconVariantOf } from "opentray";

const appIcon = [
  {
    platform: "darwin",
    format: "icns",
    variant: ["default", "light"],
    source: { type: "file", path: "./assets/app-light.icns" },
  },
  {
    platform: "darwin",
    format: "icns",
    variant: "dark",
    source: { type: "file", path: "./assets/app-dark.icns" },
  },
] as const satisfies AppIcon;
type AppIconVariant = AppIconVariantOf<typeof appIcon>;

const tray = await createTray(options, {
  appId: "com.example.status",
  appName: "Status",
  appIcon,
});

const selectAppIcon = (variant: AppIconVariant) =>
  tray.app.setAppIcon(variant);

await selectAppIcon("dark");
```

`appIcon` is a current-platform catalog of native App identity assets: ICNS on
macOS, ICO on Windows, and sized PNG or SVG assets on Linux. Omitted `variant`
means `default`; an array aliases one file to several semantic names. Names are
application states, so `empty/files` is as valid as `light/dark`. Every catalog
must provide `default` and every selectable variant for the current platform.

`tray.app.getAppIcon()` returns the complete catalog,
`tray.app.getAppIconVariant()` returns the selected name, and
`tray.app.setAppIcon(...)` either selects a name, replaces the catalog and resets
selection to `default`, or clears explicit artwork with `null`. Selection does
not add WebView IPC or automatic theme behavior. Tray icon text, menu labels,
tooltip text, and WebView window metadata remain separate projection data.

## Examples

Run the quickstart example and the protocol-only example:

```bash
pnpm run npm:cp-bin:runtime -- --target debug
pnpm --filter opentray example:first-app
pnpm --filter opentray example:basic
```

Run the finite source-tree smoke matrix instead of relying on shell expansion for `example:*`:

```bash
pnpm --filter opentray example:matrix
pnpm --filter opentray example:matrix -- --row webview-control
```

Run human-visible tray and extension examples from a source checkout:

```bash
pnpm run npm:cp-bin:runtime -- --target debug
pnpm --filter opentray example:debug-runtime-tray
pnpm --filter opentray example:webview-control
pnpm --filter opentray example:win32-bug
pnpm --filter opentray example:tray-panel
pnpm --filter opentray example:placement
pnpm --filter opentray example:mediaQuery
See the independent Lynx repository for its native carrier smoke path:
https://github.com/jixoai/opentray-ext-lynx
```

The example matrix stages the packaged runtime executable before `first-app`, skips unsupported or missing native extension carrier artifacts with an explicit reason, and labels contributor-only extension rows as `extension-debug-runtime` coverage. The first-app example exercises the default package runtime. The debug-runtime examples exercise the contributor-only source-tree transport for extension and panel iteration. `example:win32-bug` is intentionally outside the finite matrix: it is Windows-only human evidence tooling for WebView2/DWM residue, not an accepted rendering repair. It disables automatic white-block recovery so its one-pixel pulse remains a geometry-only control. The public API demonstrated by the other examples is tray-first: application code creates trays directly and treats background/service lifecycle as application-owned.
