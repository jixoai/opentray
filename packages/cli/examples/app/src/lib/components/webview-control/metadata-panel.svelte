<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { store, formatError } from "./store.svelte";
  import type { NavigatorWindow } from "$lib/types";

  type Props = { bridge: NavigatorWindow };
  let { bridge }: Props = $props();

  let titleInput = $state(store.title);
  let metadataStatus = $state<unknown>(null);

  // Keep input in sync with store title (which tracks titlechange events).
  $effect(() => {
    titleInput = store.title;
  });

  async function applyTitle(): Promise<void> {
    const title = titleInput.trim();
    if (!title) return;
    document.title = title;
    store.setTitle(title);
    metadataStatus = { appliedTitle: title };
    store.appendEvent("metadata.title", { appliedTitle: title });
  }
  async function getTitle(): Promise<void> {
    try {
      const title = (await bridge.getTitle()) as string;
      store.setTitle(title);
      metadataStatus = { nativeTitle: title };
      store.appendEvent("metadata.getTitle", { nativeTitle: title });
    } catch (error) {
      store.appendEvent("metadata.getTitle:error", { error: formatError(error) });
    }
  }
  async function getIcon(): Promise<void> {
    try {
      const icon = await bridge.getIcon();
      metadataStatus = { nativeIcon: icon };
      store.appendEvent("metadata.getIcon", { nativeIcon: icon });
    } catch (error) {
      store.appendEvent("metadata.getIcon:error", { error: formatError(error) });
    }
  }
  async function toggleFaviconAndIcon(): Promise<void> {
    // Draw a small colored favicon on a canvas, set it on the document, then
    // project it onto the native window icon.
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const hue = Math.floor(Math.random() * 360);
      ctx.fillStyle = `hsl(${hue} 70% 50%)`;
      ctx.fillRect(0, 0, 16, 16);
      const href = canvas.toDataURL("image/png");
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = href;
      await bridge.setIcon({ type: "href", href });
      metadataStatus = { projectedIcon: href.slice(0, 40) + "…" };
      store.appendEvent("metadata.setIcon", { projected: true });
    } catch (error) {
      store.appendEvent("metadata.setIcon:error", { error: formatError(error) });
    }
  }
</script>

<Card>
  <CardHeader>
    <CardTitle>Metadata</CardTitle>
  </CardHeader>
  <CardContent class="flex flex-col gap-3">
    <div class="grid gap-2">
      <Label for="title-input">Title</Label>
      <div class="flex gap-2">
        <Input id="title-input" value={titleInput} oninput={(e) => (titleInput = (e.target as HTMLInputElement).value)} placeholder="Document title" />
        <Button size="sm" onclick={applyTitle}>Apply</Button>
        <Button size="sm" variant="ghost" onclick={getTitle}>Get</Button>
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onclick={toggleFaviconAndIcon}>Toggle favicon → icon</Button>
      <Button size="sm" variant="ghost" onclick={getIcon}>Get icon</Button>
    </div>
    {#if metadataStatus}
      <pre class="overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(metadataStatus, null, 2)}</pre>
    {/if}
  </CardContent>
</Card>
