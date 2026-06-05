## OpenTray Lynx patches

This directory contains repo-owned patches that are applied onto the disposable
upstream Lynx checkout during `scripts/release/build-lynx-runtime.sh`.

Rules:

- Keep patches narrowly scoped to upstream/runtime laws that OpenTray depends on.
- Prefer patching upstream engine behavior over adding OpenTray-side gesture or
  event shims.
- Every patch here must participate in CI cache keys and native artifact
  verification triggers.
