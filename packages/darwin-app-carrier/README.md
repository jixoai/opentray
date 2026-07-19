# OpenTray Darwin app carrier source

This directory contains the internal Swift host and base `Info.plist` used to
build the shared `OpenTray.app.zip` carrier for the matching Darwin runtime
package. It is source input for the native release graph, not a published npm
package.

The carrier owns the common macOS bundle identity and activation-policy
bootstrap. Permission usage keys are merged by
`scripts/release/build-darwin-app-carrier.sh` from the native build policy.
