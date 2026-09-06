/**
 * Orthogonal intents (maintained 2026-09-06; original user request: 新增
 * ./opentray 官网站点; extended 2026-09-06: 所有站点需要至少提供中英两种
 * 语言的支持——hreflang alternates need the canonical origin):
 * 1. Single source of the public identity: repo, npm, and the project pages
 *    URL the AI export layer treats as canonical.
 * 2. Ecosystem links stay README facts (no invented properties).
 * 3. SITE_URL resolves from the build-time __SITE_URL__ define (fed by the
 *    SITE_URL env in vite.config.ts, same default) so head hreflang and the
 *    llms.txt layer move together at the custom-domain cutover.
 */

declare const __SITE_URL__: string | undefined;

export const SITE_URL =
  typeof __SITE_URL__ === 'string' ? __SITE_URL__ : 'https://jixoai.github.io/opentray';
export const SITE_DOMAIN = 'jixoai.github.io/opentray';
export const SITE_SUBTITLE = 'desktop status runtime';
export const GITHUB_URL = 'https://github.com/jixoai/opentray';
export const NPM_URL = 'https://www.npmjs.com/package/opentray';
export const CREATE_APP_GUIDE_URL = `${GITHUB_URL}/blob/main/skills/opentray/references/create-app.md`;
export const APP_MODE_GUIDE_URL = `${GITHUB_URL}/blob/main/skills/opentray/references/app-mode.md`;
export const LYNX_EXT_URL = 'https://github.com/jixoai/opentray-ext-lynx';
