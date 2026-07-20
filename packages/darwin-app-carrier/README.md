# OpenTray Darwin app carrier source

This directory contains the base `Info.plist` used to wrap a matching OpenTray
broker executable as a caller-specific `.app` bundle. It is copied as the
minimal template input for the native release graph, not a published npm
package.

The broker remains the bundle executable and owns the event loop. The template
supplies common macOS bundle identity while permission usage keys remain owned
by the native build policy.
