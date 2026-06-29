# TOC

## Preface

One or two plain-language paragraphs describing what this change accomplishes and the final visible effect the operator will see, trust, or stop worrying about when it is correct.

If open issues block exit, name their issue ids, groups, and dependency blockers here, so the next iteration knows where to resume.

## Guided Reading

Walk the reader through the artifacts in the order they should be read. Prefer a short ordered list with one sentence per artifact.

1. `interview_plan.md` - the intent source of truth and the Q&A ledger.
2. `specs/<capability>/spec.md` - the durable capability contracts.
3. `tasks.md` - the executable work with BDD gates.
4. `issues/` - typed iteration findings discovered during implementation; inspect with `bun run openspec:vision2 -- issues <change> --group-by group`.

## Footnote References

Every spec file MUST be cited by at least one footnote here. The footnote id is arbitrary; the value is the path relative to the change directory. Add one footnote per spec file, and optionally cite the interview/tasks/key-issues artifacts.

[^interview]: interview_plan.md

[^tasks]: tasks.md

[^capability]: specs/capability/spec.md

<!-- Replace the placeholder footnotes above with real references to your spec files. -->
<!-- `bun run openspec:vision2 -- check <change>` enforces: every specs/**/*.md is cited, and every cited path exists. -->
