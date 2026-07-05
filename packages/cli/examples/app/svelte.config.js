import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Pure CSR SPA. Pages depend on navigator.opentrayWindow (client-only), so SSR
// and prerendering are both off. The app is only ever loaded from a loopback
// dev/preview server inside a WebView window, never statically hosted.
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
  },
};
