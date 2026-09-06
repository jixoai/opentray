// Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
// Asia/Shanghai: 所有站点需要至少提供中英两种语言的支持——/zh/ 中文镜像页):
// the zh mirror serves WITH its trailing slash (dist/zh/index.html) so the
// directory URL `/zh/` resolves on plain static hosts; the global layout's
// `never` applies everywhere else. Prerendering is inherited from the root
// layout (fully static output).
export const trailingSlash = 'always';
