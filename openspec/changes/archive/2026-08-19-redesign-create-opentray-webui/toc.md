# TOC

## Preface

This single aggregated WebUI Change turns the finished browser wizard into a polished create-opentray workbench. It adds Add/Applications/Help navigation, nine-language and Arabic RTL support, system/light/dark themes, Core-backed registry editing and safe uninstall, localized human Markdown help, complete command/script export, pixel-art sampling, DevTools mode, and the supplied create-opentray branding. The shadcn layer moves completely from Radix primitives to the current Base UI registry and every control receives a semantic/accessibility audit.

The Change depends on `unify-create-opentray-core`; the final stable `create-opentray web` integration gate also depends on `add-create-opentray-cli`. Browser code owns interaction and human projection, not a second application model.

## Guided Reading

1. `interview_plan.md` preserves the original UI request, Chinese boundary interview, current-source/library evidence, and confirmed content/security decisions.[^interview]
2. `specs/create-workbench-shell/spec.md` defines routes, navigation, branding, locales/RTL, theme, and continuity.[^shell]
3. `specs/create-workbench-design-system/spec.md` defines current shadcn/Base UI ownership, component audit, WCAG behavior, robust layout, and visual register.[^design]
4. `specs/create-workbench-applications/spec.md` defines registry lifecycle states, edit, running updates, uninstall/purge, and efficient list actions.[^apps]
5. `specs/create-workbench-help/spec.md` defines the localized human Markdown list-detail browser and its separation from the English AI Skill.[^help]
6. `specs/create-workbench-form/spec.md` defines complete Core form projection, icon sampling, DevTools mode, async state, and progressive disclosure.[^form]
7. `specs/create-workbench-export/spec.md` defines complete command/shell/PowerShell export, uploaded bytes, env review, and clipboard/download failures.[^export]
8. `tasks.md` provides the BDD-first component migration, accessibility, responsive/RTL, integration, platform, and owner-acceptance gates.[^tasks]

## Footnote References

[^interview]: interview_plan.md
[^tasks]: tasks.md
[^shell]: specs/create-workbench-shell/spec.md
[^design]: specs/create-workbench-design-system/spec.md
[^apps]: specs/create-workbench-applications/spec.md
[^help]: specs/create-workbench-help/spec.md
[^form]: specs/create-workbench-form/spec.md
[^export]: specs/create-workbench-export/spec.md
