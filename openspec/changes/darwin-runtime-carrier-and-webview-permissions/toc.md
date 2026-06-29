# TOC

## Preface

This change defines the OpenSpec contract for Darwin `.app` runtime carrier extraction, WebView browser permission policy, app-scoped permission storage, and `ext-badge` migration onto the shared carrier. The final visible effect is that WebView camera, microphone, and adjacent browser permission families become explicit policy-governed capabilities backed by native app identity on macOS, while badge stops owning private app-bundle mechanics.

This artifact indexes the spec set before implementation starts. It does not mean the code has been implemented or the change is ready to archive; `tasks.md` is the execution ledger for the apply phase.

## Guided Reading

1. `interview_plan.md` records the Chinese interview, user confirmations, rejected paths, and source evidence.[^interview]
2. `specs/darwin-runtime-carrier/spec.md` defines the internal macOS `.app` carrier and privacy `Info.plist` ownership.[^darwin]
3. `specs/webview-browser-permissions/spec.md` defines browser permission families, source/origin policy, native prompts, allow-once, and remote injection gates.[^webview]
4. `specs/permission-store/spec.md` defines the app-scoped JS permission database and `opentrayPermissions` management object.[^store]
5. `specs/badge-extension/spec.md` defines how `ext-badge` migrates onto the shared Darwin carrier while remaining an orthogonal status atom.[^badge]
6. `tasks.md` turns the contracts into BDD, implementation, verification, and Git checkpoints.[^tasks]

## Footnote References

[^interview]: interview_plan.md
[^tasks]: tasks.md
[^darwin]: specs/darwin-runtime-carrier/spec.md
[^webview]: specs/webview-browser-permissions/spec.md
[^store]: specs/permission-store/spec.md
[^badge]: specs/badge-extension/spec.md
