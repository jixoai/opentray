# TOC

## Preface

This Change turns create-opentray into a real non-interactive command suite over the unified Core. It preserves no-argument WebUI launch while establishing `web` as the stable explicit entry, adds deterministic `create` and `app` management, and ships an English AI-facing Skill with safe `list/read` access. It also owns packed CLI/README evidence, URL/Data/file icon inputs, environment-export acknowledgement, and Windows command/path behavior.

Apply depends on `unify-create-opentray-core`; yargs handlers are adapters and cannot reproduce Core validation, registry, process, or destructive logic.

## Guided Reading

1. `interview_plan.md` records the original CLI request, stable-web correction, English Skill decision, package topology, and dependency boundary.[^interview]
2. `specs/create-cli-command-tree/spec.md` defines yargs ownership, web/root dispatch, non-interactive create, precedence, and machine output.[^commands]
3. `specs/create-cli-app-management/spec.md` defines registry commands, edit/copy/export/uninstall, env acknowledgement, and Windows semantics.[^apps]
4. `specs/create-cli-skill/spec.md` defines the packaged English AI Skill and contained list/read behavior.[^skill]
5. `specs/create-cli-documentation/spec.md` defines command-accurate docs and supplied logo ownership.[^docs]
6. `tasks.md` provides the BDD-first implementation, packed-package, and native Windows evidence gates.[^tasks]

## Footnote References

[^interview]: interview_plan.md
[^tasks]: tasks.md
[^commands]: specs/create-cli-command-tree/spec.md
[^apps]: specs/create-cli-app-management/spec.md
[^skill]: specs/create-cli-skill/spec.md
[^docs]: specs/create-cli-documentation/spec.md
