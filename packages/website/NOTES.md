# OpenTray Website — Implementation Notes

Official static site for OpenTray (`@opentray/website`), first built
2026-09-06 from the jixoai-ui 0.3.0 registry. Structural precedent:
unipty `packages/www`.

## Registry consumption (2026-09-06)

- `components.json` was hand-written FIRST (jixoai-ui `init` refuses to run
  without it): shadcn schema fields, `tsx: true` (schema-mandatory even for
  Svelte), aliases `ui → src/lib/ui`, `registries.@jixoai`, `brandHue: 222`.
- `npx jixoai-ui init --hue 222` installed `jixoai-theme`
  (`src/lib/jixoai.css`) with the brand hue applied (222, from the logo cyan
  `#09CDFD`).
- Explicitly added and locked: `scrollbar-measure`, `website-scaffold`,
  `terminal-header`, `terminal-footer`, `theme-toggle`, `hero-section`,
  `section-card`, `press-button`, `terminal-card`, `card-grid`, `llms-txt`.
- Dependency closure explicitly locked (files land via registryDependencies,
  but only explicitly-named items enter `jixoai-ui.lock`): `icons`,
  `defaults`, `utils`, `navigation-menu`, `popover`, `density`, `paint`,
  `separator`, `figure`, `context-plugin`.
- **Deliberate exclusion**: `toc-engine` is NOT on disk and NOT locked — it
  only arrives with the `toc` item, and this single-page site ships no docs
  ToC. `surface-motion.ts` is a file inside the `popover` item, not a
  separate item.
- CLI quirks hit during install (recorded for the next consumer):
  - The registry fetches failed through the system proxy
    (`https_proxy=http://127.0.0.1:17890`) with "other side closed"; every
    `jixoai-ui` call needs `env -u https_proxy -u http_proxy …` on this
    machine.
  - `jixoai-ui add` aborts silently per item when a dependency file already
    exists (non-interactive `jixoai.css` overwrite prompt defaults to No) —
    items got LOCKED with no files on disk. Workaround: temporarily move
    `src/lib/jixoai.css` away before `add`; the CLI re-applies the hue
    afterwards.
  - `shadcn add` wrote the `llms-txt` plugin to `src/vite-plugins/llms-txt.mjs`
    even though the lock records `vite-plugins/llms-txt.mjs`. The file
    CONTENT hash matches the lock; only the recorded path differs.
    `vite.config.ts` imports from `./src/vite-plugins/llms-txt.mjs`.
  - The `jixoai-theme` lock hash never matches the on-disk `jixoai.css`
    because the CLI applies `--brand-hue: 222` AFTER capturing the registry
    hash — by design (`upgrade` refreshes then re-applies the hue).

## Deliberate divergences (skill law: document every one)

- **theme-color is `#00a6f4`** (the project icon hex), per the
  2026-09-06-add-website openspec change. The skill's tech-stack reference
  says `theme-color` should match the pure-black dark canvas (`#000000`);
  the change proposal overrides for this project. Recorded here as the
  binding decision.
- **No mdsvex/shiki.** Same as unipty: the site ships one code sample; a
  deterministic ~30-line tokenizer (`src/lib/highlight.ts`) tints
  comments/strings/keywords/numbers through theme tokens. Ported from the
  unipty www precedent.
- **`--radius-*: initial` reset lives in `src/app.css`.** The current
  registry sheet maps `--radius` but does not reset Tailwind's default
  radius scale; without the reset, `rounded-*` utilities would silently
  fall back to the soft default scale (the unipty-era pitfall, now narrowed
  to the radius axis — popover/destructive/input/ring/shadows are mapped
  upstream in jixoai-ui 0.3.0).
- **No hand-written reveal action.** The 0.3.0 theme sheet moved scroll
  reveal to pure CSS (`animation-timeline: view()`, static `data-reveal`
  attributes); the IO action + `html.js` reveal gate are retired upstream.
  `html.js` is still set by the app.html bootstrap because card-grid's
  entrance hidden state keys on it.
- **Favicon** is the shared `>_` terminal mark recipe with the project icon
  hex `#00a6f4` (unipty uses its own green); the logo PNG
  (`static/opentray-logo.png`) is a byte-identical copy of
  `docs/opentray-logo.png`.

## Base-path behavior (verified 2026-09-06)

- SvelteKit prerendering relativizes internal links and asset references
  (`./_app/...`), so the built page works under any subpath without
  absolute prefixes; `homeHref` is computed from `$app/paths` `base`.
- `llms.txt` / `llms-full.txt` / `index.md` regenerate byte-identically on
  re-build (sha256-verified twice); `SITE_URL` switches the canonical URL
  for the custom-domain cutover.
- CNAME gate: `SITE_CNAME=1` without `SITE_DOMAIN` fails the build with a
  named error; with it, `dist/CNAME` is written after the vite build (the
  AI export layer never sees CNAME — it is not HTML, so byte-stability is
  unaffected).
