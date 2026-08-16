// Orthogonal intents (maintained 2026-07-22; original user request: the WebUI
// wizard collects OpenTray's required parameters while scraping only assists):
// 1. Own the wizard state machine: idle → running → discovered → frozen →
//    materializing → success/failed.
// 2. Keep scrapes from overwriting user-edited fields, and freeze the form at
//    confirmation so no later poll can mutate it.
// 3. Coordinate preview run, discovery polling, scrape polling, and teardown.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { scrapeService } from "./scrape";
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
  readonly servicePort: string;
  readonly targetDir: string;
  readonly pm: "npm" | "pnpm" | "bun";
}

/** Placeholder suggestions shown in the form; empty fields resolve to these. */
export interface WizardFormDefaults {
  readonly appId: string;
  readonly appName: string;
  readonly targetDir: string;
}

export type WizardEvent =
  | { readonly type: "state"; readonly state: WizardState; readonly reason?: string }
  | { readonly type: "log"; readonly stream: "stdout" | "stderr"; readonly chunk: string }
  | { readonly type: "term-mode"; readonly interactive: boolean; readonly message?: string }
  | { readonly type: "run-status"; readonly running: boolean; readonly code?: number | null }
  | { readonly type: "command-display"; readonly command: string }
  | {
      readonly type: "services";
      readonly services: readonly DiscoveredService[];
      readonly selectedPort: number | undefined;
    }
  | { readonly type: "scrape"; readonly port: number; readonly title?: string; readonly hasIcon: boolean }
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
  readonly form: WizardFormValues;
  readonly result: MaterializeResult | undefined;
  submitCommand(command: string): Promise<void>;
  /** Derive placeholder defaults from command text without spawning anything. */
  prime(command: string): void;
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
  servicePort: boolean;
  targetDir: boolean;
  pm: boolean;
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
  let currentTokens: readonly string[] = [];
  let currentCommand = "";
  let scrapedTitle: string | undefined;
  let resolvedVector: LaunchVector | undefined;
  let frozenForm: WizardFormValues | undefined;
  let resolvedServicePort: number | undefined;
  let runAlive = false;
  const touched: FieldTouched = { appId: false, appName: false, iconPath: false, servicePort: false, targetDir: false, pm: false };
  let form: WizardFormValues = {
    appId: "",
    appName: "",
    iconPath: "",
    servicePort: "",
    targetDir: "",
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
      targetDir: join(options.cwd, toProjectDirectoryName(effectiveAppId)),
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
      if (!touched.servicePort && form.servicePort !== String(port)) {
        form = { ...form, servicePort: String(port) };
      }
      if (scraped.iconPath !== undefined) {
        currentIconPath = scraped.iconPath;
      }
      if (scraped.title !== undefined) {
        scrapedTitle = scraped.title;
      }
      emit({
        type: "scrape",
        port,
        ...(scraped.title === undefined ? {} : { title: scraped.title }),
        hasIcon: scraped.iconPath !== undefined,
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
      const tokenized = tokenizeCommandLine(command);
      if (!tokenized.ok) {
        setState("failed", tokenized.error);
        return;
      }
      await session.stop();
      runAlive = false;
      stopped = false;
      services = [];
      selectedPort = undefined;
      currentTokens = tokenized.tokens;
      currentIconPath = undefined;
      touched.appId = false;
      touched.appName = false;
      touched.targetDir = false;
      touched.pm = false;
      form = {
        appId: "",
        appName: "",
        iconPath: "",
        ...(touched.servicePort ? { servicePort: form.servicePort } : { servicePort: "" }),
        targetDir: "",
        pm:
          options.packageManager ??
          detectPackageManager([], process.env.npm_config_user_agent),
      };
      currentCommand = command;
      scrapedTitle = undefined;
      emit({ type: "command-display", command });
      tempIconDir = await mkdtemp(join(tmpdir(), "create-opentray-"));

      const listListeners =
        options.listListeners ?? (() => listListeningPorts(process.platform));
      const baseline = await listListeners().catch(() => new Set<number>());

      // Emit the running state before spawning so the terminal panel appears
      // the instant Run fires, ahead of any process output or probe.
      setState("running");
      publishForm();

      const spawnRun = options.spawnRun ?? startCommandRun;
      run = await spawnRun({
        tokens: tokenized.tokens,
        cwd: options.cwd,
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
      const tokenized = tokenizeCommandLine(command);
      if (!tokenized.ok) {
        return; // keep previous placeholders for empty/invalid drafts
      }
      currentTokens = tokenized.tokens;
      currentCommand = command;
      emit({ type: "command-display", command });
      publishForm();
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
      // The service port comes from discovery or the manual form input; without
      // either, materialization cannot address the app window.
      const manualPort = Number.parseInt(form.servicePort.trim(), 10);
      const port =
        Number.isInteger(manualPort) && manualPort > 0 && manualPort < 65_536
          ? manualPort
          : selectedPort;
      if (port === undefined) {
        throw new Error("缺少服务端口：请运行命令嗅探端口，或在表单中手动填写端口");
      }
      resolvedServicePort = port;
      // Empty fields resolve to their placeholder defaults.
      const defaults = currentDefaults();
      const resolvedForm: WizardFormValues = {
        ...form,
        appId: form.appId.trim().length > 0 ? form.appId : defaults.appId,
        appName: form.appName.trim().length > 0 ? form.appName : defaults.appName,
        targetDir:
          form.targetDir.trim().length > 0 ? form.targetDir : defaults.targetDir,
      };
      // A user-entered icon path wins over the scraped favicon.
      if (resolvedForm.iconPath.trim().length > 0) {
        currentIconPath = resolvedForm.iconPath.trim();
      }
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
      if (resolvedServicePort === undefined) {
        throw new Error("no service port resolved");
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
          cwd: options.cwd,
        });
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
              service: { port: resolvedServicePort },
              window: { width: 1_200, height: 800 },
            },
            targetDir: frozen.targetDir,
            dependencyRange: options.dependencyRange,
            iconSourcePath: currentIconPath,
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
  touched: { appId: false, appName: false, iconPath: false, servicePort: false, targetDir: false, pm: false },
});
