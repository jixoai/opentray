<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";

  let url = $state(typeof location !== "undefined" ? location.href : "");
  let status = $state<Record<string, unknown>>(
    typeof location !== "undefined"
      ? { href: location.href, origin: location.origin }
      : {},
  );

  function navigate(): void {
    if (!url.trim()) return;
    location.href = url.trim();
  }
  function back(): void {
    history.back();
  }
  function reload(): void {
    location.reload();
  }
  function updateStatus(): void {
    status = { href: location.href, origin: location.origin };
  }
</script>

<Card>
  <CardHeader>
    <CardTitle>Navigation</CardTitle>
  </CardHeader>
  <CardContent class="flex flex-col gap-3">
    <div class="grid gap-2">
      <Label for="url-input">URL</Label>
      <div class="flex gap-2">
        <Input id="url-input" value={url} oninput={(e) => (url = (e.target as HTMLInputElement).value)} placeholder="https://…" />
        <Button size="sm" onclick={navigate}>Go</Button>
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" onclick={back}>Back</Button>
      <Button size="sm" variant="secondary" onclick={reload}>Reload</Button>
      <Button size="sm" variant="ghost" onclick={updateStatus}>Refresh status</Button>
    </div>
    <pre class="overflow-auto rounded-md bg-muted/40 p-2 text-[11px] whitespace-pre-wrap break-all">{JSON.stringify(status, null, 2)}</pre>
  </CardContent>
</Card>
