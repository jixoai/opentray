// Disable SSR and prerendering. Every page reads navigator.opentrayWindow,
// which only exists inside the WebView client runtime, so the app must render
// purely client-side.
export const ssr = false;
export const prerender = false;
