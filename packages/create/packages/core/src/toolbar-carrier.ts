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

/**
 * The generated-entry helper source. The embedding template supplies
 * `column`/`fixed`/`grow` (imported from "@opentray/ext-webview" beside
 * `WebviewExt`) — the carrier deliberately performs no imports of its own so
 * both templates stay single-import consumers of the facade.
 */
export const toolbarCarrierSource = (): string => `// Toolbar navigation carrier (add-webview-orchestration plan D12/D13):
// composes the native navigation toolbar over one content webview and drives
// it through the create-private message channel. Channel failure is an
// exposed bug (D12: no fallback path) — errors land in app.log through
// options.log instead of being silently swallowed.
const attachToolbarCarrier = async (shell, options) => {
  // Per-child bridge policy (D2): the toolbar page is trusted shell UI and
  // gets exactly the channel surface; the content webview gets NO policy, so
  // it is bridgeless regardless of what it loads.
  await shell.createWebview({
    id: "toolbar",
    url: options.toolbarUrl,
    bridge: { webviewId: true, messageChannels: true },
  });
  const content = await shell.createWebview({ id: "content", url: options.contentUrl });
  // Declarative layered layout (D8 sugar): toolbar pinned at a fixed 44px
  // height, content filling the remainder; resize is recomputed natively.
  await shell.setLayout(column([fixed("toolbar", 44), grow("content")]));
  const channel = await shell.createMessageChannel({ target: "toolbar" });
  const note = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    void options.log("toolbar carrier: " + message);
  };
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
  // command (never evaluate(location.reload()) on a wrapper).
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
  // Seed the address bar with the current truth (pre-subscription buffering
  // on both endpoints covers the race before the toolbar page registers).
  void content.getUrl().then((state) => pushUrl(state.url)).catch(note);
  return { content, channel };
};
`;
