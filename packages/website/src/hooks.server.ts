// Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
// Asia/Shanghai: 所有站点需要至少提供中英两种语言的支持——/zh/ 中文镜像页;
// extended 2026-09-06, openspec change 2026-09-06-locale-negotiation):
// 1. per-locale <html lang>: app.html carries the %lang% placeholder and this
//    hook resolves it per request (the openspecui website precedent) through
//    the shared locale law in $lib/locale. adapter-static prerendering runs
//    through this hook, so the static output ships the right lang per page
//    with no client JS.
// 2. serving-mode base for the app.html negotiation script: %site_base% is
//    baked per build from the SAME env law as kit.paths.base in
//    svelte.config.js (SITE_CNAME=1 → root serving, else SITE_BASE). Env
//    parsing here, not $app/paths — during prerendering that `base` is
//    page-relative (see the $lib/locale header note).
import type { Handle } from '@sveltejs/kit';
import { pathnameLocale } from '$lib/locale';

const cnameMode = process.env.SITE_CNAME === '1';
const trimmedBase = (cnameMode ? '' : (process.env.SITE_BASE ?? '')).replace(/^\/+|\/+$/g, '');
const siteBase = trimmedBase === '' ? '' : `/${trimmedBase}`;

export const handle: Handle = async ({ event, resolve }) => {
  const htmlLang = pathnameLocale(event.url.pathname);
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      typeof html === 'string'
        ? html.replaceAll('%lang%', htmlLang).replaceAll('%site_base%', siteBase)
        : html,
  });
};
