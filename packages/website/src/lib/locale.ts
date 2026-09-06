/**
 * Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
 * Asia/Shanghai: 所有站点需要至少提供中英两种语言的支持——/zh/ 中文镜像页):
 * 1. ONE locale-detection law shared by the server hook (<html lang>) and
 *    the layout chrome (switcher `current`, locale-aware home links): a
 *    pathname is zh when its `zh` segment sits directly under the (possibly
 *    configured) base — the regex tolerates an optional base segment so
 *    `/zh/` (root serving) and `/opentray/zh/` (project pages path) resolve
 *    identically.
 * 2. Why pathname-based and not `$app/paths` `base` stripping: during
 *    prerendering `base` is page-RELATIVE (`.` / `..`) when
 *    `paths.relative` is at its default, so string-stripping the config
 *    base against `page.url.pathname` cannot work; `page.url.pathname`
 *    itself is always the absolute path including the base.
 */

export type Locale = 'en' | 'zh';

/** `/zh/…` or `/<base>/zh/…` — the zh mirror subtree. */
const ZH_PATH = /^\/(?:[^/?#]+\/)?zh(?:\/|$)/;

export function pathnameLocale(pathname: string): Locale {
  return ZH_PATH.test(pathname) ? 'zh' : 'en';
}
