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
- Locale surface (2026-09-06 site-i18n-zh change): `language-switcher` added
  as a single-item `add` (23 items in the lock now); its closure
  (`utils`, `jixoai-theme`, `icons`, `defaults`) was already installed and
  locked, so no other items moved. The CLI re-created `src/lib/jixoai.css`
  (hue 222 re-applied) — byte-identical to the previous on-disk file, and
  the alias-resolved `src/lib/ui/language-switcher/**` paths landed directly
  (no `src/@ui/` relocation needed this time).
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

## Locale surface (2026-09-06, openspec change 2026-09-06-site-i18n-zh)

- `/` stays English (stable inbound URLs); `/zh/` is the Chinese mirror.
  Both routes render the SAME shared component (`home-page.svelte`) over
  per-locale dictionaries in `src/lib/home-content.ts` (en from README.md,
  zh from README-zh.md), so the pages are isomorphic by construction and
  copy cannot drift structurally.
- `<html lang>`: app.html carries the `%lang%` placeholder resolved by
  `src/hooks.server.ts` through the shared pathname law in
  `src/lib/locale.ts` (openspecui website precedent). Client-side locale
  hops never re-run the server hook, so the layout also syncs
  `document.documentElement.lang` in a `$effect` (SSR never runs effects —
  prerendered pages keep the server-resolved lang).
- **Detection is pathname-based, not `$app/paths`-base-based** (pitfall
  found the hard way): during prerender `base` from `$app/paths` is
  page-RELATIVE (`.` at the root, `..` under `/zh/`) because
  `paths.relative` defaults to true, so stripping the config base off
  `page.url.pathname` cannot work — `page.url.pathname` itself is always
  absolute (base included). `$lib/locale` matches the `zh` segment under an
  optional base segment instead; the same law serves the hook and the
  layout chrome.
- `/zh/` serves WITH its trailing slash: a page-level
  `export const trailingSlash = 'always'` in `src/routes/zh/+page.ts`
  overrides the global `never` so `dist/zh/index.html` exists and the
  directory URL resolves on plain static hosts (`/opentray/zh` → 301 by
  the host, GitHub Pages behavior included).
- hreflang alternates (en / zh / x-default, absolute) render in both
  pages' heads from `SITE_URL`; `constants.ts` now resolves it from the
  build-time `__SITE_URL__` define (fed by the same `SITE_URL` env as the
  llms.txt plugin), so head alternates and the AI export layer move
  together at the custom-domain cutover.
- llms.txt locale split: `locale: { segments: ['zh'], default: '' }` in the
  plugin config — root `llms.txt` (en + an "Other languages" section
  linking `zh/llms.txt`), `zh/llms.txt`, per-page mirrors `index.md` +
  `zh/index.md`; `llms-full.txt` follows the default locale only (the
  plugin's mixed-language-dump rule). Byte-identity re-verified twice in
  both root and `/opentray` base modes.
- Header switcher composition: `switcherFrame={false}` with
  `LanguageSwitcher` + `ThemeToggle` in one flex cluster (both controls are
  self-framed) — the openspecui bilingual-site composition; this also
  removes the pre-existing frame-in-frame on the compact ThemeToggle.
  Switcher hrefs carry the live URL hash (`$derived` on `page.url.hash`,
  empty at prerender), so locale hops preserve the current anchor; brand
  link and the Overview entry stay on the current locale.
- `scripts/check-site.mjs` extended: both pages' refs resolve (nested
  pages ship page-relative `../` refs — resolution is per-page-directory
  now), hreflang + `<html lang>` assertions per page, and the zh AI-export
  set (`zh/llms.txt`, `zh/index.md`, "Other languages" cross-link).

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

## Purpose-led copy rewrite (2026-09-06, release-automation-and-copy)

- Hero and all eight feature cards rewritten from feature-inventory prose
  to purpose-led narrative in both locales (home-content.ts). Every claim
  stays traceable: the "not a tray icon — an entry point without Electron"
  framing is AGENTS.md Vision verbatim in intent; "one install" is SPEC.md;
  broker-not-addon / no-worker-split is README Packaging; "six platforms"
  counts the six `<os>-<arch>` runtime packages (3 OSes × 2 arches); the
  "four adapters" count is the README packaging section.
- Traceability anchors live in the home-content.ts header comment and the
  openspec change tasks; feature ids were re-keyed (`tray-first` → `why`)
  to match the new first card ("why it exists" leads the grid).
- zh quotes use 「」 inside single-quoted TS strings (no escaping churn);
  hero title splits keep the `<em>` rung on the contrast word
  (en `without` / zh `不必`) so both locales emphasize the same token.
- Both serving modes re-verified after the rewrite: CNAME mode and
  `SITE_BASE=/opentray` build + check-site PASS; new copy grep-verified in
  dist HTML and both llms.md mirrors (en/zh isomorphic).

## Locale negotiation (2026-09-06 locale-negotiation change)

- Pre-paint bootstrap in `src/app.html` (inline, before first paint): a
  zh-preferring visitor on the DEFAULT (en) surface is sent once to the
  same page under `/zh/` (path + hash preserved) via `location.replace`
  (no history entry). Precedence: explicit persisted choice
  (localStorage `lang`) > first `navigator.languages` match on the
  primary subtag (zh-CN/zh-Hans → zh; en-US wins the stay, so
  `['en-US','zh-CN']` stays — first match wins).
- **The law: detection only happens on the default-language surface; the
  non-default surface never redirects.** Loop-proof by construction:
  the script only redirects away from the default surface, the target
  always carries the `/zh/` prefix (so the condition can never hold
  again), and nothing ever redirects back from `/zh/`. Crawlers/no-JS
  get the static default (hreflang carries the alternates).
- Base-aware by baking: `hooks.server.ts` substitutes the
  serving-mode base into the script from the SAME env law as
  `kit.paths.base` (SITE_CNAME=1 → '', else SITE_BASE) — env parsing,
  not `$app/paths`, because that `base` is page-relative during
  prerendering (see the `$lib/locale` header note). Verified baked
  values in both modes' dist: `''` (CNAME) and `'/opentray'`
  (SITE_BASE=/opentray).
- Switcher persistence moved INTO the registry `language-switcher`
  (consumer-feedback-fixes P0-2, 2026-09-06 upgrade): the component's
  own click handler writes localStorage `lang`, so the layout-level
  DELEGATED click handler on the bezel wrapper was REMOVED. An explicit
  click still always beats detection.
- Verification (playwright-core 1.63, machine-cached Chromium):
  3-site matrix × both serving modes — zh-CN → `/zh/` (hash preserved),
  zh-Hans-CN primary-subtag hit, en-US stay, en-US-first list stay,
  pt-BR-first list walk → `/zh/`, stored `zh` honored, stored `en` on
  `/zh/` stays (no bounce), zh-CN on `/zh/` stays (loop law) — 16/16
  per-mode cases + real-click switcher persistence (writes `lang`,
  lands on target surface) all green; builds + check-site PASS in both
  modes; dev server spot check confirms the placeholders resolve in
  the dev pipeline too.

## Upstream consumer-feedback-fixes consumption (2026-09-06)

- `npx jixoai-ui upgrade` (registry ui.jixoai.com): updated 8 items
  (`jixoai-theme`, `scrollbar-measure`, `theme-toggle`, `hero-section`,
  `press-button`, `defaults`, `context-plugin`, `language-switcher`),
  56 unchanged, 3 skipped (CLI 已锁未装 foolproofing). Lock 23 → 23
  items; lock↔disk hash verify 63/64 files exact (the one divergence is
  `jixoai.css`: lock records the pre-hue canonical hash by design, the
  on-disk file carries the applied hue 222 — re-applied by the upgrade,
  verified `--brand-hue: 222`).
- Hack removal: the `persistLocale` event-delegation hack in
  `+layout.svelte` (bezel-wrapper `onclick` reading `a[hreflang]`) is
  deleted — the upgraded registry `language-switcher` now ships the
  persistence contract itself (P0-2: click → `localStorage.lang`,
  try/catch silent, pure anchor navigation preserved). Layout header
  comment updated accordingly (intent 5 folded into intent 4).
- `theme-toggle` gained an optional `labels` prop (localization of the
  full variant's text labels); this site uses `variant="compact"`
  (icon-only), so no labels passed — English defaults are fine.
- `jixoai.css` comment-context fix consumed (the --brand-hue comment now
  states consumers keep the static hue; the wall-clock rotation note is
  scoped to ui.jixoai.com itself).
- Verification: dual-mode builds PASS (default subpath + SITE_CNAME=1
  SITE_DOMAIN=opentray.jixoai.com SITE_URL=https://opentray.jixoai.com,
  dist/CNAME written), check-site PASS in CNAME mode; playwright
  headless spot check on dev (port 13126): click 中文 → `lang=zh` +
  lands `/zh/`, reload stays zh with `<html lang="zh">`, click EN →
  `lang=en` + reload stays en — 6/6 green.
