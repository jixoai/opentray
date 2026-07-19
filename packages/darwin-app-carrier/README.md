# OpenTray Darwin app carrier source

This directory contains the base `Info.plist` used to wrap the matching OpenTray
broker executable as the shared `OpenTray.app.zip` carrier. It is source input
for the native release graph, not a published npm package.

The broker remains the bundle executable and owns the event loop. The carrier
supplies common macOS bundle identity while permission usage keys are merged by
`scripts/release/build-darwin-app-carrier.sh` from the native build policy.
