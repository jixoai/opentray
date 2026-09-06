## 1. README-zh

- [x] 1.1 Author `README-zh.md` (faithful translation of README.md, 222
  lines; identical structure/tables/code; top language cross-links
  English | 简体中文 like the dweb/iweb pairs).

## 2. Site locale surface

- [x] 2.1 `/` = en (unchanged URLs); `/zh/` mirror page with copy from
  README-zh.md; `<html lang>` per locale; hreflang alternates
  (en/zh/x-default).
- [x] 2.2 `npx jixoai-ui add language-switcher` (one item, verify disk
  landed — the non-interactive trap), wire into terminal-header; switcher
  preserves the current anchor/path across locales.
- [x] 2.3 llms export covers both locales (absolute URLs); re-run builds
  byte-identical; static spot-check `/zh/` 200 under the SITE_BASE mount.
- [x] 2.4 `pnpm --filter @opentray/website... build` green.

## 3. Wrap

- [x] 3.1 NOTES.md deviations updated; friction log reported.
