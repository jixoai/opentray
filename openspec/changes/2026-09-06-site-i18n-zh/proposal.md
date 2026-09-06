> Orthogonal intents (maintained 2026-09-06 Asia/Shanghai): site i18n (en/zh);
> README-zh authoring.
>
> Original request (2026-09-06 Asia/Shanghai): 所有站点需要至少提供中英两种
> 语言的支持，这需要同步更新所有的 README.md，提供 README-zh.md 等。
> OpenTray 是唯一缺 README-zh.md 的项目站点。

## Why

The new official site ships English-only while the family's bilingual
convention (openspecui website, unipty/opendweb/openiweb README pairs)
expects zh. The repo itself has no README-zh.md — the only flagship without
one.

## What Changes

- Author `README-zh.md` at the repo root as a faithful zh translation of
  `README.md` (structure, tables, code blocks identical; prose translated;
  links cross-referenced zh↔en via a language line at top, matching the
  unipty/opendweb README pair convention).
- Site i18n: `/` stays English (stable inbound URLs); add a `/zh/` mirror
  of the home page with zh copy sourced from README-zh.md. Locale-aware
  `<html lang>`, hreflang alternates, and the registry `language-switcher`
  component (add + lock, closure per lock law) wired into terminal-header.
- llms export mirrors both locales with absolute URLs.

## Capabilities

### Modified Capabilities

- `website`: locale surface (en root + /zh/ mirror, switcher, hreflang,
  bilingual AI export).
