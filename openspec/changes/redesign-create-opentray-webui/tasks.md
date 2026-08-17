## 1. Alignment / Investigation

- [x] 1.1 Re-read this interview, `unify-create-opentray-core`, `add-create-opentray-cli`, current WebUI source/tokens/components/protocol, and both supplied logo assets before implementation.
- [x] 1.2 Confirm this Change declares `schema: vision2`, aggregates all WebUI work, and starts Apply only after the Core contract has an implementation-ready artifact commit.
- [ ] 1.3 Resolve and record current official shadcn/UI Base registry and Base UI documentation at implementation time; do not hard-code a stale "latest" version from this plan.
- [x] 1.4 Produce the required page-wide component inventory with user job, current shape, selected shadcn/Base UI or justified native/custom choice, states, keyboard model, accessible relationships, RTL, and theme behavior.
- [x] 1.5 Inventory every hard-coded visible string, aria label, status/error, Markdown document, direction-sensitive icon/layout, and dark-only token before editing.

## 2. BDD Contract

- [x] 2.1 Scenario: Given the root wizard URL When loaded Then localized Add is active and usable without a landing interstitial (spec: create-workbench-shell / stable routes).
- [ ] 2.2 Scenario: Given each supported locale When every route/dialog/state renders Then strings fit; Arabic mirrors shell/overlays/icons while technical content remains bidi-safe LTR (spec: create-workbench-shell / locale).
- [x] 2.3 Scenario: Given system theme When OS scheme changes Then semantic theme updates before/without reload and state is preserved (spec: create-workbench-shell / theme).
- [x] 2.4 Scenario: Given the migrated dependency/source graph When inspected Then Base UI backs interactive shadcn components and no Radix runtime contract remains (spec: create-workbench-design-system / sole engine).
- [ ] 2.5 Scenario: Given keyboard and screen-reader operation When Add plan/apply completes Then fields, errors, advanced controls, progress, and result are reachable/named/announced (spec: create-workbench-design-system / WCAG).
- [x] 2.6 Scenario: Given loaded Applications When refresh fails Then known apps remain with stale/error state; given broken link Then status/path evidence remains actionable (spec: create-workbench-applications).
- [x] 2.7 Scenario: Given Edit When v1 config loads Then every field round-trips, appId is read-only, and force is enabled only for verified managed payload replacement (spec: create-workbench-applications / edit).
- [x] 2.8 Scenario: Given linked uninstall When confirmed without purge Then UI states target retention and manual OS pin cleanup before and after completion (spec: create-workbench-applications / uninstall).
- [x] 2.9 Scenario: Given Help without selection When opened Then localized human `SKILL.md` renders beside/after a read-only logical tree; malicious Markdown/path escape is inert (spec: create-workbench-help).
- [ ] 2.10 Scenario: Given uploaded pixel art and smoothing disabled When preview/apply runs Then app/tray previews preserve hard pixels and layout remains stable (spec: create-workbench-form / icon controls).
- [ ] 2.11 Scenario: Given developer mode toggled When plan diff is reviewed Then only DevTools admission changes (spec: create-workbench-form / developer mode).
- [x] 2.12 Scenario: Given an uploaded resource When Export opens Then script is default and direct copy requires long-content override (spec: create-workbench-export / uploads).
- [x] 2.13 Scenario: Given any env entries When Export opens Then editable review plus an unchecked disclaimer blocks complete copy/download until acknowledged, with no secret heuristics (spec: create-workbench-export / env).
- [x] 2.14 Confirm each task checkbox is updated only by the agent that completed and verified that task in the current working context.

## 3. Implementation

- [x] 3.1 Run `bun run openspec:vision2 -- commit-check redesign-create-opentray-webui --phase apply` after the Core prerequisite is ready and commit these artifacts before product-code work.
- [x] 3.2 Move/reshape WebUI under the approved `packages/create/packages/*` private topology and consume one generated/shared adapter protocol derived from Core types.
- [x] 3.3 Add stable Add/Applications/Help routing, desktop logical-start navigation, accessible mobile navigation, product logo identity, and bottom utility controls.
- [x] 3.4 Add locale catalogs and targeted human-help content for zh-CN/ja/ko/en/ar/fr/es/de/ru, persisted/system locale resolution, document/Base UI direction, and LTR bidi-isolated technical primitives.
- [x] 3.5 Add system/light/dark state with before-paint resolution, live system observation, persisted explicit choice, and complete paired semantic tokens.
- [x] 3.6 Refresh current shadcn sources using the Base UI registry with RTL enabled; migrate composition/state/focus/overlay patterns; remove Radix runtime dependencies and obsolete wrappers.
- [x] 3.7 Apply the approved component audit across existing and new pages, including standard field, option, destructive confirmation, list-detail, loading, feedback, tooltip, and progressive-disclosure semantics without card nesting.
- [ ] 3.8 Split the current monolithic page into route/workflow-owned modules while preserving terminal/service preview lifetime, buffered output, async supersession, and live Core session state.
- [ ] 3.9 Implement Applications lifecycle states, Core-backed refresh/list/edit/copy/export/uninstall, immutable identity, plan review, explicit stop/restart, link retention, purge, focus restoration, and exact result text.
- [x] 3.10 Implement contained localized human Markdown list-detail Help with default `SKILL.md`, responsive list/detail navigation, sanitization, route selection, safe links, skeleton/stale/error states, and CLI/Core factual alignment.
- [ ] 3.11 Refactor Add/Edit form to round-trip the full v1 model; add image-smoothing and default-off developer-mode controls using appropriate shadcn components and Core-backed previews.
- [ ] 3.12 Implement Core-backed direct command/`.sh`/`.ps1` export, uploaded-resource script default, force-copy override, clipboard/download states, and LTR accessible previews.
- [x] 3.13 Implement uniform env-bearing export review with editable values and a non-preselected disclaimer checkbox; remove any attempt to infer secret/safe values.
- [x] 3.14 Promote the supplied create-opentray logo into stable WebUI/package assets and verify every locale/theme/background projection remains legible.
- [ ] 3.15 Add purposeful route/list state transitions with reduced-motion behavior; do not add decorative page-load choreography.
- [x] 3.16 When a new problem surfaces, create a typed issue with `bun run openspec:vision2 -- issues redesign-create-opentray-webui --new <bug|task|decision|risk|question> --title "<title>"`.
- [x] 3.17 Update only current-context task checkboxes with matching evidence; do not add plan backups or self-review loops.

## 4. Verification

- [x] 4.1 Run component/unit tests for routing, locale fallback/persistence, RTL direction, bidi isolation, theme before-paint/system updates, Core protocol decoding, async supersession, and export gates.
- [ ] 4.2 Add Storybook/Vitest interaction and accessibility coverage for the workbench shell, navigation states, fields, icon controls, applications states, help list-detail, export review, dialogs, skeletons, errors, and long-content fixtures.
- [ ] 4.3 Run automated accessibility checks plus keyboard-only walkthroughs for Add, Applications edit/uninstall, Help navigation, locale/theme switching, and export; resolve WCAG 2.2 AA violations rather than suppressing them.
- [ ] 4.4 Capture/inspect desktop and mobile evidence in light/dark/system for all nine locales, including Arabic RTL, longest German/Russian strings, long app names/paths/argv/URLs, loading/empty/error/with-data states, and 200% zoom; reject overlap, clipping, or layout shift.
- [x] 4.5 Verify the built dependency graph contains current Base UI/shadcn sources and no Radix runtime packages or stale Radix conventions; exercise focus/keyboard behavior for every migrated primitive.
- [x] 4.6 Run source and built `create-opentray web` end-to-end against a real preview command: Add without preview, preview/discovery/scrape, create, Apps refresh/edit/export/uninstall, and Help default/deep selection.
- [ ] 4.7 Execute generated `.sh` on POSIX and `.ps1` on a Windows agent, including uploaded image embedding, forced direct copy, env edits/acknowledgement, Unicode, spaces, quotes, and exact argv round-trip.
- [ ] 4.8 Run native-visible macOS acceptance for created/restarted app identity/icon/DevTools mode and record Dock-pin cleanup as manual; defer Windows-native WebView/taskbar evidence to the Windows agent without promoting macOS truth.
- [ ] 4.9 Obtain owner visual acceptance after automated evidence for typography, density, component fit, brand/logo use, light/dark balance, RTL, Markdown reading, and destructive clarity; automation prepares but does not replace human aesthetic judgment.
- [x] 4.10 Run `bun run openspec:vision2 -- validate redesign-create-opentray-webui`.
- [ ] 4.11 Run `bun run openspec:vision2 -- issues redesign-create-opentray-webui --validate` and inspect `--group-by group`.
- [x] 4.12 Run WebUI build/typecheck/tests, packed WebUI integration, `pnpm run verify`, and `git diff --check`.
- [ ] 4.13 Run `bun run openspec:vision2 -- commit-check redesign-create-opentray-webui --phase close` before closing overview work.

## 5. Close

- [ ] 5.1 Keep `toc.md` aligned with every WebUI spec and Core/CLI dependency gate.
- [ ] 5.2 Close or resolve every active issue with valid dependency references.
- [ ] 5.3 Run `bun run openspec:vision2 -- check redesign-create-opentray-webui` and resolve structural/open-issue results.
- [ ] 5.4 Archive only after Core/CLI integration, automated accessibility/responsive evidence, owner visual acceptance, platform-labeled evidence, and normal close gates complete; commit archive movement separately.

