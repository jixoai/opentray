---
"opentray": patch
---

Fix broker binary resolution so installed platform packages are checked before
workspace fallback. This prevents npm consumers from failing to start the
runtime when the matching `@opentray/<platform>` package is installed, and it
updates source-checkout examples to stage the packaged runtime artifact
explicitly for default-runtime smoke paths.
