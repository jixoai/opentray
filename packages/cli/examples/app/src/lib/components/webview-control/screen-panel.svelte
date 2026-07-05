<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { store, formatError, type ScreenApi } from "./store.svelte";

  type Props = { screenApi: ScreenApi | undefined };
  let { screenApi }: Props = $props();

  let details = $state<unknown>(null);
  let globalAvailable = $state(false);

  // The host binds window.getScreenDetails when bindScreenGlobals is on; the
  // standard Window type does not declare it, so narrow via a runtime check.
  function getGlobalScreenDetails(): ((() => Promise<unknown>) | undefined) {
    if (typeof window === "undefined") return undefined;
    const fn = (window as unknown as { getScreenDetails?: () => Promise<unknown> }).getScreenDetails;
    return typeof fn === "function" ? fn : undefined;
  }

  $effect(() => {
    globalAvailable = getGlobalScreenDetails() !== undefined;
  });

  async function fetchDetails(): Promise<void> {
    if (!screenApi) {
      details = { error: "screen API unavailable" };
      return;
    }
    try {
      const result = await screenApi.getScreenDetails();
      details = result;
      store.appendEvent("screen.details", result);
    } catch (error) {
      details = { error: formatError(error) };
      store.appendEvent("screen.details:error", { error: formatError(error) });
    }
  }
  async function fetchGlobal(): Promise<void> {
    const fn = getGlobalScreenDetails();
    if (!fn) return;
    try {
      const result = await fn();
      details = result;
      store.appendEvent("screen.globalDetails", result);
    } catch (error) {
      details = { error: formatError(error) };
    }
  }
</script>

<Card>
  <CardHeader>
    <CardTitle>Screen</CardTitle>
  </CardHeader>
  <CardContent class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-2">
      <Button size="sm" onclick={fetchDetails} disabled={!screenApi}>getScreenDetails</Button>
      <Button size="sm" variant="secondary" onclick={fetchGlobal} disabled={!globalAvailable}>
        window.getScreenDetails
      </Button>
    </div>
    {#if details}
      <pre class="overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(details, null, 2)}</pre>
    {/if}
  </CardContent>
</Card>
