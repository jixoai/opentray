> Orthogonal intents (maintained 2026-09-06 Asia/Shanghai): release
> automation (GitHub Releases as L1); site copy upgrade from project
> first principles.
>
> Original request (2026-09-06 Asia/Shanghai): 官网文案要升级（子代理
> 深入理解项目目的与初衷）；把没有好好配置 github-releases 的仓库
> CI/CD 升级为实现自动发布，让 jixoai.com 能显示版本号。

## Why

The repo ships npm packages via changesets but has ZERO GitHub Releases —
jixoai.com's version pill shows "v—" and the org blog has no L1 to link.
The site copy is also a feature inventory translated from the README; it
lists capabilities without narrating the project's purpose.

## What Changes

### 1. Release automation (L1)

- Extend the release pipeline so every published version ALSO cuts a
  GitHub Release (tag = the released package version, notes = the
  changesets-generated changelog section, assets = nothing extra).
- Automation triggers: changeset version/publish on main (existing path)
  gains a post-publish `gh release create` step; a `workflow_dispatch`
  input allows cutting a release for the CURRENT version without a bump
  (bootstrap path).
- Bootstrap: cut the FIRST GitHub Release now for the current published
  version via the new dispatch path (notes summarized from CHANGELOG.md),
  so jixoai.com lights up immediately.

### 2. Site copy upgrade (en + zh)

- Deep-read the project's intent sources (README pair, openspec/
  project.md + config vision, AGENTS.md intro, SPEC.md) and rewrite the
  site's hero positioning + feature narratives in BOTH locales: lead
  with the problem OpenTray exists to solve (CLI/AI-skill tools deserve
  a resident status surface without Electron-class weight), then the
  model (App/Tray/Session/Extension), then proof points. Facts must be
  traceable to the sources; no invented claims, no adjective stacking.

## Capabilities

### Modified Capabilities

- `website`: copy upgrade (both locales).
- (release automation: repo-level CI capability, documented in the
  workflow itself — no product spec delta.)

## Non-goals

- No changes to runtime packages, the changesets versioning policy, or
  the site's registry/lock surface beyond copy.
