> Orthogonal intents (maintained 2026-09-06 Asia/Shanghai): official-site
> capability; jixoai design-language adoption; GitHub Pages delivery.
>
> Original request (2026-09-06 Asia/Shanghai): 新增 ./opentray 官网站点
> （背景：./jixoai-ui 发布了新版本 0.3.0）。

## Why

OpenTray has no official site — the README is the only public surface, and the
project is about to be listed on jixoai.com with a `site` link that has no
target. jixoai-ui 0.3.0 published a complete website surface to the registry
(`website-scaffold`, `terminal-header/footer`, `hero-section`, `llms-txt`),
which makes a family-conformant static site a bootstrap operation instead of a
design project.

## What Changes

- Add `packages/website` — a SvelteKit + adapter-static site in the shared
  jixoai identity, bootstrapped from the official registry
  (`npx jixoai-ui init --hue 222`), hue sourced from the logo's cyan
  `#09CDFD` (oklch 221.6° → 222). Rendered primaries: light `#00a6f4`,
  dark `#00b8ec`.
- Content: hero (one-line positioning from README), features grid
  (tray-first model, createTray API, create-opentray scaffold, Rust core +
  broker, extension family, packaging layer, platform binaries, protocol
  dist-tags), quick-start terminal, ecosystem links (GitHub jixoai/opentray,
  npm `opentray`, skills docs).
- Assets: favicon/theme-color carry the project icon hex `#00a6f4`;
  logo source `docs/opentray-logo.png`.
- AI export layer: `llms.txt` / `llms-full.txt` / per-page `.md` mirrors via
  the registry `llms-txt` item, one generation point in the vite pipeline.
- Delivery: GitHub Pages via a new deploy workflow (push-to-main +
  workflow_dispatch). Custom-domain CNAME is Owner-managed and therefore
  gated behind a build flag — until DNS exists the site serves from the
  project pages path (`jixoai.github.io/opentray`), so the build supports a
  configurable base path. No release-catalog coupling (unlike unipty):
  content is hand-maintained in the package.
- No changes to runtime packages, crates, or existing workflows.

## Capabilities

### New Capabilities

- `website`: the official static site, its registry lock, content surface,
  AI export, and Pages delivery.
