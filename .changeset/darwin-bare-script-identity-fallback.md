---
"@opentray/packaging": patch
"opentray": patch
---

macOS bare-script consumers no longer crash at connect: package identity resolution walked up from the entry script and, when no `package.json` ancestor existed (e.g. a standalone script run from a scratch directory), the third-party root-file resolver's untyped "Cannot find package.json" throw escaped before the documented `npm_package_json`/cwd fallbacks could run. The walk is now owned by OpenTray and exhausts as "not found", so the fallback chain resolves the identity instead of crashing (caught by the W8 bare-child transport drill on its first darwin round).
