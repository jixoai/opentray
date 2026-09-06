// Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
// Asia/Shanghai: 所有站点需要至少提供中英两种语言的支持——/zh/ 中文镜像页):
// per-locale <html lang>: app.html carries the %lang% placeholder and this
// hook resolves it per request (the openspecui website precedent) through
// the shared locale law in $lib/locale. adapter-static prerendering runs
// through this hook, so the static output ships the right lang per page
// with no client JS.
import type { Handle } from '@sveltejs/kit';
import { pathnameLocale } from '$lib/locale';

export const handle: Handle = async ({ event, resolve }) => {
  const htmlLang = pathnameLocale(event.url.pathname);
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      typeof html === 'string' ? html.replaceAll('%lang%', htmlLang) : html,
  });
};
