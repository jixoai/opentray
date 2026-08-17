# TOC

## Preface

This prerequisite Change replaces the browser-wizard-shaped create-opentray implementation with one adapter-neutral Core. It defines `create-opentray.json v1`, the fixed registration envelope, relocatable `app/` payload, resource snapshots, deterministic Plan/Apply, safe process and uninstall ownership, process/port observation, icon sampling, and export behavior. It is intentionally breaking: legacy `opentray.app.json` projects are neither discovered nor migrated.

`add-create-opentray-cli` and `redesign-create-opentray-webui` depend on this Change. They may choose different interactions, but they cannot define competing application models or filesystem effects.

## Guided Reading

1. `interview_plan.md` preserves the Chinese architecture interview, code evidence, approved breaking boundaries, and rejected alternatives.[^interview]
2. `specs/create-project-config/spec.md` defines the v1 authority, immutable identity, exact command vector, and validation contract.[^config]
3. `specs/create-registration-layout/spec.md` defines the fixed registry, source resources, relocatable payload, and no-legacy boundary.[^registry]
4. `specs/create-lifecycle-kernel/spec.md` defines Plan/Apply, ownership, health listing, running-process protection, and uninstall/purge semantics.[^lifecycle]
5. `specs/create-process-observation/spec.md` defines headless preview, process-owned port discovery, optional scraping, and platform-truthful degradation.[^observation]
6. `specs/create-resource-export/spec.md` defines image sampling, developer mode, command/script export, embedded uploads, and environment-risk metadata.[^export]
7. `tasks.md` turns those contracts into BDD-first implementation and cross-platform evidence gates.[^tasks]

## Footnote References

[^interview]: interview_plan.md
[^tasks]: tasks.md
[^config]: specs/create-project-config/spec.md
[^registry]: specs/create-registration-layout/spec.md
[^lifecycle]: specs/create-lifecycle-kernel/spec.md
[^observation]: specs/create-process-observation/spec.md
[^export]: specs/create-resource-export/spec.md
