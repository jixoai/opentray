<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { EXAMPLES } from "$lib/examples";

  // The index page is the only route that carries navigation chrome. Each
  // example route is a fully isolated window surface; this page is the
  // launchpad that links to them.
</script>

<div class="flex min-h-screen">
  <aside
    class="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r border-border bg-card/40 p-3 md:flex"
  >
    <a href="/" class="rounded-md bg-accent px-3 py-2 text-sm font-semibold">
      OpenTray Examples
    </a>
    <nav class="flex flex-col gap-0.5">
      {#each EXAMPLES as ex}
        <a
          href={ex.href}
          class="rounded-md px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          title={ex.title}
        >
          {ex.title}
        </a>
      {/each}
    </nav>
  </aside>
  <main class="min-w-0 flex-1 bg-background/70 p-8 backdrop-blur-xl">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight">OpenTray Examples</h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Unified SvelteKit host. Each route is one isolated WebView example —
        they share a component library but no runtime chrome. Pages load from a
        loopback dev server so the native runtime classifies the origin as
        <code>Local</code>.
      </p>
    </header>

    <div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
      {#each EXAMPLES as ex}
        <a href={ex.href} class="block cursor-pointer">
          <Card class="h-full transition-colors hover:bg-accent/40">
            <CardHeader>
              <CardTitle>{ex.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p class="text-sm text-muted-foreground">{ex.description}</p>
            </CardContent>
          </Card>
        </a>
      {/each}
    </div>
  </main>
</div>
