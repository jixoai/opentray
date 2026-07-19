//
// Orthogonal intents (maintained 2026-07-19; original user request: make the
// Darwin runtime ship one shared app carrier for app-mode windows):
// 1. Provide the internal AppKit process carrier used by the Darwin runtime.
// 2. Establish accessory activation at launch; runtime projection may promote
//    the process when an app-mode session becomes live.
// 3. Keep bundle lifecycle independent from extension-specific semantics.
//
// The carrier is intentionally small. Runtime state and permission decisions
// remain owned by the OpenTray host and extension contracts.

import AppKit

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.run()
