<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { EXAMPLES } from "$lib/examples";
</script>

<main class="mx-auto max-w-4xl p-8">
  <header class="mb-6">
    <h1 class="text-2xl font-semibold tracking-tight">OpenTray Examples</h1>
    <p class="mt-2 text-sm text-muted-foreground">
      Unified SvelteKit host. Each route is one WebView example, loaded from a
      loopback dev server so the native runtime classifies the page origin as
      <code>Local</code>.
    </p>
  </header>

  <div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
    {#each EXAMPLES as ex}
      <a
        href={ex.ready ? ex.href : undefined}
        class="block {ex.ready ? "cursor-pointer" : "cursor-not-allowed"}"
      >
        <Card class="h-full transition-colors {ex.ready ? "hover:bg-accent/40" : "opacity-60"}">
          <CardHeader>
            <div class="flex items-center justify-between gap-2">
              <CardTitle>{ex.title}</CardTitle>
              {#if !ex.ready}
                <Badge variant="muted">soon</Badge>
              {/if}
            </div>
          </CardHeader>
          <CardContent>
            <p class="text-sm text-muted-foreground">{ex.description}</p>
          </CardContent>
        </Card>
      </a>
    {/each}
  </div>
</main>
