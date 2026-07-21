<!--
Orthogonal intents (maintained 2026-07-21; original user request: public docs must address
application developers, while broker implementation and source controls stay internal):
1. Define consumer-owned process and session lifetime.
2. Explain automatic installed-runtime ownership without a public daemon API.
3. Expose stable diagnostic files without source-only controls.
-->

# Runtime Ownership

Use this reference when deciding which application process owns OpenTray or
when an installed application needs runtime diagnostics.

## Ownership Model

```text
application process / application-owned service
  -> createTray()
  -> caller-scoped broker session starts automatically
  -> tray and extensions live while the session is owned
  -> tray.destroy() closes tray + caller session
```

OpenTray does not expose a public broker object or `opentray daemon ...` CLI.
Consumers do not start, stop, or upgrade the broker separately. A normal
package-manager install provides the SDK, current-platform runtime, and official
extension artifacts as one graph.

If the product has its own daemon, that daemon belongs to the product. Its
public lifecycle command must decide whether to start the process tree, send an
open/focus intent to a healthy owner, or recover stale application state.
OpenTray cannot infer that product-specific policy.

## Cleanup

- `tray.destroy()` removes the tray and closes the top-level caller session.
- Repeated `destroy()` calls share the same teardown.
- Process exit is the final fallback, not the normal cleanup API.
- Extension resources remain scoped to their owning session; one process must
  not destroy another caller's tray or retained window.

## Persistent Diagnostics

Detached broker output is appended under:

```text
~/.opentray/<package-version>/<caller-label>/runtime/broker.log
```

For a macOS stable bundle, cold-launch evidence is adjacent to the launch
descriptor:

```text
<App>.app/Contents/Resources/opentray-launch.json
<App>.app/Contents/Resources/opentray-launch.log
```

Read those files together with the consumer application's own supervisor or
daemon log. Manual cache deletion or broker restarts may destroy evidence and
are never part of the normal installation contract.
