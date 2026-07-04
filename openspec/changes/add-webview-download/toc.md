# TOC

## Preface

This change defines the OpenSpec contract for native WebView downloads in `@opentray/ext-webview`: standard HTML download triggers, `multipleDownloads` policy gating, `saveAs`, lifecycle events on the existing window bus, and a human-visible `example:download` proof surface. The final visible effect is that a local WebView page can export a real file to the operating system Downloads directory without inventing a parallel download API.

This artifact indexes the change set and its proof surface. `tasks.md` remains the execution ledger for implementation, verification, and closeout evidence.

## Guided Reading

1. `interview_plan.md` records the original user input, the 16 confirmed decisions, and the substrate evidence behind the change.[^interview]
2. `specs/webview-extension/spec.md` defines download semantics, permission gating, `saveAs`, lifecycle events, and the example requirement.[^webview]
3. `tasks.md` turns the contract into BDD, implementation, verification, and archive checkpoints.[^tasks]

## Footnote References

[^interview]: interview_plan.md
[^webview]: specs/webview-extension/spec.md
[^tasks]: tasks.md
