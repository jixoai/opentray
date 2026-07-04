# TOC

## Preface

This change turns tray icon selection from a Darwin-only template patch into an OS-scoped candidate priority law. Callers can provide generic and Darwin/Win32/Linux icon candidates in the same `icon` object; the current OS candidate shadows the generic candidate for the same mode, while the existing icon-only, text-only, icon-text, and fallback ordering remains intact.

The final visible effect is that Darwin template icons can be declared as `isTemplate` on Darwin candidates and rendered by the tray-icon backend without adding OS concepts to `opentray-core`, changing Linux KSNI behavior, or introducing compatibility aliases.

## Guided Reading

1. `interview_plan.md` records the user requirement, language system, code evidence, decisions, and rejected paths.[^interview]
2. `specs/client-sdk/spec.md` defines the public icon data shape and candidate priority law.[^client]
3. `specs/backend-adapters/spec.md` defines where OS filtering and Darwin template metadata live in backend projection/native atoms.[^backend]
4. `tasks.md` is the executable BDD, implementation, verification, and close ledger.[^tasks]

## Footnote References

[^interview]: interview_plan.md
[^tasks]: tasks.md
[^client]: specs/client-sdk/spec.md
[^backend]: specs/backend-adapters/spec.md
