import { describe, expect, it } from "vitest";

import { createWizardSession, type WizardEvent, type WizardOptions } from "./wizard";
import type { CommandRun, CommandRunOptions } from "./command-run";
import type { DiscoveredService } from "./port-scan";
import type { ScrapeResult } from "./scrape";
import type { MaterializeContext } from "./materialize";

const neverResolve = (): Promise<{ code: number | null }> =>
  new Promise<{ code: number | null }>(() => {});

interface Harness {
  events: WizardEvent[];
  session: ReturnType<typeof createWizardSession>;
  setListeners(listeners: ReadonlySet<number>): void;
  setVerified(ports: readonly number[]): void;
  setScrape(result: MutableScrapeState): void;
  emitRunExit(code: number | null): void;
}

interface MutableScrapeState {
  title?: string | undefined;
  iconPath?: string | undefined;
}

const createHarness = (overrides: Partial<WizardOptions> = {}): Harness => {
  const events: WizardEvent[] = [];
  let listeners = new Set<number>();
  let verified: readonly number[] = [];
  let scrapeState: MutableScrapeState = {};

  const fakeRun = (options: CommandRunOptions): CommandRun => {
    void options;
    return {
      pid: 4321,
      exited: neverResolve(),
      output: [],
      kill: async () => {},
    };
  };

  const session = createWizardSession({
    cwd: "/tmp/wizard-cwd",
    skipInstall: true,
    force: true,
    dependencyRange: "^0.0.0-test",
    emit: (event) => events.push(event),
    spawnRun: fakeRun,
    listListeners: async () => listeners,
    verifyHttp: async (port) => verified.includes(port),
    pollIntervalMs: 1,
    scrapeIntervalMs: 1,
    scrape: async (port): Promise<ScrapeResult> => ({
      ok: true,
      title: scrapeState.title,
      iconPath: scrapeState.iconPath,
      iconUrl: scrapeState.iconPath === undefined ? undefined : `http://127.0.0.1:${port}/x.png`,
    }),
    resolveVector: async ({ tokens, cwd }) => ({
      command: `/resolved/${tokens[0]}`,
      args: tokens.slice(1),
      cwd,
    }),
    ...overrides,
  });

  return {
    events,
    session,
    setListeners(next) {
      listeners = new Set(next);
      verified = [...next];
    },
    setVerified(next) {
      verified = next;
    },
    setScrape(next) {
      scrapeState = next;
    },
    emitRunExit() {},
  };
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not met before timeout");
};

const serviceEvent = (events: readonly WizardEvent[]) => {
  const serviceEvents = events.filter(
    (event): event is Extract<WizardEvent, { type: "services" }> => event.type === "services",
  );
  return serviceEvents.at(-1);
};

describe("wizard session", () => {
  it("walks idle → running → discovered and fills defaults from the scrape", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    expect(harness.session.state).toBe("running");

    harness.setScrape({ title: "Scraped Title" });
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");

    await waitFor(() => harness.session.form.appName === "Scraped Title");
    expect(harness.session.form.appId).toBe("start.somecommand.npx");
    expect(harness.session.selectedPort).toBe(19080);
    expect(harness.session.form.targetDir).toBe("/tmp/wizard-cwd/start-somecommand-npx");
  });

  it("never overwrites user-edited fields", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");

    harness.session.updateForm({ appName: "My Custom Name" });
    harness.setScrape({ title: "Later Title" });
    await waitFor(() =>
      harness.events.some((event) => event.type === "scrape" && event.title === "Later Title"),
    );
    expect(harness.session.form.appName).toBe("My Custom Name");
  });

  it("lists multiple services in first-seen order and selects the first", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx tool serve");

    harness.setListeners(new Set([19080]));
    await waitFor(() => serviceEvent(harness.events)?.services.length === 1);
    harness.setListeners(new Set([19080, 19081]));
    await waitFor(() => serviceEvent(harness.events)?.services.length === 2);

    const services: readonly DiscoveredService[] = serviceEvent(harness.events)!.services;
    expect(services.map((service) => service.port)).toEqual([19080, 19081]);
    expect(harness.session.selectedPort).toBe(19080);

    harness.session.selectService(19081);
    expect(harness.session.selectedPort).toBe(19081);
  });

  it("freezes the form at confirmation so later scrapes cannot mutate it", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    harness.setScrape({ title: "Frozen Title" });
    harness.setListeners(new Set([19080]));
    await waitFor(() => harness.session.state === "discovered");
    await waitFor(() => harness.session.form.appName === "Frozen Title");

    harness.session.confirm();
    expect(harness.session.state).toBe("frozen");
    const frozenName = harness.session.form.appName;

    harness.setScrape({ title: "Post-freeze Title" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(harness.session.form.appName).toBe(frozenName);
  });

  it("refuses confirm without a selected service", async () => {
    const harness = createHarness();
    await harness.session.submitCommand("npx somecommand start --xx");
    expect(() => harness.session.confirm()).toThrow("selected service");
  });

  it("materializes through the frozen form and reaches success", async () => {
    const events: WizardEvent[] = [];
    let runKilled = false;
    let listeners = new Set<number>();
    const session = createWizardSession({
      cwd: "/tmp/wizard-cwd",
      skipInstall: true,
      force: true,
      dependencyRange: "^0.0.0-test",
      platform: "linux",
      emit: (event) => events.push(event),
      spawnRun: (): CommandRun => ({
        pid: 100,
        exited: neverResolve(),
        output: [],
        kill: async () => {
          runKilled = true;
        },
      }),
      listListeners: async () => listeners,
      verifyHttp: async () => true,
      scrape: async (): Promise<ScrapeResult> => ({
        ok: true,
        title: "Materialize Title",
        iconPath: undefined,
        iconUrl: undefined,
      }),
      resolveVector: async ({ tokens, cwd }) => ({
        command: `/resolved/${tokens[0]}`,
        args: tokens.slice(1),
        cwd,
      }),
      materializeContext: {
        generateIcon: (async () => ({
          schemaVersion: 1,
          sourceSha256: "",
          sourceImplementationSha256: null,
          implementationSha256: "",
          recipeVersion: "",
          sharpVersion: "",
          iconEncoderVersion: "",
          figmaSquircleVersion: "",
          outputPath: "",
          icnsOutputPath: "",
          icoOutputPath: "",
          linuxPngOutputPaths: [],
          manifestOutputPath: "",
          appIcon: [],
        })) as unknown as NonNullable<MaterializeContext["generateIcon"]>,
        firstLaunchEntry: async () => ({ pid: 999, ready: Promise.resolve() }),
        waitMs: async () => {},
      },
    });

    await session.submitCommand("npx somecommand start --xx");
    listeners = new Set([19080]);
    await waitFor(() => session.state === "discovered");
    await waitFor(() => session.form.appName === "Materialize Title");

    session.confirm();
    await session.create();

    expect(session.state).toBe("success");
    expect(runKilled).toBe(true);
    const success = events.find(
      (event): event is Extract<WizardEvent, { type: "success" }> => event.type === "success",
    );
    expect(success?.projectDir).toContain("start-somecommand-npx");
    expect(success?.pinHint).toBeTruthy();
    expect(session.result?.projectDir).toContain("start-somecommand-npx");
  });
});
