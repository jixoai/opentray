<!--
Orthogonal intents (maintained 2026-07-21; original user request: make skills/opentray
serve application developers such as skill-creator-v2, never OpenTray source contributors):
1. Install one coherent published dependency graph.
2. Create and own the first tray through the public SDK.
3. Route consumers to public lifecycle and acceptance guidance.
-->

# Getting Started

Use this reference when adding OpenTray to an application for the first time.

## Install

```bash
pnpm add opentray
```

Add official extensions beside the SDK when needed:

```bash
pnpm add opentray @opentray/ext-webview
```

`opentray` resolves the current platform runtime through optional dependencies.
Do not install or import a platform binary package directly.

For agent-assisted application development, install the public Skill:

```bash
npx skills add jixoai/opentray --skill opentray
```

Use `latest` for the newest published packages. When the application needs an
explicit compatibility line, install `opentray` and official extensions from
the same `stable-A-B` or `alpha-A-B` tag; read `versioning.md` before choosing.

## First Tray

Call `createTray()` from the application process or application-owned service
that should own the tray lifetime:

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
  id: "com.example.status",
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
  appId: "com.example.status",
  appName: "Example Status",
});
```

Keep the owning process alive for as long as its tray should exist. The returned
handle owns the session created by top-level `createTray()`; `destroy()` removes
the tray and closes that session exactly once.

## Public Shape

- `primaryEvent` marks one normal menu item as the tray's primary action; it
  still emits the ordinary `menuClick` event.
- Use item-local `onMenuClick` for declaration-local commands and
  `tray.onMenuClick(...)` for centralized routing with stable item IDs.
- Use `tray.onTrayClick(...)` for raw tray-icon activation independent of the
  primary menu role.
- Visible text belongs to `icon.text`, `icon["text-only"]`, or
  `icon["icon-text"].text`; there is no `tray.setTitle()`.
- Use the public types exported by `opentray`. Import `@opentray/spec` directly
  only for low-level protocol tooling.

## Verify In The Consumer

Inspect the application's `package.json`, run its normal install and typecheck,
then start the real command that owns its complete process tree. Follow
`visual-acceptance.md`; ordinary package consumption must not require cache
deletion, artifact preparation, or a manually started OpenTray daemon.
