---
"create-opentray": minor
"@opentray/create-webui": minor
---

One-click kernel upgrades for generated apps. A project's kernel — the `opentray` and `@opentray/ext-webview` entries in its `dependencies` — advances through the project's own package manager (lockfile-derived npm/pnpm/bun) with live entry instances stopped first; the runtime's artifact-identity check replaces any old broker on the next start, so an upgrade is a plain dependency-graph advance with no manual cleanup. Version truth (`from`/`to`) reads the actually installed `node_modules` manifests, an install failure surfaces a bounded output tail, and `from == to` reports `alreadyUpToDate`.

Both vectors delegate to one core procedure: the CLI offers `app upgrade <app-id>… | --all [--target <spec>] [--restart]` with sequential fan-out (per-project FAILED blocks never hide behind a batch summary, and dual-layout addressing resolves wizard projects without a v1 envelope — by directory key or dotted appId), while the webui applications page adds per-row selection with select-all and an upgrade action that runs sequentially over the selection and renders each project's outcome — including failure install tails — in its result panel.
