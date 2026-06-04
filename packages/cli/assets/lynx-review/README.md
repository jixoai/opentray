## Lynx Review Bundle

This directory contains the package-owned Lynx review bundle used by the public CLI smoke:

```bash
opentray smoke daemon-lynx
```

The goal is post-publish human verification. A fresh npm install must be able to open a real Lynx window without depending on a workspace checkout or `research/` paths.

TODO:

- move the source of this review app into a tracked repo-owned source root instead of relying on a copied research build artifact
- keep the bundle focused on visual/runtime acceptance, not on product features unrelated to extension-host verification
