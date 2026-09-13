---
"create-opentray": minor
---

Extension EventPort: extensions report events to the host at any time through a bounded, fair, host-owned async channel — the 16 ms window-event drain is retired.

- **Generic EventPort (`@opentray/spec` ABI, broker EventHub)**: an optional `opentray_ext_attach_event_port_v1` symbol hands every `ext-*` extension an immutable port whose thread-safe `try_submit` never blocks native UI/transport. Events are classified Latest (coalescing state with sequence-gap query resync), Edge (backpressured, never silently dropped), or BestEffort; per-source and global byte/record budgets with round-robin draining keep one extension from starving others. Port identity is host-bound (session/app/instance/generation) — extensions submit only a tray route. Old extensions keep legacy response flushing; hosts report the active delivery mode.
- **Direct push (webview)**: the five unified event families and the window family (focus/blur/visible/style/interaction/download) now flow through the port on both platforms — idle native callbacks reach the Node facade with zero commands in flight (verified: 12 events, 0 consumer commands, broker metrics matching tap counts exactly).
- **16 ms drain retired**: `drainWindowEvents`, its native queue, and the facade interval are deleted (contract-3); app-reopen MRU tracking and app-mode reconciliation are push-driven now. Idle retained windows issue zero drain commands on both platforms (121-per-2s baseline → 0).
- **Facade resync**: `urlChange`/`titleChange` sequence gaps trigger automatic `getUrl`/`getTitle` recovery, so Latest coalescing converges address-bar truth.
