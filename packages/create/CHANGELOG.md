# create-opentray

## 0.21.0

### Minor Changes

- acfe005: # create-opentray: command families for the wizard (add-create-command-family)

  ## Command family authoring in one input row

  - The wizard command field is now a single-row input group: a family selector prefix (official ecosystem brand marks as vendored monochrome SVG; pencil glyph for custom) plus the command body. Custom keeps the free-form input; every other family (npm: npx/pnpx/bunx/yarn dlx/nubx/deno run/vpx, go run, rust cargo install, python uvx/pipx run, .NET dnx) renders a read-only command surface that opens a structured form dialog (runner, package/module/crate/tool id, version, arguments; rust adds the run binary and an install reference line). Confirm writes the command string back; cancel discards the whole dialog session (button/X/overlay/ESC alike), and drafts survive in-dialog family switching without polluting server state.
  - Dialog session model: opening freezes a cancel snapshot; unconfirmed edits stay session-local; server family projections (reload/reconnect/draft restart) always refresh the committed cache and merge into an unedited open session (plan D11a).
  - No built-in preset command chips ship in production (prototypes were test-only).

  ## Family-aware default appId

  - Recognized families derive a runner-normalized identity (pre-option subcommand segments + normalized package name; rust identity is the run binary; python `.`/`_` normalize to `-`; `@scope`/`@version`/`npm:` prefixes and path tails are stripped) joined with a fixed ecosystem tail: `npx @deepseek-ai/dsh@latest web` → `web.dsh.npmjs`, `go run rsc.io/fortune@latest` → `fortune.golang`, rust ripgrep/rg → `rg.rust`. The same package yields the same appId across runners of one family; custom commands keep the existing derivation unchanged.

  ## npm env preset as an explicit projection of the user env list

  - `npm_config_yes=true` (skip the npx/pnpx first-run install confirmation) is no longer injected implicitly: the user env entry list is the single source of truth. The dialog preset control is a live two-way projection — enabling writes the entry, removing deletes it, manual edits outside sync back instantly (last duplicate wins, matching the spawn/export overlay). The command-row indicator icon lights exactly when the entry exists.
  - `cargo install …` is never executed by the wizard: commands whose resolved executable (realpath-normalized, case-insensitive, `.exe`-stripped) is cargo and whose argv contains a standalone `install` token are refused with guidance toward the rust form — a deliberately conservative rule that over-refuses rare non-install invocations instead of parsing cargo's option grammar.
  - Argument fidelity: parsed args are re-serialized with POSIX symmetric quoting (whitespace/metachar tokens quoted) so tokenize(build(parse(cmd))) is token-for-token identical; the webui mirror tokenizer now uses the same `shell-quote` version as core, and value-bearing runner flags (e.g. `deno run --config <path>`) fall back verbatim to custom instead of reinterpreting a flag value as the package name.

### Patch Changes

- @opentray/spec@0.21.0
- @opentray/packaging@0.21.0
- @opentray/vite-plugin@0.21.0
- @create-opentray/core@0.1.2
- @create-opentray/cli@0.1.2

## 0.20.0

### Minor Changes

- 306090b: # create-opentray: generation lifecycle, share, and workbench applications overhaul

  ## Generation no longer re-runs the command (create-no-first-launch-force-terminal)

  - Root-cause fix for the hanging 正在生成应用… / `generated app entry exited early with 1`: the generated entry's blocking 30s service-port gate ran the command in a non-TTY pipe environment unlike the wizard preview, and preview/entry kills left orphaned servers holding ports that poisoned every retry.
  - `materialize` completes at dependency install — no first-launch validation, no ready marker, no bundle wait. The pipeline badge surface is scaffold/icon/install.
  - Generated entry: the command always runs through a PTY (preview parity); service discovery is an unbounded adaptive monitor (≈1s active, ≤5s quiet/loaded, one window per HTTP-verified port, dynamic ports included); an abnormal command exit (non-zero/signal, or exit before any verified service) force-reveals the terminal window with full output replay; teardown sweeps the whole process tree; startup failures persist their stack to app.log.
  - Shell host + `@lydell/node-pty` scaffold unconditionally; wizard-side PTY preview kill sweeps descendants; open-app cold-starts the entry on Darwin when no bundle exists yet, and the pin hint defers Dock pinning to after the first open.

  ## Share and workbench applications (wizard-share-and-list-scan)

  - Applications discovery scans the create root for BOTH layouts: v1 registrations and wizard scaffold projects (read-only projection with lockfile-inferred package manager).
  - List rows: app icon, accordion details (command vector, cwd, env KEY names only, pm, window, dev mode, project dir), edit jump, open (bundle wake or cold start), share, and uninstall for both layouts.
  - Uninstall (user requirement #11): scaffold-marker ownership gate, running-entry detection by exact absolute main.mjs argv match, typed running refusal with pids, an explicit force-stop confirmation dialog, whole-tree teardown, then project + OpenTray-home bundle removal. The list refreshes after app creation (route activation + success event).
  - Share artifacts from the export kernel: `npx create-opentray` command line and self-contained sh/ps1 scripts, copyable and downloadable, with highlighted full-content preview. Scraped web icons default to sharing their http URL plus generation flags (background/scale/template); the inline-bytes toggle shows whenever an icon is present (URL or local) and switches between embedding and reference sharing.
  - On-demand command quoting (bare-safe words stay unquoted) — also fixes embedded-icon temp-var tokens being single-quoted into literal strings, and the CLI `app export --format command` raw space join.

  ## Fixes

  - appId derivation for scoped commands: `npx @deepseek-ai/dsh@latest web` derives `web.dsh.npx` (`@scope` segments dropped, `name@version` keeps the name).
  - CLI create dependency range resolves the create-opentray release line (previously installed ancient SDKs from the private CLI package's own version).
  - confirm dialog close (X/Esc/overlay) equals 返回修改 (thaws the frozen form); stable share builds (no request flicker); detail cache invalidates on list refresh.

### Patch Changes

- @opentray/spec@0.20.0
- @opentray/packaging@0.20.0
- @opentray/vite-plugin@0.20.0
- @create-opentray/core@0.1.1
- @create-opentray/cli@0.1.1

## 0.19.1

### Patch Changes

- Fix `npx create-opentray` exiting silently with no output. The bin's
  isMainModule() check compared argv[1] against the module path with
  resolve() only — npx/npm invoke the bin through a node_modules/.bin
  SYMLINK, so argv[1] kept the link path, never matched the real file, and
  main() silently never ran (exit 0, zero output). Path comparisons now
  resolve through realpathSync with a resolve() fallback, so the wizard
  starts identically via direct node, .bin shims, npx, and npm create.
  - @opentray/spec@0.19.1
  - @opentray/packaging@0.19.1
  - @opentray/vite-plugin@0.19.1

## 0.19.0

### Patch-type additions (folded pre-release)

- Icon-pipeline hardening from the cross-review: analysis decodes ONCE
  (both luminance and coverage shared a full-resolution buffer pair — huge
  uploads doubled ~576 MB each), EXIF-oriented JPEGs compose upright
  (.rotate() added to analysis and composition), large-viewBox SVGs no
  longer fail the whole chain (sharp derives raster size from viewBox
  before any resize can cap it — the input-pixel limit is lifted and the
  raster bounded inside the pipeline; verified with a 20000×20000 viewBox
  end-to-end), an analysis decode failure now consistently suggests the
  white background (never transparent, which silently swapped the art for
  the glyph), materialize's composed-source encoder failures degrade to
  the glyph like raw-source failures instead of failing the creation, and
  the tray solid-provenance flag stays in sync across the default-coupling
  branch and typed-path updates.

- Generated-app runtime hardening from the cross-review: the lsof scan
  passes -nP (named-service ports like 5000 previously printed as service
  names, parsed to NaN, and were silently dropped — verified live), the
  per-port window monitor runs in BOTH modes with HTTP verification before
  any port is addressed (plain mode previously opened one window for a
  nondeterministic first port), plain mode routes through the same
  ensureServiceWindow machinery (duplicate window object removed), the
  appLaunch vector resolves node's absolute path under a Bun-hosted wizard
  (bare "node" failed launchd's minimal PATH), --skip-install no longer
  first-launches (no node_modules made the whole creation fail on the ready
  gate), and the dead waitForPort/taskkill/plainWindow code is gone.

- WebUI follow-ups from the cross-review: recompose failures clear the stale
  luminance readout, the frozen-values dialog snapshot prefers the server's
  resolved form (App ID/name no longer render empty), 确定创建应用 disables
  while frozen (a stale confirm could 409 silently), background buttons
  expose aria-pressed, the composition error is role=alert, and the preview
  container carries role=img.

- Follow-up hardening from the cross-review: concurrent /api/command posts
  are rejected while a submission is in flight (the await gap previously
  double-spawned and orphaned the first run), and /api/icon-analyze +
  /api/icon-compose require paths under the wizard's own icon source roots
  (arbitrary filesystem paths get 403 instead of a token-gated file probe).

### Minor Changes

- 0d84e3d: Add the `create-opentray` npm initializer. `npx create-opentray` opens a local
  React + shadcn/ui wizard that runs a start command once in a real interactive
  terminal (ghostty-web renderer over a prebuilt `@lydell/node-pty` PTY, chunks
  transported verbatim with zero server-side interpretation, read-only pipe
  fallback), presents the terminal and confirmed HTTP services in one
  Chrome-style tabs panel (tab strip above the context nav bar; editable URL
  with back/forward on iframe tabs; terminal status bar with cursor, selection,
  and clickable service jumps; service tabs kept alive across switches and
  auto-focused when sniffed), shows auto-derived identity defaults as input
  placeholders plus a square icon picker with clarity-ranked, deduplicated
  scraped favicon candidates (SVG, apple-touch-icon, sized sets, ICO frames),
  and materializes a
  self-contained OpenTray-hosted app project (tray + appMode WebView window +
  generated platform icon catalog + absolute shell-free launch vector) with a
  pending-log pipeline and a success dialog that can open the app and hints at
  taskbar/Dock pinning.

  Round 9: the wizard gains an advanced panel — a tray-icon picker (defaults to
  the app icon choice, additionally offers alpha-derived solid black/white
  silhouettes deduplicated by perceptual hash) and two generated-app window
  options, both off by default: `showStartupTerminal` opens a DEDICATED terminal
  window streaming the command's PTY (command bar, ghostty canvas, status bar
  with live listened ports), and `showAddressBar` wraps each service window in
  an address-bar page managed through the Web Navigation API (same-origin
  pseudo-routes drive the iframe; history fallback where the API is absent).
  Every listened HTTP port opens its own dedicated window; a port that stops
  listening marks its window title `(detached)` and recovers when it returns.
  Generated entries always launch with Node (a native PTY requires it even when
  the wizard itself runs under Bun), and generated apps ship the prebuilt shell
  UI plus `@lydell/node-pty` only when the terminal window is enabled.

  Round 11: generated projects default to `~/.opentray/create/<name>/`
  (stable per app, never pollutes the invocation directory; CLI positional
  overrides), the advanced panel shows the resolved location and warns when
  it is already occupied, and a 强制覆盖 toggle (plus `--force`) now CLEARS
  the existing tree before regenerating instead of layering over stale
  files. The list pane reorganizes into two cards (command + 命令选项;
  应用配置 with a merged 高级选项), the page animates list→detail through
  grid-template interpolation, scrollbars are thin with transparent tracks
  and stable gutters, the tabs panel fills the pane with its status bar at
  panel level, and icon previews sit on transparency checkerboards.

  Round 12: icon composition. The wizard analyzes the chosen foreground
  (alpha-weighted luminance + opaque coverage) and composites it over one of
  three backgrounds — light art → black, dark art → white, fully-opaque art →
  transparent — with live preview, an auto/manual toggle, and a 50–95%
  foreground scale control. The bundled squircle-masked backgrounds round the
  composite's corners; macOS ICNS encodes from the best-practice 824-in-1024
  variant while Windows/Linux keep the full 1024. The tray icon stays on the
  raw source (never the composed image).

  Icon-composition repair: luminance analysis now reads the source at full
  size (a fit-contain downscale letterboxed non-square art with sharp's
  default opaque-black padding, measuring white logos as dark and suggesting
  the white background for white art), the foreground's original pixels are
  preserved on every background (the silhouette-tint pass painted white icons
  black), and every composition — including the transparent background — is
  clipped to the bundled squircle alpha via a dest-in mask so macOS gets
  rounded corners.

  Composition controls are debounced: the scale slider (250ms) and background
  toggles (120ms) fire the form patch + recompose pipeline once on commit with
  the latest parameters, instead of per input event — a full slider sweep
  previously issued a /api/form and a real 1024² sharp render per step.

  确认应用信息 now shows both icons objectively: the app icon renders the
  COMPOSED result (the actual final form) and the tray icon the raw source,
  each on a transparency checkerboard with its descriptive label. Tray
  resolution falls back to the authoritative server trayIconPath when the
  port-scoped selection ref goes stale across runs, and re-confirming after
  返回修改 reopens the dialog (the frozen event only fired on first freeze,
  leaving the wizard with no visible confirm UI).

  macOS icon margin repair: the 824-in-1024 best practice now scales the
  WHOLE composed tile (background included) to 824 centered on a transparent
  canvas — previously only the foreground art shrank while the tile ran
  edge-to-edge, so the Dock icon still filled all available space. The
  shipped ICNS ic10 representation now measures tile width 824 at offset
  100 (ICO stays full-bleed), guarded by a whole-tile bbox regression test.

  Slider responsiveness repair: the debounce refactor had moved the local
  state update into the debounced callback, leaving the controlled range
  input pinned to its old value — the slider would not move under the
  pointer even though requests fired. Local state (slider position, label,
  background selection) now updates instantly; only the server pipeline
  (form patch + 1024² recompose) waits for the debounce settle.

  生成结果 dialog dismissal repair: the dialog was fully controlled
  (open={dialogOpen}) without onOpenChange, so every Radix dismissal signal
  (X, Esc, overlay click) was silently swallowed and the success phase had
  no close action at all — only 打开应用. onOpenChange is now wired and the
  success phase gains a 完成 button; all four dismissal paths verified.

### Patch Changes

- @opentray/spec@0.19.0
- @opentray/packaging@0.19.0
- @opentray/vite-plugin@0.19.0
