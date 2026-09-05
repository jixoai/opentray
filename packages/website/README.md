# OpenTray Website

Private static official site for OpenTray (`@opentray/website`) — SvelteKit +
adapter-static in the shared jixoai identity (registry `@jixoai`, brand hue
222 from the logo cyan `#09CDFD`), deployed to GitHub Pages.

- Zero runtime dependencies; devDependencies are the site toolchain only.
- Entire visual identity comes from the official registry
  (<https://ui.jixoai.com>) via `jixoai-ui.lock` — run
  `npx jixoai-ui upgrade` to refresh locked items, then rebuild.
- Content is hand-maintained here and sourced from the repository README
  (no release-catalog coupling).

## Commands

```bash
pnpm --filter @opentray/website... install   # site subset only
pnpm --filter @opentray/website run dev      # vite dev on port 13122
pnpm --filter @opentray/website run build    # vite build + CNAME gate
pnpm --filter @opentray/website run check    # static link + AI export checks
```

## The two serving modes

The build supports root and subpath serving from one configuration. CNAME /
custom-domain DNS is Owner-managed external configuration, so the cutover is
gated behind build flags — no code change:

| Mode | Env | Base path | `llms.txt` canonical URL | `dist/CNAME` |
| ---- | --- | --------- | ------------------------ | ------------ |
| Project pages path (current) | `SITE_BASE=/opentray` | `/opentray` | `https://jixoai.github.io/opentray` (default `SITE_URL`) | not written |
| Custom domain (after DNS) | `SITE_CNAME=1` `SITE_URL=https://<domain>` `SITE_DOMAIN=<domain>` | `/` (root) | `SITE_URL` | written (`SITE_DOMAIN`) |

- `svelte.config.js` reads `SITE_BASE` (ignored when `SITE_CNAME=1` forces
  root serving) into `kit.paths.base`; internal links resolve through
  `$app/paths` — nothing hardcodes a prefix.
- `scripts/build.mjs` runs `vite build` (the registry `llms-txt` vite plugin
  is the single AI-export generation point) and then writes `dist/CNAME`
  only in CNAME mode (`SITE_DOMAIN` is required — the build fails rather
  than inventing a domain).
- `scripts/check-site.mjs` validates the built output under the configured
  base: local references resolve, none escape the base path, `llms.txt` has
  absolute links, and the per-page `.md` mirror exists.

## AI export layer

`llms.txt`, `llms-full.txt`, and the per-page `index.md` mirror are generated
at build time by the registry `llms-txt` vite plugin (`src/vite-plugins/`,
locked in `jixoai-ui.lock`). Re-running the build without content changes is
byte-identical.
