> Execution law: implementation is delegated work; the visual acceptance and
> any DNS/CNAME decision stay with the Owner.

## 1. Site package

- [x] 1.1 Create `packages/website` in the pnpm workspace (private, zero
  runtime deps) with SvelteKit + adapter-static + Tailwind v4 + TypeScript
  strict, mirroring unipty `packages/www` as the structural precedent.
- [x] 1.2 Create `components.json` FIRST (hand-write following the unipty
  www precedent: shadcn schema fields, `tsx: true` is schema-mandatory,
  aliases with `ui → src/lib/ui`, `registries.@jixoai =
  "https://ui.jixoai.com/r/{name}.json"`) — `jixoai-ui init` refuses to run
  without it. Then `npx jixoai-ui init --hue 222`.
- [x] 1.3 Add site items: `scrollbar-measure` (import once in the root
  layout), `website-scaffold`, `terminal-header`, `terminal-footer`,
  `theme-toggle`, `hero-section`, `section-card`, `press-button`,
  `terminal-card`, `card-grid`, `llms-txt`. Then LOCK THE DEPENDENCY
  CLOSURE: shadcn installs dependency files but only explicitly-named items
  enter `jixoai-ui.lock`, and `upgrade` refreshes locked items only —
  explicitly `npx jixoai-ui add` every closure item that landed on disk
  (e.g. `icons`, `defaults`, `utils`, `jixoai-theme`, `navigation-menu`,
  `popover`, `density`, `paint`, `separator`, `figure`,
  `context-plugin`, `toc-engine` …as actually present) so nothing on disk
  is lock-orphaned; record any deliberate exclusion in NOTES.md.
- [x] 1.4 Pages: home (hero + features + quick-start + ecosystem links).
  All content from the README positioning; no invented claims.

## 2. Delivery

- [x] 2.1 Base-path-aware build: `svelte.config.js` reads an env var
  (e.g. `SITE_BASE`) into `kit.paths.base`; internal links resolve through
  `$app/paths` `base` (never hardcoded prefixes); CNAME flag switches the
  build to root serving. Document the two modes in the package README.
- [x] 2.2 GitHub Pages workflow (push to main + manual dispatch): pnpm
  install, build in subpath mode (`SITE_BASE=/opentray`) until the Owner
  sets DNS, static checks, deploy.
- [x] 2.3 Favicon + theme-color carry `#00a6f4`; logo copied from
  `docs/opentray-logo.png` into the site's static assets.
- [x] 2.4 Check the app.css supplies the token→utility mappings the
  registry sheet leaves empty (popover/destructive/input/ring/radius/
  shadows — the unipty NOTES pitfall) so Tailwind never silently falls
  back to soft defaults.

## 3. Verification

- [x] 3.1 `llms.txt` / per-page `.md` mirrors generate with absolute URLs,
  byte-identical on re-run.
- [x] 3.2 Build passes from a clean install; output serves correctly from a
  file/preview server under the configured base path (link check).
- [x] 3.3 jixoai-website skill verification checklist reviewed item by item;
  deviations recorded in the package NOTES.md.
