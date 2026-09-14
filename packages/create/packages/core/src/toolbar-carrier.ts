// Orthogonal intents (2026-09-11, openspec change add-webview-orchestration;
// plan decisions D12/D13 — the multi-webview toolbar carrier shared by BOTH
// generated application forms):
// 1. Render the toolbar-carrier helper as one real JS source string embedded
//    verbatim by url-entry-template.ts and entry-template.ts (the command-app
//    address-bar/service window and the URL-app toolbar window are the SAME
//    carrier — D13's "one carrier, two applications" law).
// 2. Compose the window as a toolbar webview (shell-served toolbar page at a
//    fixed 44px top strip, created with the explicit bridge policy
//    { webviewId: true, messageChannels: true }) above a content webview
//    loading the target/service URL directly (no bridge policy = bridgeless —
//    arbitrary third-party content never gets a bridge, D2).
// 3. Drive navigation exclusively over the create-package-private message
//    channel (D12): the shell server exposes NO navigation HTTP endpoint;
//    commands, state queries, and state events flow only over the channel.
// 4. Project the sync defaults onto the CONTENT document (the real target
//    page): the title follows one-way through the entry because a
//    windowOnly session has no primary webview for native titleSync.
// 5. Self-heal the channel across toolbar-page reloads (P1-3, 2026-09-14
//    walkthrough): a manual reload (⌘R on the focused toolbar) kills the
//    page-side endpoint and D11 delivers the close to the host half. The
//    carrier rebuilds — debounced, never after teardown — recreating the
//    channel, reinstalling the command surface, and re-seeding the address
//    bar. The page side is already idempotent (onCreatedMessageChannel
//    re-subscription with pre-registration buffering).
// 6. Bootstrap milestones (harden-lifecycle-ownership D5): one structured
//    record per step (createWebviewToolbar/createWebviewContent/setLayout/
//    openChannel) flows through options.event into app.log — a healthy
//    narrative and the exact failed step are both attributable from the log
//    alone, and a failed step aborts the bootstrap (no later steps run).
//    The event sink is the embedding template's serial append queue (Codex
//    R2 P1, 2026-09-15): carrier records share the entry's one happens-before
//    chain, so a void submission still lands after every earlier record and
//    the entry's exit flush drains them with the rest of app.log.
//
// Channel payload schema (create-private, JSON over the channel payload —
// D12 deliberately keeps this schema OUT of @opentray/spec):
//   toolbar page → entry: {kind:"navigate",url} | {kind:"back"}
//                  | {kind:"forward"} | {kind:"reload"} | {kind:"get-url"}
//   entry → toolbar page: {kind:"url",url}
//     (both the urlChange push — the address bar's source of truth — and the
//      get-url answer use the same shape)
//   entry → toolbar page: {kind:"load-state",phase,url,progress?,errorCode?}
//     (D24 loadState forwarding: phase is always one of started/finished/
//      failed; progress ∈ [0,1] and errorCode are best-effort and omitted
//      when the native side did not observe them)

/** Debounce window that collapses a reload's close burst into one rebuild. */
const TOOLBAR_CHANNEL_REBUILD_DEBOUNCE_MS = 300;

/**
 * The generated-entry helper source. The embedding template supplies
 * `column`/`fixed`/`grow` (imported from "@opentray/ext-webview" beside
 * `WebviewExt`) — the carrier deliberately performs no imports of its own so
 * both templates stay single-import consumers of the facade. The template
 * also injects `options.log` (runtime notes) and `options.event` (structured
 * bootstrap-milestone sink into app.log, harden-lifecycle-ownership D5).
 */
export const toolbarCarrierSource = (): string => `// Toolbar navigation carrier (add-webview-orchestration plan D12/D13):
// composes the native navigation toolbar over one content webview and drives
// it through the create-private message channel. Channel failure is an
// exposed bug (D12: no fallback path) — errors land in app.log through
// options.log instead of being silently swallowed.
const TOOLBAR_CHANNEL_REBUILD_DEBOUNCE_MS = ${TOOLBAR_CHANNEL_REBUILD_DEBOUNCE_MS};

const attachToolbarCarrier = async (shell, options) => {
  // Bootstrap milestones (harden-lifecycle-ownership D5): one structured
  // record per carrier step through the embedding template's event sink
  // (app.log). Failure records are awaited so the failed step is durable
  // before the error aborts the bootstrap; ok records are best-effort but
  // still ordered — the sink is the template's serial append queue (Codex R2
  // P1), whose submission is synchronous, so a void call enters the same
  // happens-before chain and lands after every earlier record. Keep the ok
  // path void: the carrier's awaited per-step bootstrap structure is
  // unchanged and the queue owns the ordering.
  const event = typeof options.event === "function" ? options.event : () => {};
  const milestone = async (step, run) => {
    try {
      const value = await run();
      void event({ step, status: "ok" });
      return value;
    } catch (error) {
      await event({
        step,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
  // Per-child bridge policy (D2): the toolbar page is trusted shell UI and
  // gets exactly the channel surface; the content webview gets NO policy, so
  // it is bridgeless regardless of what it loads.
  await milestone("createWebviewToolbar", () => shell.createWebview({
    id: "toolbar",
    url: options.toolbarUrl,
    bridge: { webviewId: true, messageChannels: true },
  }));
  const content = await milestone("createWebviewContent", () => shell.createWebview({ id: "content", url: options.contentUrl }));
  // Declarative layered layout (D8 sugar): toolbar pinned at a fixed 44px
  // height, content filling the remainder; resize is recomputed natively.
  await milestone("setLayout", () => shell.setLayout(column([fixed("toolbar", 44), grow("content")])));
  const note = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    void options.log("toolbar carrier: " + message);
  };

  // Channel self-heal state (P1-3): the toolbar page's document owns its
  // endpoint half, so a document death (manual ⌘R reload) closes the channel
  // (D11 document_navigated semantics). The host half heals itself: debounced
  // recreate → reinstall command surface → re-seed the address bar. Posts
  // always flow through the CURRENT channel, so a dead document's last
  // in-flight pushes fail into app.log instead of a zombie endpoint.
  let channel = null;
  let stopped = false;
  let rebuildTimer = null;

  // Address-bar truth (D13): the content webview's urlChange events ARE the
  // address bar's source of truth — pushed over the channel, never scraped
  // from a wrapper document.
  const pushUrl = async (url) => {
    await channel.post({ kind: "url", url: String(url) });
  };
  content.onUrlChange((event) => {
    void pushUrl(event.url).catch(note);
  });
  // Loading affordance input (D24): the content webview's loadState pushes
  // (phase always; progress/errorCode best-effort) reach the toolbar page
  // over the same channel. The toolbar page owns the progress-bar state
  // machine — this carrier forwards verbatim and adds no interpretation, so
  // a missed "failed" frame (macOS dead-port loads finish about:blank
  // honestly) is converged by whatever terminal frame does arrive.
  const pushLoadState = async (event) => {
    const frame = { kind: "load-state", phase: event.phase, url: String(event.url) };
    if (typeof event.progress === "number") frame.progress = event.progress;
    if (typeof event.errorCode === "number") frame.errorCode = event.errorCode;
    await channel.post(frame);
  };
  content.onLoadState((event) => {
    void pushLoadState(event).catch(note);
  });
  if (options.titleFollows === true) {
    // Sync defaults project onto the CONTENT document (the real target page).
    // A windowOnly session has no primary webview for native titleSync, and
    // the v1 frozen facade exposes no host set-title command, so the entry is
    // the one-way projector through the native re-show title update
    // (apply_reused_show_updates): show({title, windowOnly}) on an existing
    // session updates the window title without touching content or
    // visibility. Icon following stays opt-in and carries no window-level
    // option here because a bridgeless content child is not a favicon
    // emitter (documented v1 limitation).
    const projectTitle = (title) => {
      if (typeof title === "string" && title.length > 0) {
        void shell.show({ title, windowOnly: true }).catch(note);
      }
    };
    content.onTitleChange((event) => {
      projectTitle(event.title);
    });
  }

  // Command surface (D12): instructions and state queries arrive as channel
  // payloads; back/forward drive the content webview's NATIVE history and
  // reload re-navigates to the current URL through the native navigate
  // command (never evaluate(location.reload()) on a wrapper). Installed as
  // one function so every rebuilt channel gets the identical surface.
  const installChannelCommandSurface = () => {
    channel.onMessage((payload) => {
      const message = typeof payload === "object" && payload !== null ? payload : {};
      const kind = message.kind;
      if (kind === "navigate" && typeof message.url === "string" && message.url.length > 0) {
        void content.navigate(message.url).catch(note);
        return;
      }
      if (kind === "back") {
        void content.back().catch(note);
        return;
      }
      if (kind === "forward") {
        void content.forward().catch(note);
        return;
      }
      if (kind === "reload") {
        void content.getUrl().then((state) => content.navigate(state.url)).catch(note);
        return;
      }
      if (kind === "get-url") {
        void content.getUrl().then((state) => pushUrl(state.url)).catch(note);
      }
    });
  };
  // Seed the address bar with the current truth (pre-subscription buffering
  // on both endpoints covers the race before the toolbar page registers).
  const seedAddressBar = () => {
    void content.getUrl().then((state) => pushUrl(state.url)).catch(note);
  };

  // One channel lifecycle: create, install the surface, observe the single
  // onClose (D11), and drop the replaced channel's tombstone (destroy is
  // best-effort cleanup of already-closed state).
  const openChannel = async () => {
    const next = await shell.createMessageChannel({ target: "toolbar" });
    if (stopped) {
      try { await next.destroy(); } catch { /* raced teardown */ }
      return;
    }
    const replaced = channel;
    channel = next;
    installChannelCommandSurface();
    channel.onClose(() => scheduleChannelRebuild());
    if (replaced !== null) {
      try { await replaced.destroy(); } catch { /* already closed */ }
    }
    seedAddressBar();
  };
  // Debounced self-heal (P1-3): a reload can emit several closes (both
  // endpoints observe one each, plus repeated reloads); exactly one rebuild
  // serves the burst. After stop() the carrier never rebuilds — a teardown
  // close (window destroyed / session closed) must not resurrect a channel
  // against a dying session.
  const scheduleChannelRebuild = () => {
    if (stopped || rebuildTimer !== null) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      if (stopped) return;
      void openChannel().catch(note);
    }, TOOLBAR_CHANNEL_REBUILD_DEBOUNCE_MS);
  };

  // The bootstrap channel gets the milestone record; self-heal rebuilds above
  // stay unrecorded (P1-3 steady-state, not bootstrap).
  await milestone("openChannel", openChannel);
  return {
    content,
    stop: () => {
      stopped = true;
      if (rebuildTimer !== null) {
        clearTimeout(rebuildTimer);
        rebuildTimer = null;
      }
    },
  };
};
`;
