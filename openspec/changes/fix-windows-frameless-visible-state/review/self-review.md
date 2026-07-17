<!--
Orthogonal intents:
1. Original user input (2026-07-17): "??????pnpm-pub???????????"
2. Compare the delivered native lifecycle against the plan, specs, tasks, releases, and operator evidence.
3. Preserve incomplete superseded experiments as explicit deviations instead of manufacturing proof.
-->

# Vision-Driven Self Review

## Review State

- Change: <code>fix-windows-frameless-visible-state</code>
- Iteration: 1
- Recurring issue counts: classic outer-frame residue 0 after final host-topology repair; comparator top-gap 0 after final projection repair; retained visibility/menu drift 0 after OpenTray 0.14.3 and pnpm-pub 1.4.1.
- Exit-condition judgment: satisfied. The user visually accepted the Windows result and authorized pnpm-pub release closure.
- Next loop action: archive this change after committing the review evidence; no implementation loop is required.

~~~text
native state completion
        |
        v
isVisible / visibleChange
        |
        +--> OpenTray tray label
        |
        +--> pnpm-pub retained window lifecycle
        |
        v
close <-> toVisible
~~~

## Intent Alignment

| Intent point | Evidence | Verdict |
| ------------ | -------- | ------- |
| Operational visibility is <code>!closed && !minimized</code> and is extension-owned. | OpenTray commits <code>980da15</code>, <code>1ada9fe</code>, and release <code>0.14.3</code>; the published facade exposes <code>isVisible</code>, <code>visibleChange</code>, <code>toVisible</code>, and <code>close</code>. | Aligned |
| Frameless projection removes native titlebar/frame residue without breaking resize. | Commits <code>c429504</code>, <code>b2736fc</code>, and <code>2453667</code>; user accepted the final Windows geometry and visual result. | Aligned |
| Recovery runs at terminal/native-completion boundaries instead of continuously during resize. | Commits <code>d7f614b</code> and <code>ae167ad</code>; the accepted result removed the classic outer-frame residue and retained continuous resize. | Aligned |
| Tray windows stay out of Windows taskbar/Alt+Tab by default and support common auto-hide. | Commit <code>9d1a950</code>; OpenTray <code>0.14.3</code> release workflow completed successfully. | Aligned |
| pnpm-pub consumes the public retained-window lifecycle. | pnpm-pub commits <code>d70ffc4</code> and <code>7a5bb7a</code>; <code>pnpm-pub@1.4.1</code> is npm latest and its release workflow succeeded. | Aligned |
| Human Windows acceptance gates closure. | User statement on 2026-07-17: "??????pnpm-pub???????????". | Aligned |
| macOS remains contract-aligned without claiming Windows-session visual proof. | Cross-platform implementation and release verification exist; no macOS human visual acceptance is asserted. | Aligned with evidence boundary |

## Deviations From Intent

1. Tasks <code>4.4</code>, <code>4.6</code>, and <code>4.7</code> remain unchecked because their exact historical source-smoke commands were not preserved as current-context evidence. Later release CI, geometry evidence, and direct user visual acceptance provide the closure proof, but they are not relabeled as those exact executions.
2. Tasks <code>8.2</code>, <code>8.3</code>, and <code>8.6</code> remain unchecked. The temporary instrumentation/A-B matrix was superseded by the user-approved terminal-only recovery, delayed retained reveal experiment, comparator topology repair, and final visual acceptance. Archival records this as an intentionally incomplete investigative branch.
3. Human visual proof is Windows-only. The review does not infer macOS visual acceptance from shared contracts or CI.

## New Questions For User

1. None. The user explicitly accepted the visible result and authorized release closure.

## Evidence

- HTML report: <code>review/self-review.html</code>
- OpenTray npm evidence: <code>opentray@0.14.3</code>, <code>@opentray/ext-webview@0.14.3</code>
- OpenTray release workflow: https://github.com/jixoai/opentray/actions/runs/29569611638
- pnpm-pub npm evidence: <code>pnpm-pub@1.4.1</code> with <code>latest=1.4.1</code>
- pnpm-pub release: https://github.com/Gaubee/pnpm-pub/releases/tag/v1.4.1
- pnpm-pub release workflow: https://github.com/Gaubee/pnpm-pub/actions/runs/29590201247
- Screenshot / interaction evidence: user-provided Windows screenshots and direct visual acceptance in the 2026-07-17 conversation; no repository screenshot artifact was created.
- Git commits reviewed: OpenTray <code>c4c01ab</code>, <code>980da15</code>, <code>c429504</code>, <code>1ada9fe</code>, <code>d7f614b</code>, <code>ae167ad</code>, <code>b2736fc</code>, <code>2453667</code>, <code>9d1a950</code>, <code>55fe7a5</code>, <code>67b3127</code>; pnpm-pub <code>d70ffc4</code>, <code>2398563</code>, <code>7a5bb7a</code>.
- Uncommitted paths at review creation: <code>tasks.md</code>, <code>review/self-review.md</code>, and <code>review/self-review.html</code>.
- Task checkboxes updated by this working context: <code>5.1</code>, <code>5.2</code>, <code>6.1</code>, <code>6.2</code>, <code>9.6</code>, <code>10.7</code>, and <code>10.8</code>.
- Task checkboxes intentionally not updated: <code>4.4</code>, <code>4.6</code>, <code>4.7</code>, <code>8.2</code>, <code>8.3</code>, and <code>8.6</code>.

## HTML Review Report

The separate HTML report presents the intent matrix, release evidence, deviations, and exit judgment without inventing unavailable screenshots.

## Exit Handling

- Normal exit selected.
- Commit this review and the current-context task-state updates.
- Archive <code>fix-windows-frameless-visible-state</code> in a dedicated final commit.
- Run the post-archive vision check without reopening implementation.
