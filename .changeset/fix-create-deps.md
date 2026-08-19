---
"create-opentray": patch
---

Fix install failure: `@create-opentray/core` and `@create-opentray/cli` were shipped as runtime `dependencies` although they are private workspace-only build atoms that do not exist on npm — consumers installing `create-opentray` hit 404 resolving them. They now live in `devDependencies`, which is also what makes tsdown bundle them into the published single-package dist (no residual imports). 0.21.0 is broken for fresh installs; 0.21.1 is the first installable release of command families.
