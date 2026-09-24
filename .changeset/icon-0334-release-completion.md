---
"opentray": patch
---

Release-completion bump: the 0.33.4 workflow published every fixed-group package except `@opentray/icon` (its `0.33.4` was versioned in the repo but never reached npm, leaving `opentray@0.33.4`'s exact `@opentray/icon@0.33.4` dependency unsatisfiable). This changeset re-versions the whole fixed group so the icon facade republishes and the group realigns. The icon publish skip itself is recorded for follow-up: the Release packages job exited success while silently missing one package.
