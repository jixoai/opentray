// Orthogonal intents (maintained 2026-07-22; original user request: the WebUI
// wizard collects OpenTray's required parameters while scraping only assists):
// 1. Own the wizard state machine: idle → running → discovered → frozen →
//    materializing → success/failed.
// 2. Keep scrapes from overwriting user-edited fields, and freeze the form at
//    confirmation so no later poll can mutate it.
// 3. Coordinate preview run, discovery polling, scrape polling, and teardown.

import { createHash } from "node:crypto";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { deriveDefaultAppId, deriveDefaultAppName, toProjectDirectoryName } from "./app-id";
import {
  startCommandRun,
  type CommandRun,
  type CommandRunEvent,
} from "./command-run";
import {
  collectProcessTreePids,
  createPortDiscovery,
  listListeningPorts,
  type DiscoveredService,
} from "./port-scan";
import {
  autoBackground,
  compositionCacheKey,
  composeAppIcon,
  foregroundCoverage,
  foregroundLuminance,
} from "./icon-compose";
import { scrapeService, writeGlyphIconTemp, type ScrapedIcon } from "./scrape";
import { tokenizeCommandLine } from "./tokenize";
import {
  detectPackageManager,
  materialize,
  type MaterializeContext,
  type MaterializeResult,
} from "./materialize";
import type { LaunchVector } from "./launch-vector";
import { resolveLaunchVector } from "./launch-vector";
import { pinningHint } from "./open-app";

export interface WizardEnvEntry {
  readonly key: string;
  readonly value: string;
}

/** App-icon composition (owner round-12): foreground over black/white/
 *  transparent background; the wizard derives the auto suggestion. */
export type WizardIconBackground = "black" | "white" | "transparent";

export const DEFAULT_ICON_SCALE = 0.8;

export interface WizardIconComposition {
  readonly key: string;
  readonly compositePath: string;
  readonly macOSPath: string;
  readonly background: WizardIconBackground;
}

export interface WizardIconAnalysis {
  readonly luminance: number | undefined;
  readonly coverage: number;
  readonly suggested: WizardIconBackground;
}

/** Command execution options (advanced): working directory, custom env, and
 *  the input mode — array mode takes argv elements verbatim (no string
 *  splitting), string mode tokenizes one command line. */
export interface WizardCommandOptions {
  /** Empty = the wizard's working directory. */
  readonly cwd: string;
  readonly env: readonly WizardEnvEntry[];
  readonly argsMode: "string" | "array";
}

export const DEFAULT_COMMAND_OPTIONS: WizardCommandOptions = {
  cwd: "",
  env: [],
  argsMode: "string",
};

export type WizardState =
  | "idle"
  | "running"
  | "discovered"
  | "failed"
  | "frozen"
  | "materializing"
  | "success";

export interface WizardFormValues {
  readonly appId: string;
  readonly appName: string;
  readonly iconPath: string;
  /** Icon composition (owner round-12). */
  readonly iconBackground: WizardIconBackground;
  readonly iconScale: number;
  /** Empty = follow the app icon choice (default). */
  readonly trayIconPath: string;
  readonly pm: "npm" | "pnpm" | "bun";
  /** Wipe an existing non-empty target directory before materializing. */
  readonly force: boolean;
  /** Advanced: render the command PTY in the generated app (default false). */
  readonly showStartupTerminal: boolean;
  /** Advanced: address-bar service tabs in the generated app (default false). */
  readonly showAddressBar: boolean;
}

/** Placeholder suggestions shown in the form; empty fields resolve to these. */
export interface WizardFormDefaults {
  readonly appId: string;
  readonly appName: string;
  /** Resolved project directory the app will be generated into. */
  readonly targetDir: string;
  /**
   * Effective default icon source (the clearest scraped candidate). The form
   * value stays empty until the user picks/upload; composition must follow
   * this default too, or the preview would never appear without a click.
   */
  readonly iconPath: string;
}

export type WizardEvent =
  | { readonly type: "state"; readonly state: WizardState; readonly reason?: string }
  | { readonly type: "log"; readonly stream: "stdout" | "stderr"; readonly chunk: string }
  | { readonly type: "term-mode"; readonly interactive: boolean; readonly message?: string }
  | { readonly type: "run-status"; readonly running: boolean; readonly code?: number | null }
  | { readonly type: "command-display"; readonly command: string }
  | {
      readonly type: "command-options";
      readonly options: WizardCommandOptions;
      readonly defaultCwd: string;
    }
  | {
      readonly type: "services";
      readonly services: readonly DiscoveredService[];
      readonly selectedPort: number | undefined;
    }
  | { readonly type: "scrape"; readonly port: number; readonly title?: string; readonly hasIcon: boolean }
  | { readonly type: "icons"; readonly port: number; readonly icons: readonly ScrapedIcon[] }
  | {
      readonly type: "form";
      readonly values: WizardFormValues;
      readonly defaults: WizardFormDefaults;
      readonly targetDirExists: boolean;
    }
  | { readonly type: "materialize-log"; readonly message: string }
  | { readonly type: "materialize-step"; readonly step: string; readonly message: string }
  | {
      readonly type: "success";
      readonly projectDir: string;
      readonly bundlePath?: string;
      readonly pinHint: string;
    };

export interface WizardOptions {
  readonly cwd: string;
  /**
   * USER_HOME anchor: the command-execution default cwd AND the root of the
   * default generated-project location (~/.opentray/create/<name>).
   */
  readonly homeDir?: string;
  /** Explicit project directory (CLI positional); default: the create root. */
  readonly targetDir?: string | undefined;
  readonly skipInstall: boolean;
  /** Seed the 强制覆盖 toggle (CLI --force); the form owns the live value. */
  readonly force?: boolean | undefined;
  readonly packageManager?: "npm" | "pnpm" | "bun";
  readonly dependencyRange: string;
  readonly emit: (event: WizardEvent) => void;
  readonly spawnRun?: typeof startCommandRun;
  readonly listListeners?: () => Promise<ReadonlySet<number>>;
  readonly verifyHttp?: (port: number) => Promise<boolean>;
  /** Test/embedding seam for listener ownership. */
  readonly listPortOwners?: () => Promise<import("./port-scan").ListenerOwners>;
  readonly scrape?: typeof scrapeService;
  readonly resolveVector?: typeof resolveLaunchVector;
  /** Test/embedding seam for the materialize pipeline. */
  readonly materializeContext?: Partial<MaterializeContext>;
  readonly platform?: NodeJS.Platform;
  readonly pollIntervalMs?: number;
  readonly scrapeIntervalMs?: number;
}

export interface WizardSession {
  readonly state: WizardState;
  readonly services: readonly DiscoveredService[];
  readonly selectedPort: number | undefined;
  /** True while the preview process is alive (Run button shows Interrupt). */
  readonly runAlive: boolean;
  /** Latest scraped icon candidates for the selected service, ranked by clarity. */
  readonly iconCandidates: readonly ScrapedIcon[];
  /** Persist an uploaded image into the session temp dir; returns its path. */
  saveIconUpload(bytes: Buffer): Promise<string>;
  /** Candidate lookup scoped to the port it was scraped from. */
  iconCandidate(port: number, index: number): ScrapedIcon | undefined;
  /** Select a scraped candidate as the icon source (marks the field touched). */
  selectIconCandidate(port: number, index: number): boolean;
  /** Select a candidate (original or solid variant) as the TRAY icon. */
  selectTrayIconCandidate(port: number, index: number): boolean;
  /** Test/extension seam: replace the scraped candidate set for a port. */
  replaceIconCandidates(port: number, icons: readonly ScrapedIcon[]): void;
  /** Compose the app icon preview/asset for the current foreground. */
  composeIcon(options: {
    foregroundPath: string;
    background?: WizardIconBackground;
    scale?: number;
  }): Promise<WizardIconComposition>;
  /** Register a composition for token-scoped byte serving (server seam). */
  trackIconComposition(composition: WizardIconComposition): void;
  /** Look up a registered composition by cache key. */
  iconComposition(key: string): WizardIconComposition | undefined;
  /** Wizard-owned icon source roots (containment for icon routes). */
  iconSourceRoots(): readonly string[];
  /** Auto-suggestion for the foreground (background + reason). */
  analyzeIconForeground(foregroundPath: string): Promise<WizardIconAnalysis>;
  readonly form: WizardFormValues;
  readonly result: MaterializeResult | undefined;
  /** String form is tokenized; array form is taken as argv verbatim (array
   *  input mode — no string splitting is ever applied to it). */
  submitCommand(command: string | readonly string[]): Promise<void>;
  /** Derive placeholder defaults from command text without spawning anything. */
  prime(command: string | readonly string[]): void;
  readonly commandOptions: WizardCommandOptions;
  updateCommandOptions(patch: Partial<WizardCommandOptions>): void;
  selectService(port: number): void;
  updateForm(patch: Partial<WizardFormValues>): void;
  terminalInput(data: string): void;
  terminalResize(size: { cols: number; rows: number }): void;
  confirm(): void;
  create(): Promise<void>;
  stop(): Promise<void>;
}

interface FieldTouched {
  force: boolean;
  appId: boolean;
  appName: boolean;
  iconPath: boolean;
  iconBackground: boolean;
  iconScale: boolean;
  trayIconPath: boolean;
  pm: boolean;
  showStartupTerminal: boolean;
  showAddressBar: boolean;
}

export const createWizardSession = (options: WizardOptions): WizardSession => {
  let state: WizardState = "idle";
  let services: DiscoveredService[] = [];
  let selectedPort: number | undefined;
  let run: CommandRun | undefined;
  let discovery = createPortDiscovery({
    baseline: new Set<number>(),
    ...(options.listListeners === undefined
      ? {}
      : { listListeners: () => options.listListeners!() }),
    ...(options.verifyHttp === undefined ? {} : { verifyHttp: options.verifyHttp }),
  });
  let discoveryTimer: ReturnType<typeof setInterval> | undefined;
  let scrapeTimer: ReturnType<typeof setInterval> | undefined;
  let scraping = false;
  let tempIconDir: string | undefined;
  let currentIconPath: string | undefined;
  let currentTrayIconPath: string | undefined;
  let trayIconIsSolid = false;
  let iconCandidates: readonly ScrapedIcon[] = [];
  let iconPort: number | undefined;
  let currentTokens: readonly string[] = [];
  let currentCommand = "";
  let scrapedTitle: string | undefined;
  let resolvedVector: LaunchVector | undefined;
  let frozenForm: WizardFormValues | undefined;
  let resolvedServicePort: number | undefined;
  let resolvedTargetDir: string | undefined;
  let frozenIconPath: string | undefined;
  let submitting = false;
  let runAlive = false;
  let commandOptions: WizardCommandOptions = { ...DEFAULT_COMMAND_OPTIONS };
  let composeIconDir: string | undefined;
  const iconCompositions = new Map<string, WizardIconComposition>();
  let iconBackground: WizardIconBackground | undefined;
  let iconScale: number | undefined;
  const touched: FieldTouched = { appId: false, appName: false, iconPath: false, iconBackground: false, iconScale: false, trayIconPath: false, pm: false, force: false, showStartupTerminal: false, showAddressBar: false };
  let form: WizardFormValues = {
    appId: "",
    appName: "",
    iconPath: "",
    iconBackground: "transparent",
    iconScale: DEFAULT_ICON_SCALE,
    trayIconPath: "",
    force: options.force === true,
    showStartupTerminal: false,
    showAddressBar: false,
    pm:
      options.packageManager ??
      detectPackageManager([], process.env.npm_config_user_agent),
  };
  let result: MaterializeResult | undefined;
  let stopped = false;

  const emit = options.emit;
  const setState = (next: WizardState, reason?: string): void => {
    state = next;
    emit({ type: "state", state: next, ...(reason === undefined ? {} : { reason }) });
  };

  const stopTimers = (): void => {
    if (discoveryTimer !== undefined) {
      clearInterval(discoveryTimer);
      discoveryTimer = undefined;
    }
    if (scrapeTimer !== undefined) {
      clearInterval(scrapeTimer);
      scrapeTimer = undefined;
    }
  };

  const publishServices = (): void => {
    emit({
      type: "services",
      services: [...services],
      selectedPort,
    });
  };

  /**
   * Placeholder defaults: scrapes and derivations update the *suggestions*,
   * never the user's values. Empty values mean "use the default".
   */
  const currentDefaults = (): WizardFormDefaults => {
    const effectiveAppId = form.appId.trim().length > 0 ? form.appId : deriveDefaultAppId(currentTokens);
    return {
      appId: deriveDefaultAppId(currentTokens),
      appName: scrapedTitle ?? deriveDefaultAppName(currentTokens),
      iconPath: currentIconPath ?? "",
      // Projects land under the OpenTray home by default (stable, idempotent
      // per app, never pollutes the invocation directory); the CLI positional
      // provides an explicit override.
      targetDir:
        options.targetDir ??
        join(homeDir, ".opentray", "create", toProjectDirectoryName(effectiveAppId)),
    };
  };

  const publishForm = (): void => {
    emit({ type: "form", values: form, defaults: currentDefaults(), targetDirExists });
  };

  /** Track whether the resolved target directory is already occupied so the
   *  UI can warn and offer the force toggle. */
  let targetDirExists = false;
  let targetDirProbe = 0;
  const refreshTargetDirExists = (): void => {
    const probe = ++targetDirProbe;
    const target = currentDefaults().targetDir;
    void (async () => {
      let occupied = false;
      try {
        const info = await stat(target);
        occupied = info.isDirectory();
      } catch {
        occupied = false;
      }
      if (probe !== targetDirProbe) return; // a newer probe owns the state
      if (occupied !== targetDirExists) {
        targetDirExists = occupied;
        publishForm();
      }
    })();
  };

  const scrapeOnce = async (): Promise<void> => {
    if (scraping || selectedPort === undefined || state === "frozen" || state === "materializing") {
      return;
    }
    scraping = true;
    try {
      const port = selectedPort;
      const scraped = await (options.scrape ?? scrapeService)(
        port,
        tempIconDir === undefined ? {} : { tempDir: tempIconDir },
      );
      if (selectedPort !== port) {
        return; // selection moved during scrape
      }
      const stateNow = state as WizardState;
      if (stateNow === "frozen" || stateNow === "materializing" || stateNow === "success") {
        return; // a confirm froze the form mid-scrape: never mutate identity
      }
      // Candidates always refresh (possibly to an empty list); the clearest
      // one remains the empty-field default.
      iconCandidates = scraped.icons;
      iconPort = port;
      currentIconPath = scraped.icons[0]?.path;
      if (scraped.title !== undefined) {
        scrapedTitle = scraped.title;
      }
      emit({ type: "icons", port, icons: scraped.icons });
      emit({
        type: "scrape",
        port,
        ...(scraped.title === undefined ? {} : { title: scraped.title }),
        hasIcon: scraped.icons.length > 0,
      });
      publishForm();
    } finally {
      scraping = false;
    }
  };

  const startScrapePolling = (): void => {
    if (scrapeTimer !== undefined) {
      clearInterval(scrapeTimer);
    }
    void scrapeOnce();
    scrapeTimer = setInterval(() => {
      void scrapeOnce();
    }, options.scrapeIntervalMs ?? 1_500);
  };

  const selectDefaultService = (): void => {
    if (selectedPort === undefined && services.length > 0) {
      selectedPort = services[0]?.port;
    }
    if (selectedPort !== undefined && state === "running") {
      setState("discovered");
      startScrapePolling();
    }
  };

  const startDiscoveryPolling = (): void => {
    if (discoveryTimer !== undefined) {
      clearInterval(discoveryTimer);
    }
    void (async () => {
      const found = await discovery.poll();
      if (found.length > 0) {
        const known = new Set(services.map((service) => service.port));
        services = [...services, ...found.filter((s) => !known.has(s.port))];
        selectDefaultService();
        publishServices();
      }
    })();
    discoveryTimer = setInterval(() => {
      void (async () => {
        const found = await discovery.poll();
        if (found.length > 0) {
          const known = new Set(services.map((service) => service.port));
          services = [...services, ...found.filter((s) => !known.has(s.port))];
          selectDefaultService();
          publishServices();
        }
      })();
    }, options.pollIntervalMs ?? 1_000);
  };

  /** Default command cwd is the USER_HOME directory (owner round-10 law):
   *  empty input means home, and relative paths resolve against home. */
  const homeDir = options.homeDir ?? homedir();
  const effectiveCwd = (): string => {
    const custom = commandOptions.cwd.trim();
    return custom.length > 0 ? resolve(homeDir, custom) : homeDir;
  };

  /** Build the env overlay from configured entries (empty keys skipped). */
  const commandEnv = (): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const entry of commandOptions.env) {
      if (entry.key.trim().length > 0) {
        env[entry.key.trim()] = entry.value;
      }
    }
    return env;
  };

  const publishCommandOptions = (): void => {
    emit({ type: "command-options", options: commandOptions, defaultCwd: homeDir });
  };

  /** Stable dir for composed preview assets, created on demand. */
  const ensureIconComposeDir = async (): Promise<string> => {
    if (composeIconDir === undefined) {
      composeIconDir = await mkdtemp(join(tmpdir(), "create-opentray-compose-"));
    }
    return composeIconDir;
  };

  const session: WizardSession = {
    get state() {
      return state;
    },
    get services() {
      return services;
    },
    get selectedPort() {
      return selectedPort;
    },
    get runAlive() {
      return runAlive;
    },
    get iconCandidates() {
      return iconCandidates;
    },
    iconCandidate(port, index) {
      if (iconPort !== port) {
        return undefined;
      }
      return iconCandidates.find((icon) => icon.index === index);
    },
    replaceIconCandidates(port, icons) {
      iconPort = port;
      iconCandidates = icons;
    },

    selectTrayIconCandidate(port, index) {
      if (state === "frozen" || state === "materializing" || state === "success") {
        return false;
      }
      const candidate = session.iconCandidate(port, index);
      if (candidate === undefined) {
        return false;
      }
      touched.trayIconPath = true;
      currentTrayIconPath = candidate.path;
      trayIconIsSolid = candidate.variant !== "original";
      form = { ...form, trayIconPath: candidate.path };
      publishForm();
      return true;
    },

    selectIconCandidate(port, index) {
      if (state === "frozen" || state === "materializing" || state === "success") {
        return false;
      }
      const candidate = session.iconCandidate(port, index);
      if (candidate === undefined) {
        return false;
      }
      touched.iconPath = true;
      currentIconPath = candidate.path;
      if (!touched.trayIconPath) {
        // Default coupling: the tray follows the app icon until overridden.
        currentTrayIconPath = candidate.path;
        form = { ...form, iconPath: candidate.path, trayIconPath: candidate.path };
      } else {
        form = { ...form, iconPath: candidate.path };
      }
      publishForm();
      return true;
    },
    get form() {
      return form;
    },
    get result() {
      return result;
    },

    async submitCommand(command) {
      if (state !== "idle" && state !== "failed" && state !== "running" && state !== "discovered") {
        throw new Error(`cannot submit a command while ${state}`);
      }
      // Concurrent posts double-spawn: the awaits below would overwrite the
      // first run reference, orphaning it (unkillable, holding the port).
      if (submitting) {
        throw new Error("a command submission is already in flight");
      }
      submitting = true;
      // Array mode: the caller supplied argv elements directly — they are
      // used verbatim and NEVER re-split. String mode: tokenize one line.
      const tokens = typeof command === "string" ? undefined : command;
      let tokenized: ReturnType<typeof tokenizeCommandLine> | undefined;
      if (tokens === undefined) {
        tokenized = tokenizeCommandLine(command as string);
        if (!tokenized.ok) {
          submitting = false;
          setState("failed", tokenized.error);
          return;
        }
      } else if (tokens.length === 0 || tokens[0]!.trim().length === 0) {
        submitting = false;
        setState("failed", "数组模式至少需要程序元素（第一个参数）");
        return;
      }
      await session.stop();
      runAlive = false;
      stopped = false;
      services = [];
      selectedPort = undefined;
      currentTokens = tokens ?? tokenized!.tokens;
      refreshTargetDirExists();
      currentIconPath = undefined
      currentTrayIconPath = undefined;
      trayIconIsSolid = false;
      iconCandidates = [];
      touched.appId = false;
      touched.appName = false;
      touched.pm = false;
      // Cross-run consistency: the client tray UI resets on every new run;
      // a stale server-side tray pick would silently win at materialize.
      touched.trayIconPath = false;
      form = {
        appId: "",
        appName: "",
        iconPath: "",
        iconBackground: iconBackground ?? "transparent",
        iconScale: iconScale ?? DEFAULT_ICON_SCALE,
        ...(touched.force ? { force: form.force } : { force: options.force === true }),
        ...(touched.trayIconPath ? { trayIconPath: form.trayIconPath } : { trayIconPath: "" }),
        ...(touched.showStartupTerminal ? { showStartupTerminal: form.showStartupTerminal } : { showStartupTerminal: false }),
        ...(touched.showAddressBar ? { showAddressBar: form.showAddressBar } : { showAddressBar: false }),
        pm:
          options.packageManager ??
          detectPackageManager([], process.env.npm_config_user_agent),
      };
      currentCommand = typeof command === "string" ? command : command.join(" ");
      scrapedTitle = undefined;
      emit({ type: "command-display", command: currentCommand });
      tempIconDir = await mkdtemp(join(tmpdir(), "create-opentray-"));

      const listListeners =
        options.listListeners ?? (() => listListeningPorts(process.platform));
      const baseline = await listListeners().catch(() => new Set<number>());

      // Emit the running state before spawning so the terminal panel appears
      // the instant Run fires, ahead of any process output or probe.
      setState("running");
      publishForm();

      const spawnRun = options.spawnRun ?? startCommandRun;
      const envOverlay = commandEnv();
      run = await spawnRun({
        tokens: currentTokens,
        cwd: effectiveCwd(),
        ...(Object.keys(envOverlay).length === 0 ? {} : { env: envOverlay }),
        onEvent: (event: CommandRunEvent) => {
          if (event.type === "stdout" || event.type === "stderr") {
            emit({
              type: "log",
              stream: event.type,
              chunk: event.chunk ?? "",
            });
            return;
          }
          if (event.type === "pty-ready") {
            emit({ type: "term-mode", interactive: true });
            return;
          }
          if (event.type === "pty-unavailable") {
            emit({
              type: "term-mode",
              interactive: false,
              ...(event.message === undefined ? {} : { message: event.message }),
            });
            return;
          }
          if (event.type === "spawn-error") {
            stopTimers();
            setState("failed", event.message ?? "spawn failed");
            return;
          }
          if (event.type === "exit") {
            // The process died (own exit, interrupt, or external kill): stop
            // polling and tell the UI the run control can go back to Run.
            runAlive = false;
            stopTimers();
            emit({
              type: "run-status",
              running: false,
              ...(event.code === undefined ? {} : { code: event.code }),
            });
            if (state === "running" && services.length === 0) {
              setState(
                "failed",
                `command exited with ${event.code ?? "signal"} before any service appeared`,
              );
            }
          }
        },
      });
      submitting = false;
      void run.exited.then(async ({ code, spawnError }) => {
        if (state === "running" && services.length === 0 && spawnError !== undefined) {
          stopTimers();
          setState("failed", spawnError);
        }
        void code;
      });

      // Discovery starts after spawn so port ownership can be resolved from
      // the live preview PID tree; foreign listeners are never adopted.
      discovery = createPortDiscovery({
        baseline,
        ...(options.listListeners === undefined
          ? {}
          : { listListeners: () => options.listListeners!() }),
        ...(options.verifyHttp === undefined ? {} : { verifyHttp: options.verifyHttp }),
        ...(options.listPortOwners === undefined
          ? {}
          : { listOwners: options.listPortOwners }),
        ...(run.pid === undefined
          ? {}
          : {
              resolveOwnerPids: () =>
                collectProcessTreePids(run?.pid ?? 0, options.platform ?? process.platform),
            }),
      });

      runAlive = true;
      emit({ type: "run-status", running: true });
      startDiscoveryPolling();
    },

    prime(command) {
      if (state === "frozen" || state === "materializing" || state === "success") {
        return;
      }
      if (typeof command !== "string") {
        // Array mode: argv verbatim; nothing is ever re-split.
        if (command.length === 0 || command[0]!.trim().length === 0) {
          return;
        }
        currentTokens = command;
        currentCommand = command.join(" ");
        emit({ type: "command-display", command: currentCommand });
        refreshTargetDirExists();
        publishForm();
        return;
      }
      const tokenized = tokenizeCommandLine(command);
      if (!tokenized.ok) {
        return; // keep previous placeholders for empty/invalid drafts
      }
      currentTokens = tokenized.tokens;
      currentCommand = command;
      emit({ type: "command-display", command });
      refreshTargetDirExists();
      publishForm();
    },

    get commandOptions() {
      return commandOptions;
    },

    updateCommandOptions(patch) {
      if (state === "frozen" || state === "materializing" || state === "success") {
        return;
      }
      commandOptions = { ...commandOptions, ...patch };
      publishCommandOptions();
    },

    async analyzeIconForeground(foregroundPath) {
      const [luminance, coverage] = await Promise.all([
        foregroundLuminance(foregroundPath).catch(() => undefined),
        foregroundCoverage(foregroundPath).catch(() => 1),
      ]);
      return {
        luminance,
        coverage,
        suggested: autoBackground({ luminance, coverage }),
      };
    },

    async composeIcon(options) {
      if (state === "frozen" || state === "materializing" || state === "success") {
        throw new Error("cannot compose while frozen");
      }
      const background = options.background ?? iconBackground ?? "transparent";
      const scale = options.scale ?? iconScale ?? DEFAULT_ICON_SCALE;
      const composed = await composeAppIcon({
        foregroundPath: options.foregroundPath,
        background,
        scale,
        outputDir: await ensureIconComposeDir(),
      });
      const composition: WizardIconComposition = {
        key: compositionCacheKey({
          foregroundPath: options.foregroundPath,
          background,
          scale,
        }),
        ...composed,
      };
      iconCompositions.set(composition.key, composition);
      return composition;
    },

    trackIconComposition(composition) {
      iconCompositions.set(composition.key, composition);
    },

    iconSourceRoots() {
      return [
        ...(tempIconDir !== undefined ? [tempIconDir] : []),
        ...(composeIconDir !== undefined ? [composeIconDir] : []),
      ];
    },

    iconComposition(key) {
      return iconCompositions.get(key);
    },

    async saveIconUpload(bytes) {
      const dir = tempIconDir ?? (tempIconDir = await mkdtemp(join(tmpdir(), "create-opentray-")));
      const name = `upload-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.bin`;
      const path = join(dir, name);
      await writeFile(path, bytes);
      return path;
    },

    selectService(port) {
      if (state !== "discovered" && state !== "running") {
        return;
      }
      if (!services.some((service) => service.port === port)) {
        return;
      }
      selectedPort = port;
      currentIconPath = undefined;
      publishServices();
      if (state === "discovered") {
        startScrapePolling();
      }
    },

    updateForm(patch) {
      if (state !== "idle" && state !== "running" && state !== "discovered" && state !== "failed") {
        return; // frozen/materializing: no form mutation, composition included
      }
      if (patch.iconBackground !== undefined) {
        iconBackground = patch.iconBackground;
      }
      if (patch.iconScale !== undefined) {
        iconScale = patch.iconScale;
      }
      for (const key of Object.keys(patch) as (keyof WizardFormValues)[]) {
        if (patch[key] !== undefined && patch[key] !== form[key]) {
          touched[key] = true;
        }
      }
      form = { ...form, ...patch };
      publishForm();
    },

    /** Forward base64-encoded terminal keystroke bytes to the preview command. */
    terminalInput(data) {
      if (state !== "running" && state !== "discovered") {
        return;
      }
      run?.write(data);
    },

    /** Forward terminal dimensions to the pseudo-terminal. */
    terminalResize(size) {
      if (state !== "running" && state !== "discovered") {
        return;
      }
      run?.resize(size);
    },

    confirm() {
      if (state !== "idle" && state !== "running" && state !== "discovered" && state !== "failed") {
        throw new Error(`cannot confirm while ${state}`);
      }
      // Ports come exclusively from runtime sniffing: the preview's discovered
      // port is recorded as an informational hint (0 when never sniffed); the
      // generated app resolves the real address by scanning its own command
      // tree. A manual port input must not exist.
      resolvedServicePort = selectedPort ?? 0;
      // Freeze the SAME default the UI displayed (explicit override wins).
      resolvedTargetDir = currentDefaults().targetDir;
      // Empty fields resolve to their placeholder defaults.
      const defaults = currentDefaults();
      let resolvedForm: WizardFormValues = {
        ...form,
        appId: form.appId.trim().length > 0 ? form.appId : defaults.appId,
        appName: form.appName.trim().length > 0 ? form.appName : defaults.appName,
      };
      // A user-entered icon path wins over the scraped favicon.
      if (resolvedForm.iconPath.trim().length > 0) {
        currentIconPath = resolvedForm.iconPath.trim();
      }
      // The icon source materialize uses is FROZEN at confirm: the user's
      // explicit value when set, else the scraped default captured here.
      // Never the live currentIconPath, which an in-flight scrape could
      // still swap (review round: post-freeze overwrite race).
      frozenIconPath = currentIconPath;

      // The tray icon defaults to the resolved app icon choice.
      const resolvedTrayIconPath =
        resolvedForm.trayIconPath.trim().length > 0
          ? resolvedForm.trayIconPath.trim()
          : resolvedForm.iconPath.trim().length > 0
            ? resolvedForm.iconPath.trim()
            : (currentIconPath ?? "");
      resolvedForm = { ...resolvedForm, trayIconPath: resolvedTrayIconPath };
      currentTrayIconPath = resolvedTrayIconPath;
      form = resolvedForm;
      stopTimers();
      frozenForm = { ...form };
      setState("frozen");
      publishForm();
    },

    async create() {
      if (state !== "frozen") {
        throw new Error(`cannot create while ${state}`);
      }
      const frozen = frozenForm ?? form;
      if (currentTokens.length === 0) {
        throw new Error("no command recorded");
      }
      setState("materializing");

      // Free the service port: the generated app will spawn the command itself.
      if (run !== undefined) {
        await run.kill();
        run = undefined;
      }

      try {
        resolvedVector = await (options.resolveVector ?? resolveLaunchVector)({
          tokens: currentTokens,
          cwd: effectiveCwd(),
        });
        // Persist the configured env overlay onto the frozen vector; the
        // generated app merges it over its own environment when spawning.
        const envOverlay = commandEnv();
        if (Object.keys(envOverlay).length > 0) {
          resolvedVector = { ...resolvedVector, env: envOverlay };
        }
      } catch (error) {
        setState("failed", error instanceof Error ? error.message : String(error));
        return;
      }

      try {
        result = await materialize(
          {
            config: {
              schemaVersion: 1,
              appId: frozen.appId,
              appName: frozen.appName,
              command: resolvedVector,
              service: { port: resolvedServicePort ?? 0 },
              window: { width: 1_200, height: 800 },
            },
            targetDir: resolvedTargetDir ?? currentDefaults().targetDir,
            dependencyRange: options.dependencyRange,
            iconSourcePath: frozenIconPath ?? currentIconPath,
            ...(frozen.iconBackground === undefined
              ? {}
              : { iconBackground: frozen.iconBackground }),
            ...(frozen.iconScale === undefined
              ? {}
              : { iconScale: frozen.iconScale }),
            ...(currentTrayIconPath === undefined
              ? {}
              : { trayIconSourcePath: currentTrayIconPath }),
            ...(trayIconIsSolid ? { trayIconIsSolid: true } : {}),
            shell: {
              showTerminal: frozen.showStartupTerminal,
              showAddressBar: frozen.showAddressBar,
            },
            packageManager: frozen.pm,
            skipInstall: options.skipInstall,
            force: frozen.force,
          },
          {
            log: (event) => {
              if (event.type === "step") {
                emit({ type: "materialize-step", step: event.step, message: event.message });
                return;
              }
              emit({ type: "materialize-log", message: event.message });
            },
            ...(options.platform === undefined ? {} : { platform: options.platform }),
            ...(options.materializeContext ?? {}),
          },
        );
        setState("success");
        emit({
          type: "success",
          projectDir: result.projectDir,
          ...(result.bundlePath === undefined ? {} : { bundlePath: result.bundlePath }),
          pinHint: pinningHint(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const occupied = message.includes("target directory is not empty");
        setState(
          "failed",
          occupied
            ? `${message}；可在「高级选项」中开启 强制覆盖 后重试`
            : message,
        );
      }
    },

    async stop() {
      stopped = true;
      stopTimers();
      discovery.stop();
      if (run !== undefined) {
        await run.kill();
        run = undefined;
      }
    },
  };

  publishCommandOptions();

  return session;
};

/** Exposed for tests: the touched-field bookkeeping semantics. */
export const createFieldTouchedTracker = (): { touched: FieldTouched } => ({
  touched: { force: false, appId: false, appName: false, iconPath: false, iconBackground: false, iconScale: false, trayIconPath: false, pm: false, showStartupTerminal: false, showAddressBar: false },
});
