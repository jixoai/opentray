<script lang="ts">
  import { onMount } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { NativeSelect } from "$lib/components/ui/select";
  import { Separator } from "$lib/components/ui/separator";
  import DownloadStatusBadge from "$lib/components/download-status-badge.svelte";
  import EventBadge from "$lib/components/event-badge.svelte";
  import { resolveBridge, DOWNLOAD_EVENT_NAMES } from "$lib/bridge";
  import { downloadEvents } from "$lib/event-log.svelte";
  import type { ActiveDownload } from "$lib/event-log.svelte";
  import {
    COLLISION_FILENAME,
    GITHUB_PRESETS,
    PAYLOAD_SIZES,
    buildPayloadBody,
    buildSlowDownloadUrl,
    triggerConcurrent,
    triggerDownload,
    triggerUrlDownload,
    uniqueFilename,
    type GitHubPreset,
    type PayloadSize,
  } from "$lib/downloads";
  import type { WebviewBridge } from "$lib/types";

  let bridge = $state<WebviewBridge | undefined>(undefined);
  let origin = $state<string>("");
  let filename = $state<string>(uniqueFilename("report"));
  let payloadSize = $state<PayloadSize>("medium");
  let concurrentCount = $state<number>(3);
  let filter = $state<string>("all");

  // Progress-test controls.
  type SlowSize = "256kb" | "1mb" | "4mb" | "16mb";
  const SLOW_SIZES: Record<SlowSize, { label: string; bytes: number }> = {
    "256kb": { label: "256 KB", bytes: 256 * 1024 },
    "1mb": { label: "1 MB", bytes: 1024 * 1024 },
    "4mb": { label: "4 MB", bytes: 4 * 1024 * 1024 },
    "16mb": { label: "16 MB", bytes: 16 * 1024 * 1024 },
  };
  let slowSize = $state<SlowSize>("4mb");
  let slowDelay = $state<number>(15);
  let githubPresetId = $state<string>(GITHUB_PRESETS[1]!.id);

  onMount(() => {
    bridge = resolveBridge();
    origin =
      typeof location !== "undefined" ? location.origin : "(no location)";
    if (bridge) {
      downloadEvents.attach(bridge);
    }
    // Expose smoke hooks so the Node-side smoke harness can drive the page via
    // webview.evaluate(). Kept out of the bundle's normal call graph.
    const g = globalThis as unknown as {
      __OPENTRAY_DOWNLOAD_EXAMPLE__?: {
        triggerCollision: () => void;
        triggerOne: () => void;
        triggerSlow: () => void;
      };
    };
    g.__OPENTRAY_DOWNLOAD_EXAMPLE__ = {
      triggerCollision: doCollisionDownload,
      triggerOne: () => doDownload(uniqueFilename("report")),
      triggerSlow: doSlowDownload,
    };
    return () => {
      delete g.__OPENTRAY_DOWNLOAD_EXAMPLE__;
      downloadEvents.detach();
    };
  });

  const bridgeReady = $derived(bridge !== undefined);

  function refreshFilename(): void {
    filename = uniqueFilename("report");
  }

  function onFilenameInput(e: Event): void {
    filename = (e.target as HTMLInputElement).value;
  }

  function onSizeChange(e: Event): void {
    payloadSize = (e.target as HTMLSelectElement).value as PayloadSize;
  }

  function onConcurrentChange(e: Event): void {
    concurrentCount = Math.max(
      1,
      Math.min(6, Number((e.target as HTMLSelectElement).value) || 1),
    );
  }

  function doDownload(name: string): void {
    if (!bridge) return;
    triggerDownload(name, buildPayloadBody(payloadSize));
  }

  function doCollisionDownload(): void {
    if (!bridge) return;
    // Always the same fixed name so repeated clicks produce `report (n).json`
    // while suggestedFilename stays `report.json`.
    triggerDownload(COLLISION_FILENAME, buildPayloadBody(payloadSize));
  }

  function doConcurrentDownload(): void {
    if (!bridge) return;
    triggerConcurrent("report", payloadSize, concurrentCount);
  }

  function onSlowSizeChange(e: Event): void {
    slowSize = (e.target as HTMLSelectElement).value as SlowSize;
  }

  function onSlowDelayInput(e: Event): void {
    slowDelay = Math.max(
      0,
      Math.min(2000, Number((e.target as HTMLInputElement).value) || 0),
    );
  }

  function onGithubPresetChange(e: Event): void {
    githubPresetId = (e.target as HTMLSelectElement).value;
  }

  // Local loopback slow download — the recommended progress-test source.
  // Stable, reproducible, offline, and tunable. The Vite middleware streams
  // the requested size with a per-chunk delay so progress events are visible.
  function doSlowDownload(): void {
    if (!bridge) return;
    const cfg = SLOW_SIZES[slowSize];
    if (!cfg) return;
    const url = buildSlowDownloadUrl({
      sizeBytes: cfg.bytes,
      chunkBytes: 64 * 1024,
      delayMs: slowDelay,
      filename: `opentray-slow-${slowSize}.bin`,
    });
    // No `download` attribute: rely on the middleware's Content-Disposition so
    // the native suggestedFilename comes from the server, not the anchor.
    triggerUrlDownload(url);
  }

  // Real-network GitHub download — exercises redirect + remote CDN throttling.
  // The native runtime reports the pre-redirect URL as the correlation key.
  function doGithubDownload(): void {
    if (!bridge) return;
    const preset = GITHUB_PRESETS.find((p) => p.id === githubPresetId);
    if (!preset) return;
    triggerUrlDownload(preset.url);
  }

  function clearLog(): void {
    downloadEvents.clear();
  }

  const filteredEntries = $derived(
    filter === "all"
      ? downloadEvents.entries
      : downloadEvents.entries.filter((e) => e.event === filter),
  );

  const activeList = $derived(
    downloadEvents.active.slice().sort((a, b) => b.startedAt - a.startedAt),
  );

  const summary = $derived(
    downloadEvents.counts.downloadstarted +
      downloadEvents.counts.downloadfailed +
      downloadEvents.counts.downloadcanceled,
  );
</script>

<main class="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
  <header class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">OpenTray Download Example</h1>
        <p class="text-sm text-muted-foreground">
          Svelte 5 + shadcn-svelte control panel for the WebView download lifecycle.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <Badge variant={bridgeReady ? "success" : "destructive"}>
          {bridgeReady ? "bridge ready" : "bridge missing"}
        </Badge>
        <Badge variant="muted" title="The page origin the native runtime classifies">
          {origin}
        </Badge>
      </div>
    </div>
    {#if !bridgeReady}
      <p class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        <code>navigator.opentrayWindow</code> / <code>navigator.window</code> is unavailable.
        Ensure the page is loaded from a <code>Local</code> origin (loopback) and
        <code>nativeWindowApi</code> is enabled on the window.
      </p>
    {/if}
  </header>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
    <!-- Controls -->
    <Card>
      <CardHeader>
        <CardTitle>Trigger downloads</CardTitle>
        <CardDescription>
          Each button starts a real blob download. The native WebView intercepts it
          and emits lifecycle events carrying both <code>filename</code> and
          <code>suggestedFilename</code>.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <Label for="filename">Filename</Label>
          <div class="flex gap-2">
            <Input
              id="filename"
              value={filename}
              oninput={onFilenameInput}
              placeholder="report.json"
            />
            <Button variant="outline" size="icon" onclick={refreshFilename} title="Generate a unique name">
              ↻
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Default is a unique name so Downloads is not polluted. Use the
            collision button below to verify <code>suggestedFilename</code> dedupe behavior.
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="size">Payload size</Label>
          <NativeSelect id="size" value={payloadSize} onchange={onSizeChange}>
            {#each Object.entries(PAYLOAD_SIZES) as [value, info]}
              <option value={value}>{info.label}</option>
            {/each}
          </NativeSelect>
        </div>

        <Separator />

        <div class="flex flex-wrap gap-2">
          <Button onclick={() => doDownload(filename || uniqueFilename("report"))} disabled={!bridgeReady}>
            Download report
          </Button>
          <Button variant="secondary" onclick={doCollisionDownload} disabled={!bridgeReady}
            title={`Always uses ${COLLISION_FILENAME}; click repeatedly to trigger dedupe`}>
            Fixed-name download (collision)
          </Button>
        </div>

        <Separator />

        <div class="flex flex-col gap-2">
          <Label for="concurrent">Concurrent downloads</Label>
          <div class="flex items-center gap-2">
            <NativeSelect
              id="concurrent"
              value={String(concurrentCount)}
              onchange={onConcurrentChange}
            >
              {#each [1, 2, 3, 4, 5, 6] as n}
                <option value={n}>{n} parallel</option>
              {/each}
            </NativeSelect>
            <Button variant="outline" onclick={doConcurrentDownload} disabled={!bridgeReady}>
              Fire concurrent
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Each parallel download gets a distinct filename so you can follow per-download
            progress and event correlation.
          </p>
        </div>

        <Separator />

        <div class="flex flex-col gap-2">
          <Label for="slow-size">Progress test — local slow download</Label>
          <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
            <NativeSelect id="slow-size" value={slowSize} onchange={onSlowSizeChange}>
              {#each Object.entries(SLOW_SIZES) as [value, info]}
                <option value={value}>{info.label}</option>
              {/each}
            </NativeSelect>
            <Input
              type="number"
              value={String(slowDelay)}
              oninput={onSlowDelayInput}
              placeholder="delay ms"
            />
            <Button onclick={doSlowDownload} disabled={!bridgeReady}>Start slow</Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Served by the example's own loopback Vite middleware. Tunable size + per-chunk
            delay produces reliable <code>downloadprogress</code> events. The recommended way
            to verify the active-downloads rows actually advance.
          </p>
        </div>

        <Separator />

        <div class="flex flex-col gap-2">
          <Label for="github-preset">Progress test — real network (GitHub)</Label>
          <div class="flex items-center gap-2">
            <NativeSelect
              id="github-preset"
              value={githubPresetId}
              onchange={onGithubPresetChange}
              class="min-w-0 flex-1"
            >
              {#each GITHUB_PRESETS as preset}
                <option value={preset.id}>{preset.label}</option>
              {/each}
            </NativeSelect>
            <Button variant="outline" onclick={doGithubDownload} disabled={!bridgeReady}>
              Download
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            Triggers a real GitHub release download (302 → CDN). The native runtime reports
            the pre-redirect URL, so the correlation key stays stable across the lifecycle.
          </p>
        </div>
      </CardContent>
    </Card>

    <!-- Active downloads -->
    <Card>
      <CardHeader>
        <CardTitle>Active downloads</CardTitle>
        <CardDescription>
          Live progress rows keyed by blob URL. Watch how <code>filename</code> and
          <code>suggestedFilename</code> diverge after a collision.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        {#if activeList.length === 0}
          <p class="text-sm text-muted-foreground">No active downloads yet.</p>
        {:else}
          {#each activeList as row (row.key)}
            {@const pct = row.totalBytes && row.totalBytes > 0
              ? row.receivedBytes / row.totalBytes
              : null}
            <div class="flex flex-col gap-2 rounded-lg border p-3">
              <div class="flex items-center justify-between gap-2">
                <code class="truncate text-sm font-medium" title={row.url}>{row.filename}</code>
                <DownloadStatusBadge status={row.status} success={row.success} />
              </div>
              {#if row.suggestedFilename !== null && row.suggestedFilename !== row.filename}
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-muted-foreground">suggestedFilename:</span>
                  <code class="rounded bg-muted px-1.5 py-0.5 text-emerald-500">{row.suggestedFilename}</code>
                </div>
              {/if}
              <div class="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                <div
                  class="h-full rounded-full bg-primary transition-[width] duration-150"
                  style:width={pct === null ? "30%" : `${Math.max(0, Math.min(1, pct)) * 100}%`}
                  style:opacity={pct === null ? "0.5" : "1"}
                ></div>
              </div>
              <div class="flex justify-between text-xs text-muted-foreground">
                <span>{formatBytes(row.receivedBytes)}{row.totalBytes ? ` / ${formatBytes(row.totalBytes)}` : ""}</span>
                <span class="truncate" title={row.url}>{shortUrl(row.url)}</span>
              </div>
            </div>
          {/each}
        {/if}
      </CardContent>
    </Card>
  </div>

  <!-- Event stream -->
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between gap-3">
        <div>
          <CardTitle>Event stream</CardTitle>
          <CardDescription>
            Raw download lifecycle events from <code>navigator.opentrayWindow.listen</code>.
            ({summary} triggers, {downloadEvents.counts.downloadcompleted} completed,
            {downloadEvents.counts.downloadfailed} failed)
          </CardDescription>
        </div>
        <div class="flex items-center gap-2">
          <NativeSelect value={filter} onchange={(e) => (filter = (e.target as HTMLSelectElement).value)}>
            <option value="all">all events</option>
            {#each DOWNLOAD_EVENT_NAMES as name}
              <option value={name}>{name}</option>
            {/each}
          </NativeSelect>
          <Button variant="ghost" size="sm" onclick={clearLog}>Clear</Button>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      {#if filteredEntries.length === 0}
        <p class="text-sm text-muted-foreground">No events yet. Trigger a download above.</p>
      {:else}
        <ol class="flex flex-col gap-1.5 font-mono text-xs">
          {#each filteredEntries as entry (entry.id)}
            {@const json = safeStringify(entry.payload)}
            <li class="flex flex-col gap-0.5 rounded-md border p-2" data-level={entry.level}>
              <div class="flex items-center gap-2">
                <span class="text-muted-foreground">{formatTime(entry.ts)}</span>
                <EventBadge event={entry.event} />
              </div>
              <pre class="whitespace-pre-wrap break-all text-[11px] leading-relaxed text-foreground/90">{json}</pre>
            </li>
          {/each}
        </ol>
      {/if}
    </CardContent>
  </Card>

  <footer class="pb-2 text-center text-xs text-muted-foreground">
    Loaded from <code>{origin}</code> · Classified as <code>Local</code> by the native runtime.
  </footer>
</main>

<script lang="ts" module>
  function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour12: false }) + "." +
      String(d.getMilliseconds()).padStart(3, "0");
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function shortUrl(url: string): string {
    if (url.length <= 48) return url;
    return url.slice(0, 24) + "…" + url.slice(-20);
  }

  function safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>
