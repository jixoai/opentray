## Lynx Review Bundle

This directory contains the workspace Lynx review bundle used by contributor visual acceptance:

```bash
pnpm --filter opentray example:daemon-lynx -- --bundle packages/cli/assets/lynx-review/main.lynx.bundle
```

The goal is human verification without depending on `research/` paths. Public `opentray` CLI commands stay limited to daemon lifecycle and health; smoke orchestration belongs in skills and workspace examples.

TODO:

- move the source of this review app into a tracked repo-owned source root instead of relying on a copied research build artifact
- keep the bundle focused on visual/runtime acceptance, not on product features unrelated to extension-host verification
