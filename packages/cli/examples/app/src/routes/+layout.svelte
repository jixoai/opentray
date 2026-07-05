<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import { EXAMPLES } from "$lib/examples";

  let { children } = $props();

  // Compact sidebar (narrow) so individual example routes have maximum content
  // area. The webview-control route renders its own full-height layout, so we
  // only show the sidebar on the index and other panel-style routes.
  const pathname = $derived(String(page.url.pathname));
  const isFullScreen = $derived(pathname === "/webview-control");
</script>

{#if isFullScreen}
  {@render children()}
{:else}
  <div class="flex min-h-screen">
    <aside
      class="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r border-border bg-card/40 p-3 md:flex"
    >
      <a
        href="/"
        class="rounded-md px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent {pathname ===
        "/" ? "bg-accent" : ""}"
      >
        OpenTray Examples
      </a>
      <nav class="flex flex-col gap-0.5">
        {#each EXAMPLES as ex}
          <a
            href={ex.ready ? ex.href : undefined}
            class="rounded-md px-3 py-1.5 text-sm transition-colors {ex.ready
              ? "text-foreground hover:bg-accent"
              : "cursor-not-allowed text-muted-foreground/50"} {pathname === ex.href
              ? "bg-accent font-medium"
              : ""}"
            title={ex.ready ? ex.title : `${ex.title} (coming soon)`}
          >
            {ex.title}
          </a>
        {/each}
      </nav>
    </aside>
    <div class="min-w-0 flex-1">
      {@render children()}
    </div>
  </div>
{/if}
