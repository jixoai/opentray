# @opentray/create-webui

## 0.19.0

### Minor Changes

- d2fc3c5: Generated apps can no longer wedge in a permanent flash-quit state after a failed first open. The Darwin launch descriptor (`opentray-launch.json`) is committed only after a successful broker handshake, but the `.app` bundle materializes during that handshake — so a first open whose entry died mid-handshake left a bundle whose every later open flash-quit on the missing descriptor. Opening now treats a bundle as carrier-openable only when it also carries its descriptor and otherwise falls back to a detached cold start of the entry, whose successful handshake writes the descriptor and unblocks carrier opens. The generated entry writes an `entryStart` milestone before dialing the broker, so a mid-handshake death (previously zero evidence behind discarded stdio) is attributable from `app.log`. Webui open paths gain a bounded first-start observation: an entry that dies before finishing startup reports a failed open carrying the `app.log` tail (the real exception surface), a still-alive entry reports honestly as running, and both the wizard's success dialog and the applications page present that detail instead of discarding the response. Generated apps also project the new `window.zoomShortcuts` config (omitted = kernel default ON) onto their windows, making every generated app zoomable out of the box.
