// Orthogonal intents (maintained 2026-07-22; original user request: the WebUI
// wizard collects OpenTray's required parameters while scraping only assists):
// 1. Own the wizard state machine: idle → running → discovered → frozen →
//    materializing → success/failed.
// 2. Keep scrapes from overwriting user-edited fields, and freeze the form at
//    confirmation so no later poll can mutate it.
// 3. Coordinate preview run, discovery polling, scrape polling, and teardown.

import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
import { scrapeService, type ScrapedIcon } from "./scrape";
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
  /** Empty = follow the app icon choice (default). */
  readonly trayIconPath: string;
  readonly pm: "npm" | "pnpm" | "bun";
  /** Advanced: render the command PTY in the generated app (default false). */
  readonly showStartupTerminal: boolean;
  /** Advanced: address-bar service tabs in the generated app (default false). */
  readonly showAddressBar: boolean;
}

/** Placeholder suggestions shown in the form; empty fields resolve to these. */
export interface WizardFormDefaults {
  readonly appId: string;
  readonly appName: string;
}

export type WizardEvent =
  | { readonly type: "state"; readonly state: WizardState; readonly reason?: string }
  | { readonly type: "log"; readonly stream: "stdout" | "stderr"; readonly chunk: string }
  | { readonly type: "term-mode"; readonly interactive: boolean; readonly message?: string }
  | { readonly type: "run-status"; readonly running: boolean; readonly code?: number | null }
  | { readonly type: "command-display"; readonly command: string }
  | { readonly type: "command-options"; readonly options: WizardCommandOptions }
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
  readonly skipInstall: boolean;
  readonly force: boolean;
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
  appId: boolean;
  appName: boolean;
  iconPath: boolean;
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
  let iconCandidates: readonly ScrapedIcon[] = [];
  let iconPort: number | undefined;
  let currentTokens: readonly string[] = [];
  let currentCommand = "";
  let scrapedTitle: string | undefined;
  let resolvedVector: LaunchVector | undefined;
  let frozenForm: WizardFormValues | undefined;
  let resolvedServicePort: number | undefined;
  let runAlive = false;
  let commandOptions: WizardCommandOptions = { ...DEFAULT_COMMAND_OPTIONS };
  const touched: FieldTouched = { appId: false, appName: false, iconPath: false, trayIconPath: false, pm: false, showStartupTerminal: false, showAddressBar: false };
  let form: WizardFormValues = {
    appId: "",
    appName: "",
    iconPath: "",
    trayIconPath: "",
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
    };
  };

  const publishForm = (): void => {
    emit({ type: "form", values: form, defaults: currentDefaults() });
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

  /** Resolve the command cwd: empty = the wizard's working directory. */
  const effectiveCwd = (): string => {
    const custom = commandOptions.cwd.trim();
    return custom.length > 0 ? resolve(options.cwd, custom) : options.cwd;
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
    emit({ type: "command-options", options: commandOptions });
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
      // Array mode: the caller supplied argv elements directly — they are
      // used verbatim and NEVER re-split. String mode: tokenize one line.
      const tokens = typeof command === "string" ? undefined : command;
      let tokenized: ReturnType<typeof tokenizeCommandLine> | undefined;
      if (tokens === undefined) {
        tokenized = tokenizeCommandLine(command as string);
        if (!tokenized.ok) {
          setState("failed", tokenized.error);
          return;
        }
      } else if (tokens.length === 0 || tokens[0]!.trim().length === 0) {
        setState("failed", "数组模式至少需要程序元素（第一个参数）");
        return;
      }
      await session.stop();
      runAlive = false;
      stopped = false;
      services = [];
      selectedPort = undefined;
      currentTokens = tokens ?? tokenized!.tokens;
      currentIconPath = undefined;
      currentTrayIconPath = undefined;
      iconCandidates = [];
      touched.appId = false;
      touched.appName = false;
      touched.pm = false;
      form = {
        appId: "",
        appName: "",
        iconPath: "",
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
        return;
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
            targetDir: join(options.cwd, toProjectDirectoryName(frozen.appId)),
            dependencyRange: options.dependencyRange,
            iconSourcePath: currentIconPath,
            ...(currentTrayIconPath === undefined
              ? {}
              : { trayIconSourcePath: currentTrayIconPath }),
            shell: {
              showTerminal: frozen.showStartupTerminal,
              showAddressBar: frozen.showAddressBar,
            },
            packageManager: frozen.pm,
            skipInstall: options.skipInstall,
            force: options.force,
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
        setState("failed", error instanceof Error ? error.message : String(error));
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

  return session;
};

/** Exposed for tests: the touched-field bookkeeping semantics. */
export const createFieldTouchedTracker = (): { touched: FieldTouched } => ({
  touched: { appId: false, appName: false, iconPath: false, trayIconPath: false, pm: false, showStartupTerminal: false, showAddressBar: false },
});
