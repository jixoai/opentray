## 1. Release automation

- [x] 1.1 Extend the release workflow: after a successful changeset
  publish, create the matching GitHub Release (tag = version, notes =
  changelog section); add a `workflow_dispatch` "release current version"
  mode as the bootstrap path.
- [x] 1.2 Bootstrap the first GitHub Release for the current version
  (notes from CHANGELOG.md summary) via the new path; verify it appears
  (gh api) and jixoai.com's fetch resolves it on next build.
  - 2026-09-06: `opentray@0.21.1` cut via `scripts/binaries/cut-github-release.ts`
    (the same script the workflow jobs call), tag landed on the version-bump
    commit `d3995a3`; verified through `gh api repos/jixoai/opentray/releases`.
    Note: npm `latest` is 0.21.1 (not 0.21.0) — the task brief's version was
    stale; 0.21.1 is also the first installable release of the
    create-opentray command families.

## 2. Site copy upgrade

- [x] 2.1 Read the intent sources (README pair, openspec project/config,
  AGENTS.md intro, SPEC.md); extract the "why this project exists"
  narrative and 3-4 proof points.
  - Core narrative from AGENTS.md Vision ("not 'show a tray icon' … without
    forcing users into Electron"), SPEC.md ("with one install"), README
    (broker-not-addon, per-platform binaries, four bundler adapters).
- [x] 2.2 Rewrite hero + features copy in en and zh (home-content
  dictionary); purpose-led, numbers/facts from sources only; keep the
  quick-start and ecosystem sections factual.
- [x] 2.3 Rebuild both locales + both serving modes green; static checks
  pass; NOTES.md updated; friction log reported.
  - CNAME mode (`SITE_CNAME=1 SITE_DOMAIN=opentray.jixoai.com
    SITE_URL=https://opentray.jixoai.com`) and subpath mode
    (`SITE_BASE=/opentray`) both build + `check` PASS; en/zh copy verified
    present in dist HTML and the llms.md mirrors.
