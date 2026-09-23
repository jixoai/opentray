// Orthogonal intents (2026-09-20; harden-transport-robustness Phase C/D,
// original user request: broker death must surface as a bounded event and
// recover with zero consumer code):
// 1. Supervise exactly one live broker connection per generation; never
//    resurrect a dead connection (its D3 single-flight death contract stays
//    per-connection truth).
// 2. Detect uninvited death through socket close/error plus an idle-gated
//    health-probe heartbeat (Phase A deadline machinery bounds each probe).
// 3. Recover by reconnecting through the caller's original connect options
//    (identity gates and lock reclaim live in connectLocalBroker), replaying
//    a declarative journal, and re-running registered facade rebuild
//    callbacks in registration order.
// 4. Bound recovery with an in-process sliding-window budget; exhaustion is
//    the terminal `abandoned` state with typed fail-fast calls.
// 5. Keep caller-initiated teardown recovery-free and wall-clock bounded
//    (the Phase A teardown budget class is the caller-intent marker).

import type {
  AppIcon,
  AppRef,
  ClientRequestFrame,
  ExpectedExtensionIdentity,
  Icon,
  Menu,
  RequestId,
  ServerFrame,
  Tooltip,
  TrayId,
  TrayOptions,
} from "@opentray/spec";

import {
  BROKER_CONNECTION_CLOSED_MESSAGE,
  type LocalBrokerClient,
} from "./local-broker";
import {
  BOOTSTRAP_CALL_DEADLINE_MS,
  TEARDOWN_CALL_DEADLINE_MS,
  BrokerServerError,
  type OpenTrayEventFrame,
  type TransportRebuildContext,
  type TransportRequestOptions,
  type TransportState,
} from "./client";

/**
 * Default heartbeat cadence (W2; field-validated numbers from the pnpm-pub
 * silent-wedge reference implementation): probe only after 30 s of silence,
 * settle each probe within 3 s, declare death after 3 consecutive failures.
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_PROBE_DEADLINE_MS = 3_000;
export const DEFAULT_HEARTBEAT_FAILURE_THRESHOLD = 3;

/**
 * Default recovery budget (W5): 3 respawn attempts per 10-minute window,
 * 1 s initial cooldown with exponential backoff (factor 2, capped at 30 s),
 * and a 10 s budget per reconnect attempt so a hanging connect can never
 * park the recovery loop. In-memory per supervisor — a fresh `createTray` is
 * a fresh budget, matching "a manual process restart resets the budget".
 */
export const DEFAULT_RECOVERY_MAX_RESTARTS = 3;
export const DEFAULT_RECOVERY_WINDOW_MS = 600_000;
export const DEFAULT_RECOVERY_COOLDOWN_MS = 1_000;
export const DEFAULT_RECOVERY_BACKOFF_FACTOR = 2;
export const DEFAULT_RECOVERY_BACKOFF_CAP_MS = 30_000;
export const DEFAULT_RECOVERY_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Typed fail-fast rejection for every call issued after supervision reached
 * its terminal `abandoned` state: the recovery budget is exhausted and the
 * runtime stays headless by design (the consumer process keeps running).
 * Consumers match on `code` (`transport_abandoned`); `details` carries the
 * budget facts `{ recoveries, windowMs }`.
 */
export class TransportAbandonedError extends Error {
  readonly code = "transport_abandoned";
  readonly details: { readonly recoveries: number; readonly windowMs: number };

  constructor(recoveries: number, windowMs: number) {
    super(
      `transport abandoned: ${recoveries} recovery attempts within ${windowMs}ms exhausted the budget; every later call fails fast`,
    );
    this.name = "TransportAbandonedError";
    this.details = { recoveries, windowMs };
  }
}

/**
 * Tier 0/2 recovery policy (W6). Every key has a working default; the whole
 * object is optional — not configuring it means full default protection.
 * Policy stays in the app; mechanism stays in the SDK.
 */
export interface TransportRecoveryOptions {
  /**
   * Master switch (default `true`). `false` degrades supervision to today's
   * behavior plus heartbeat death detection: declared death stays terminal
   * per connection, no respawn, no `recovering`/`abandoned` transitions.
   */
  enabled?: boolean;
  /** Recovery attempts allowed per sliding `windowMs` (default 3). */
  maxRestarts?: number;
  /** Sliding budget window in milliseconds (default 600_000 = 10 min). */
  windowMs?: number;
  /** Cooldown before the first respawn attempt (default 1_000). */
  cooldownMs?: number;
  /** Multiplier applied to the cooldown after each failed attempt (default 2). */
  backoffFactor?: number;
  /** Backoff ceiling in milliseconds (default 30_000). */
  backoffCapMs?: number;
  /**
   * Budget for one reconnect attempt (default 10 s). A connect factory that
   * never settles counts as a failed attempt instead of parking the
   * recovery loop; its late-resolving connection is closed on arrival.
   */
  connectTimeoutMs?: number;
  /**
   * Tier 2 hand-over (default: absent). When provided, an uninvited death
   * performs a bounded teardown, invokes this callback exactly once, and goes
   * terminal — the supervisor never performs in-process rebuild and never
   * loops. The SDK never embeds app-process restart vectors itself.
   */
  restartApp?: () => void | Promise<void>;
}

/** Constructor tuning for {@link createTransportSupervisor}. */
export interface CreateTransportSupervisorOptions {
  /**
   * Establishes one broker connection generation. Production callers close
   * over `connectLocalBroker` with the caller's original options so a
   * respawn is exactly a reconnect: daemon lifecycle, identity gates, and
   * lock reclaim all reapply unchanged.
   */
  connect(): Promise<LocalBrokerClient>;
  /** Idle gap before a health probe is sent (default 30 s). */
  heartbeatIntervalMs?: number;
  /** Per-probe deadline budget (default 3 s). */
  probeDeadlineMs?: number;
  /** Consecutive probe failures that declare death (default 3). */
  heartbeatFailureThreshold?: number;
  /** Recovery policy; every key defaulted (Tier 0). */
  recovery?: TransportRecoveryOptions;
}

/**
 * Declarative state snapshot recorded from successfully settled mutating
 * frames (Tier 0's zero-API journal). One ordered list; keyed entries
 * (tray/app mutations, extension mounts) replace in place at first-occurrence
 * position, `create-tray` entries append in creation order. Only frames that
 * settled successfully are recorded — a rejected mutation never became
 * broker state.
 */
type JournalEntry =
  | { kind: "resolve-default-app"; appId: string }
  | { kind: "create-tray"; app: AppRef; tray: TrayOptions; trayId: TrayId }
  | {
      kind: "set-tray-menu";
      appId: string;
      trayId: TrayId;
      menu: Menu;
    }
  | { kind: "set-tray-icon"; appId: string; trayId: TrayId; icon: Icon }
  | {
      kind: "set-tray-tooltip";
      appId: string;
      trayId: TrayId;
      tooltip: Tooltip;
    }
  | { kind: "set-app-name"; appId: string; name: string }
  | { kind: "set-app-icon"; appId: string; appIcon: AppIcon | null }
  | { kind: "set-app-icon-variant"; appId: string; variant: string }
  | {
      kind: "load-ext";
      appId: string;
      name: string;
      path: string;
      expectedIdentity: ExpectedExtensionIdentity;
      mountId?: string;
    };

const journalKeyOf = (entry: JournalEntry): string | undefined => {
  switch (entry.kind) {
    case "resolve-default-app":
      return "resolve-default-app";
    case "create-tray":
      return undefined;
    case "set-tray-menu":
    case "set-tray-icon":
    case "set-tray-tooltip":
      return `${entry.kind}:${entry.appId}:${entry.trayId}`;
    case "set-app-name":
    case "set-app-icon":
    case "set-app-icon-variant":
      return `${entry.kind}:${entry.appId}`;
    case "load-ext":
      return `load-ext:${entry.appId}:${entry.mountId ?? entry.name}`;
  }
};

/** Structural view of connections publishing Phase A's expiry seam. */
interface DeadlineExpirySource {
  onDeadlineExpiry(listener: (expiry: { requestId: RequestId; deadlineMs: number }) => void): () => void;
}

const isDeadlineExpirySource = (
  connection: LocalBrokerClient,
): connection is LocalBrokerClient & DeadlineExpirySource =>
  "onDeadlineExpiry" in connection && typeof connection.onDeadlineExpiry === "function";

/** Structural view of connections publishing their terminal death signal. */
interface ConnectionDeadSource {
  onConnectionDead(handler: (error: Error) => void): () => void;
}

const isConnectionDeadSource = (
  connection: LocalBrokerClient,
): connection is LocalBrokerClient & ConnectionDeadSource =>
  "onConnectionDead" in connection && typeof connection.onConnectionDead === "function";

const sleepUnref = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });

/**
 * Supervised transport (W2/W4/W5/W6): a stable `OpenTrayConnection`-shaped
 * proxy for the layers above (createClient, tray handles) that owns one
 * broker connection per generation underneath. Consumer event subscriptions
 * and the supervision state machine survive generation changes;
 * per-connection surfaces (`onConnectionDead`) stay per-generation truth.
 */
export class SupervisedLocalBrokerConnection {
  private readonly heartbeatIntervalMs: number;
  private readonly probeDeadlineMs: number;
  private readonly heartbeatFailureThreshold: number;
  private readonly recoveryEnabled: boolean;
  private readonly maxRestarts: number;
  private readonly recoveryWindowMs: number;
  private readonly cooldownMs: number;
  private readonly backoffFactor: number;
  private readonly backoffCapMs: number;
  private readonly connectTimeoutMs: number;
  private readonly restartApp: (() => void | Promise<void>) | undefined;

  private connection: LocalBrokerClient | undefined;
  private generation = 0;
  private state: TransportState = "healthy";
  private journal: JournalEntry[] = [];
  private readonly eventListeners = new Set<(frame: OpenTrayEventFrame) => void>();
  private readonly deadListeners = new Set<(error: Error) => void>();
  private readonly stateListeners = new Set<(state: TransportState) => void>();
  private readonly rebuildCallbacks: Array<
    (context: TransportRebuildContext) => Promise<void>
  > = [];
  private unwireGeneration: () => void = noop;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatOrdinal = 0;
  private heartbeatInFlight = false;
  private consecutiveHeartbeatFailures = 0;
  private lastSettledAt = 0;
  private restartTimestamps: number[] = [];
  private callerInitiated = false;
  /**
   * Monotonic teardown epoch: `shutdown()` bumps it so an in-flight recovery
   * attempt can detect that it raced caller-initiated teardown and abort
   * instead of resurrecting a destroyed runtime (no candidate adoption, no
   * `healthy` transition, no restarted heartbeat).
   */
  private teardownEpoch = 0;
  private shutdownPromise: Promise<void> | undefined;
  /**
   * Ref'd keepalive held while the supervised runtime is alive (healthy or
   * recovering). Every supervision timer is deliberately unref'd (library
   * semantics), so a minimal consumer whose only loop holder is the broker
   * connection drains its event loop during the death→reconnect window and
   * exits cleanly mid-recovery (real-machine Windows evidence 2026-09-22) —
   * silent death, the outcome the transport law forbids. Released at the
   * terminal `abandoned` state, on caller teardown, and on terminal death
   * with recovery disabled, so an explicitly dead runtime never zombies
   * the host process.
   */
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly connectFactory: () => Promise<LocalBrokerClient>,
    options: CreateTransportSupervisorOptions,
  ) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.probeDeadlineMs = options.probeDeadlineMs ?? DEFAULT_PROBE_DEADLINE_MS;
    this.heartbeatFailureThreshold =
      options.heartbeatFailureThreshold ?? DEFAULT_HEARTBEAT_FAILURE_THRESHOLD;
    const recovery = options.recovery ?? {};
    this.recoveryEnabled = recovery.enabled ?? true;
    this.maxRestarts = recovery.maxRestarts ?? DEFAULT_RECOVERY_MAX_RESTARTS;
    this.recoveryWindowMs = recovery.windowMs ?? DEFAULT_RECOVERY_WINDOW_MS;
    this.cooldownMs = recovery.cooldownMs ?? DEFAULT_RECOVERY_COOLDOWN_MS;
    this.backoffFactor = recovery.backoffFactor ?? DEFAULT_RECOVERY_BACKOFF_FACTOR;
    this.backoffCapMs = recovery.backoffCapMs ?? DEFAULT_RECOVERY_BACKOFF_CAP_MS;
    this.connectTimeoutMs = recovery.connectTimeoutMs ?? DEFAULT_RECOVERY_CONNECT_TIMEOUT_MS;
    this.restartApp = recovery.restartApp;
  }

  /** Current supervision state; edge events go to {@link onTransportStateChange}. */
  get transportState(): TransportState {
    return this.state;
  }

  /** Monotonic generation counter; each respawn/replay increments it once. */
  get transportGeneration(): number {
    return this.generation;
  }

  /** Current generation's endpoint (proxy; absent before the first connect). */
  get endpoint(): string {
    return this.connection?.endpoint ?? "";
  }

  /** Current generation's caller label (proxy; absent before the first connect). */
  get callerLabel(): string {
    return this.connection?.callerLabel ?? "";
  }

  /**
   * Current generation's broker session id. Read dynamically so extension
   * contexts and rebuild callbacks can attribute session-owned state to the
   * live generation (the id changes on every respawn).
   */
  get sessionId(): string {
    return this.connection?.sessionId ?? "";
  }

  /** True once the current generation's connection died (or none exists). */
  get connectionDead(): boolean {
    return this.connection === undefined || this.connection.connectionDead;
  }

  /**
   * Establishes generation 0. A failure here propagates to the caller
   * unchanged — supervision (heartbeat, recovery) only guards a connection
   * that once existed; an app that never started is a plain startup failure.
   */
  async connect(): Promise<void> {
    const connection = await this.connectFactory();
    this.connection = connection;
    this.unwireGeneration = this.wireGeneration(connection);
    this.lastSettledAt = Date.now();
    this.consecutiveHeartbeatFailures = 0;
    this.startHeartbeat();
    this.holdProcessAlive();
  }

  /**
   * Forwards one request to the current generation. After the terminal
   * `abandoned` state every call fails fast with {@link TransportAbandonedError}.
   * A teardown-budget call (`deadlineMs === TEARDOWN_CALL_DEADLINE_MS`) marks
   * the supervision caller-initiated: Phase A froze the budget class as the
   * caller-intent channel, so a socket close racing caller-initiated destroy
   * can never be misread as uninvited death.
   */
  async request(
    frame: ClientRequestFrame,
    options: TransportRequestOptions = {},
  ): Promise<ServerFrame> {
    if (this.state === "abandoned") {
      throw new TransportAbandonedError(this.restartTimestamps.length, this.recoveryWindowMs);
    }
    if (options.deadlineMs === TEARDOWN_CALL_DEADLINE_MS) {
      this.callerInitiated = true;
    }
    const connection = this.connection;
    if (connection === undefined) {
      throw new Error(BROKER_CONNECTION_CLOSED_MESSAGE);
    }
    const candidate = journalCandidateFrom(frame);
    const response = await connection.request(frame, options);
    this.noteSuccessfulSettlement();
    if (candidate !== undefined) {
      this.commitJournalEntry(candidate, response);
    }
    if (frame.type === "destroy-tray") {
      // A successfully destroyed tray must not resurrect on recovery: the
      // journal mirrors declarative broker state, so teardown evicts it.
      this.evictJournalTray(frame.appId, frame.trayId);
    }
    return response;
  }

  /**
   * Consumer event subscription that survives generation changes: each new
   * generation's event stream fans out to the same listeners.
   */
  onEvent(listener: (frame: OpenTrayEventFrame) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /**
   * Per-connection death notification, forwarded for every generation (D3
   * semantics preserved: consumers using it for per-connection cleanup keep
   * working; the supervision state machine is the new higher-level truth).
   */
  onConnectionDead(listener: (error: Error) => void): () => void {
    this.deadListeners.add(listener);
    return () => {
      this.deadListeners.delete(listener);
    };
  }

  /**
   * Tier 1 health projection (W6): edge-triggered `healthy | recovering |
   * abandoned` transitions. The initial `healthy` state never fires —
   * consumers reading the current state use `transportState`.
   */
  onTransportStateChange(listener: (state: TransportState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Registers one facade rebuild callback (W4). Callbacks run in
   * registration order after the core journal replay on every successful
   * recovery, receiving the fresh generation number and session id so
   * session-attributed native state can be re-created against the live
   * broker session.
   */
  registerTransportRebuild(
    rebuild: (context: TransportRebuildContext) => Promise<void>,
  ): void {
    this.rebuildCallbacks.push(rebuild);
  }

  /**
   * Graceful teardown channel (W4/W3): idempotent, marks the supervision
   * caller-initiated synchronously (so the close-driven death event can
   * never trigger recovery), bumps the teardown epoch (so an in-flight
   * recovery attempt aborts instead of resurrecting the runtime), stops the
   * heartbeat, then closes the current generation — including an
   * adoption-in-progress candidate routed through `this.connection` —
   * within its bounded graceful-close budget.
   */
  async shutdown(): Promise<void> {
    this.callerInitiated = true;
    this.teardownEpoch += 1;
    this.shutdownPromise ??= (async () => {
      this.stopHeartbeat();
      this.releaseProcessHold();
      this.unwireGeneration();
      this.unwireGeneration = noop;
      const connection = this.connection;
      this.connection = undefined;
      if (connection !== undefined) {
        await connection.close().catch(noopAsync);
      }
    })();
    await this.shutdownPromise;
  }

  /** LocalBrokerClient structural compatibility: graceful close == shutdown. */
  close(): Promise<void> {
    return this.shutdown();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeatTick();
    }, this.heartbeatIntervalMs);
    // Library semantics: supervision must never keep the host process alive.
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /** Idempotent: the supervised runtime being alive is the whole condition. */
  private holdProcessAlive(): void {
    this.keepAliveTimer ??= setInterval(noop, 60_000);
  }

  private releaseProcessHold(): void {
    if (this.keepAliveTimer !== undefined) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /**
   * Idle-gated heartbeat (W2): a transport that keeps settling requests
   * proves its own liveness, so the probe budget is spent only on silence.
   * A probe failure of any rejection class (typed timeout, transport-lost,
   * broker error frame) counts; a successful settlement resets the streak.
   * Single-flight with a generation token: at most one probe per generation
   * is outstanding (a configured interval shorter than the probe deadline
   * must not run concurrent probes whose completions double-count), and a
   * probe that outlives its generation settles nothing.
   */
  private async heartbeatTick(): Promise<void> {
    if (this.heartbeatInFlight) {
      return;
    }
    const connection = this.connection;
    const probeGeneration = this.generation;
    if (
      connection === undefined ||
      this.state !== "healthy" ||
      this.callerInitiated
    ) {
      return;
    }
    if (Date.now() - this.lastSettledAt < this.heartbeatIntervalMs) {
      return;
    }
    this.heartbeatInFlight = true;
    const requestId = `supervisor-heartbeat-${this.generation}-${(this.heartbeatOrdinal += 1)}`;
    try {
      await connection.request(
        { type: "health", requestId },
        { deadlineMs: this.probeDeadlineMs },
      );
      if (this.generation === probeGeneration && this.state === "healthy") {
        this.consecutiveHeartbeatFailures = 0;
        this.noteSuccessfulSettlement();
      }
    } catch (error) {
      if (this.generation !== probeGeneration || this.state !== "healthy") {
        return;
      }
      this.consecutiveHeartbeatFailures += 1;
      if (this.consecutiveHeartbeatFailures < this.heartbeatFailureThreshold) {
        return;
      }
      // Declared death: settle the verdict through the sentinel family so
      // consumers matching the message keep working; the cause carries the
      // probe accounting for diagnostics.
      const death = new Error(BROKER_CONNECTION_CLOSED_MESSAGE, {
        cause: `heartbeat declared death after ${this.consecutiveHeartbeatFailures} consecutive probe failures (${String(error)})`,
      });
      // The death funnel runs first and unwires this generation; the bounded
      // close then rejects the half-open socket's pending entries through
      // the real destroy path without a second death notification.
      this.handleGenerationDeath(death);
      void connection.close().catch(noopAsync);
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private noteSuccessfulSettlement(): void {
    this.lastSettledAt = Date.now();
    this.consecutiveHeartbeatFailures = 0;
  }

  /**
   * Subscribes this supervisor's stable listener sets to one generation.
   * Event fanout and the death/expiry seams are wired before the generation
   * becomes `this.connection` (recovery candidates are wired before replay)
   * so no observable event window opens between adoption steps.
   */
  private wireGeneration(connection: LocalBrokerClient): () => void {
    const unwires: Array<() => void> = [];
    const unlistenEvents = connection.onEvent((frame) => {
      for (const listener of [...this.eventListeners]) {
        try {
          listener(frame);
        } catch {
          // A throwing consumer listener must not block fan-out.
        }
      }
    });
    unwires.push(unlistenEvents);
    // Structural capability tap (repo pattern): transports without a
    // death signal keep every other supervision feature and simply never
    // declare socket-close deaths — the real local broker connection always
    // publishes one, test fakes may not.
    if (isConnectionDeadSource(connection)) {
      const unlistenDead = connection.onConnectionDead((error) => {
        this.handleGenerationDeath(error);
      });
      unwires.push(unlistenDead);
    }
    if (isDeadlineExpirySource(connection)) {
      const unlistenExpiry = connection.onDeadlineExpiry((expiry) => {
        // Probe expiries are attributed by the probe's own rejection; every
        // other expiry is one liveness-failure signal (W1: an expiry never
        // declares death by itself).
        if (expiry.requestId.startsWith("supervisor-heartbeat-")) {
          return;
        }
        this.consecutiveHeartbeatFailures += 1;
        if (
          this.consecutiveHeartbeatFailures >= this.heartbeatFailureThreshold &&
          this.state === "healthy" &&
          !this.callerInitiated
        ) {
          const connectionAtDeath = this.connection;
          // Death funnel first (unwires), bounded close second: same ordering
          // guarantee as the probe-failure path above.
          this.handleGenerationDeath(
            new Error(BROKER_CONNECTION_CLOSED_MESSAGE, {
              cause: `heartbeat declared death after ${this.consecutiveHeartbeatFailures} consecutive deadline expiries`,
            }),
          );
          if (connectionAtDeath !== undefined) {
            void connectionAtDeath.close().catch(noopAsync);
          }
        }
      });
      unwires.push(unlistenExpiry);
    }
    return () => {
      for (const unwire of unwires.splice(0)) {
        unwire();
      }
    };
  }

  /**
   * Death funnel: forwards the per-connection event first (D3 truth), stops
   * this generation's wiring, then decides the supervision reaction. The
   * state guard makes the reaction single-flight — deaths of candidates
   * during an ongoing recovery only forward, they never nest recoveries.
   */
  private handleGenerationDeath(error: Error): void {
    for (const listener of [...this.deadListeners]) {
      try {
        listener(error);
      } catch {
        // A throwing terminal listener must not block death propagation.
      }
    }
    if (this.callerInitiated || this.state !== "healthy") {
      return;
    }
    this.unwireGeneration();
    this.unwireGeneration = noop;
    if (this.restartApp !== undefined) {
      void this.handOverToRestartApp();
      return;
    }
    if (!this.recoveryEnabled) {
      // Tier-off: declared death stays terminal per connection (today's
      // behavior + heartbeat); no state transitions, no respawn. The
      // terminal death also releases the process hold — a recovery-off
      // runtime must not zombie the host after its connection died.
      this.releaseProcessHold();
      return;
    }
    void this.runRecovery();
  }

  /**
   * Tier 2 hand-over: bounded teardown of the current generation, the app's
   * restart vector invoked exactly once, then terminal. No in-process
   * rebuild, no loop — restart ownership belongs to the callback.
   */
  private async handOverToRestartApp(): Promise<void> {
    this.setState("recovering");
    // Suppress every further supervision reaction first: our own teardown
    // fires the generation's death event, and the restart vector is the
    // app's policy from here on.
    this.callerInitiated = true;
    this.stopHeartbeat();
    const connection = this.connection;
    if (connection !== undefined && !connection.connectionDead) {
      await connection.close().catch(noopAsync);
    }
    try {
      await this.restartApp?.();
    } catch (error) {
      // The callback is app policy: surface the failure, never re-enter
      // supervision with it, and still settle the terminal state.
      console.error("OpenTray recovery.restartApp callback failed:", error);
    }
    this.setState("abandoned");
  }

  /**
   * In-process recovery (W4/W5): cooldown backoff → reconnect through the
   * original connect options → journal replay → facade rebuilds → healthy.
   * Every attempt consumes budget up front; a failed attempt (connect,
   * replay, or rebuild — including artifact identity mismatches) retries
   * inside the remaining budget until exhaustion abandons the runtime. Each
   * reconnect attempt is bounded by the connect budget, and every step
   * re-checks the teardown epoch so a shutdown racing the loop aborts it
   * instead of resurrecting the runtime.
   */
  private async runRecovery(): Promise<void> {
    this.setState("recovering");
    let backoffOrdinal = 0;
    while (true) {
      if (this.callerInitiated) {
        // Consumer teardown raced the recovery; the graceful path wins.
        return;
      }
      if (!this.consumeRestartBudget()) {
        this.setState("abandoned");
        return;
      }
      await sleepUnref(this.cooldownForBackoff(backoffOrdinal));
      if (this.callerInitiated) {
        return;
      }
      const attemptEpoch = this.teardownEpoch;
      try {
        const candidate = await this.connectWithBudget();
        if (this.teardownEpoch !== attemptEpoch || this.callerInitiated) {
          // Shutdown landed while the connect was in flight: the candidate
          // belongs to nobody — close it and stay torn down.
          await candidate.close().catch(noopAsync);
          return;
        }
        await this.adoptGeneration(candidate, attemptEpoch);
        if (this.teardownEpoch !== attemptEpoch || this.callerInitiated) {
          return;
        }
        this.setState("healthy");
        return;
      } catch {
        backoffOrdinal += 1;
      }
    }
  }

  /**
   * One reconnect attempt under the connect budget. A factory that never
   * settles counts as a failed attempt; a connection arriving after the
   * budget expired is closed on arrival so no orphan generation leaks.
   */
  private async connectWithBudget(): Promise<LocalBrokerClient> {
    let settled = false;
    return new Promise<LocalBrokerClient>((resolve, reject) => {
      const late = (candidate: LocalBrokerClient): void => {
        void candidate.close().catch(noopAsync);
      };
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(`recovery connect exceeded ${this.connectTimeoutMs}ms`));
      }, this.connectTimeoutMs);
      timer.unref();
      this.connectFactory().then(
        (candidate) => {
          if (settled) {
            late(candidate);
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(candidate);
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  private cooldownForBackoff(backoffOrdinal: number): number {
    return Math.min(
      this.cooldownMs * this.backoffFactor ** backoffOrdinal,
      this.backoffCapMs,
    );
  }

  /**
   * Sliding-window budget: one timestamp per respawn attempt (successful or
   * not — both are respawns the consumer experienced). In-memory per
   * supervisor by ruling; a fresh `createTray` starts a fresh budget.
   */
  private consumeRestartBudget(): boolean {
    const windowStart = Date.now() - this.recoveryWindowMs;
    this.restartTimestamps = this.restartTimestamps.filter(
      (timestamp) => timestamp > windowStart,
    );
    if (this.restartTimestamps.length >= this.maxRestarts) {
      return false;
    }
    this.restartTimestamps.push(Date.now());
    return true;
  }

  /**
   * Wires the candidate generation, replays the journal, and runs the
   * facade rebuild callbacks. The candidate becomes `this.connection` for
   * the adoption's duration — facade rebuild callbacks route their
   * re-creation commands through this supervisor, so they must reach the
   * candidate, not the dead generation (the rebuild-routing law). A failure
   * rolls the candidate back out (unwired, closed) and restores the dead
   * previous connection so consumer calls keep failing fast; a teardown
   * racing the adoption aborts without resurrecting anything.
   */
  private async adoptGeneration(
    candidate: LocalBrokerClient,
    attemptEpoch: number,
  ): Promise<void> {
    const previousConnection = this.connection;
    this.generation += 1;
    this.unwireGeneration = this.wireGeneration(candidate);
    this.connection = candidate;
    try {
      await this.replayJournal(candidate);
      for (const rebuild of [...this.rebuildCallbacks]) {
        await rebuild({
          generation: this.generation,
          sessionId: candidate.sessionId.length > 0 ? candidate.sessionId : undefined,
        });
      }
      if (this.teardownEpoch !== attemptEpoch || this.callerInitiated) {
        // Shutdown raced a fully replayed candidate: unwind it instead of
        // resurrecting a torn-down runtime.
        this.rollbackAdoption(candidate, previousConnection);
        throw new Error("recovery aborted by caller-initiated teardown");
      }
    } catch (error) {
      this.rollbackAdoption(candidate, previousConnection);
      throw error;
    }
    this.consecutiveHeartbeatFailures = 0;
    this.noteSuccessfulSettlement();
    this.holdProcessAlive();
  }

  /**
   * Removes a failed (or torn-down) adoption candidate: stop its wiring,
   * close it bounded, and restore the previous dead connection unless a
   * caller-initiated shutdown already dissolved the runtime (shutdown's own
   * close handled the candidate in that window; the restore must not undo
   * the torn-down state).
   */
  private rollbackAdoption(
    candidate: LocalBrokerClient,
    previousConnection: LocalBrokerClient | undefined,
  ): void {
    this.unwireGeneration();
    this.unwireGeneration = noop;
    if (this.connection === candidate) {
      this.connection = this.callerInitiated ? undefined : previousConnection;
    }
    void candidate.close().catch(noopAsync);
  }

  /**
   * Replays the declarative journal in record order with fresh request ids
   * under the bootstrap deadline class. The resolved default app of the new
   * generation becomes the appId authority: replayed frames are rewritten
   * onto it, so app-scoped state follows broker truth instead of a stale
   * generation's identity.
   */
  private async replayJournal(connection: LocalBrokerClient): Promise<void> {
    let ordinal = 0;
    const appIdRewrites = new Map<string, string>();
    const rewriteAppId = (appId: string): string => appIdRewrites.get(appId) ?? appId;
    for (const entry of this.journal) {
      ordinal += 1;
      const requestId: RequestId = `supervisor-replay-${this.generation}-${ordinal}`;
      let frame: ClientRequestFrame;
      switch (entry.kind) {
        case "resolve-default-app":
          frame = { type: "resolve-default-app", requestId };
          break;
        case "create-tray":
          frame = {
            type: "create-tray",
            requestId,
            app: { appId: rewriteAppId(entry.app.appId) },
            // Inject the originally resolved trayId: handle identity must
            // stay stable across generations even when the caller omitted a
            // tray id and the first broker assigned one.
            tray: { ...entry.tray, id: entry.trayId },
          };
          break;
        case "set-tray-menu":
          frame = {
            type: "set-tray-menu",
            requestId,
            appId: rewriteAppId(entry.appId),
            trayId: entry.trayId,
            menu: entry.menu,
          };
          break;
        case "set-tray-icon":
          frame = {
            type: "set-tray-icon",
            requestId,
            appId: rewriteAppId(entry.appId),
            trayId: entry.trayId,
            icon: entry.icon,
          };
          break;
        case "set-tray-tooltip":
          frame = {
            type: "set-tray-tooltip",
            requestId,
            appId: rewriteAppId(entry.appId),
            trayId: entry.trayId,
            tooltip: entry.tooltip,
          };
          break;
        case "set-app-name":
          frame = {
            type: "set-app-name",
            requestId,
            appId: rewriteAppId(entry.appId),
            name: entry.name,
          };
          break;
        case "set-app-icon":
          frame = {
            type: "set-app-icon",
            requestId,
            appId: rewriteAppId(entry.appId),
            appIcon: entry.appIcon,
          };
          break;
        case "set-app-icon-variant":
          frame = {
            type: "set-app-icon-variant",
            requestId,
            appId: rewriteAppId(entry.appId),
            variant: entry.variant,
          };
          break;
        case "load-ext":
          frame = {
            type: "load-ext",
            requestId,
            appId: rewriteAppId(entry.appId),
            name: entry.name,
            path: entry.path,
            expectedIdentity: entry.expectedIdentity,
            ...(entry.mountId === undefined ? {} : { mountId: entry.mountId }),
          };
          break;
      }
      const response = await connection.request(frame, {
        deadlineMs: BOOTSTRAP_CALL_DEADLINE_MS,
      });
      if (response.type === "error") {
        throw new BrokerServerError(response.code, response.message, {
          details: response.details,
        });
      }
      if (entry.kind === "resolve-default-app" && response.type === "default-app") {
        appIdRewrites.set(entry.appId, response.app.appId);
      }
    }
  }

  private setState(state: TransportState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    if (state === "abandoned") {
      // Terminal: no heartbeat is ever useful again, and an explicitly dead
      // runtime no longer holds the host process.
      this.stopHeartbeat();
      this.releaseProcessHold();
    }
    for (const listener of [...this.stateListeners]) {
      try {
        listener(state);
      } catch {
        // A throwing state listener must not block the transition.
      }
    }
  }

  private commitJournalEntry(frame: ClientRequestFrame, response: ServerFrame): void {
    switch (frame.type) {
      case "resolve-default-app":
        if (response.type === "default-app") {
          this.upsertJournal({
            kind: "resolve-default-app",
            appId: response.app.appId,
          });
        }
        return;
      case "create-tray": {
        const trayId: TrayId =
          response.type === "tray-created" && typeof response.trayId === "string"
            ? response.trayId
            : frame.tray.id;
        this.journal.push({
          kind: "create-tray",
          app: frame.app,
          tray: frame.tray,
          trayId,
        });
        return;
      }
      case "set-tray-menu":
        this.upsertJournal({
          kind: "set-tray-menu",
          appId: frame.appId,
          trayId: frame.trayId,
          menu: frame.menu,
        });
        return;
      case "set-tray-icon":
        this.upsertJournal({
          kind: "set-tray-icon",
          appId: frame.appId,
          trayId: frame.trayId,
          icon: frame.icon,
        });
        return;
      case "set-tray-tooltip":
        this.upsertJournal({
          kind: "set-tray-tooltip",
          appId: frame.appId,
          trayId: frame.trayId,
          tooltip: frame.tooltip,
        });
        return;
      case "set-app-name":
        this.upsertJournal({ kind: "set-app-name", appId: frame.appId, name: frame.name });
        return;
      case "set-app-icon":
        this.upsertJournal({
          kind: "set-app-icon",
          appId: frame.appId,
          appIcon: frame.appIcon,
        });
        return;
      case "set-app-icon-variant":
        this.upsertJournal({
          kind: "set-app-icon-variant",
          appId: frame.appId,
          variant: frame.variant,
        });
        return;
      case "load-ext":
        this.upsertJournal({
          kind: "load-ext",
          appId: frame.appId,
          name: frame.name,
          path: frame.path,
          expectedIdentity: frame.expectedIdentity,
          ...(frame.mountId === undefined ? {} : { mountId: frame.mountId }),
        });
        return;
      default:
        return;
    }
  }

  /**
   * Keyed entries replace in place at first-occurrence position (last-write-
   * wins value, stable ordering); first occurrences append. Tray creations
   * and mount declarations keep their creation order by construction.
   */
  private upsertJournal(entry: JournalEntry): void {
    const key = journalKeyOf(entry);
    if (key === undefined) {
      this.journal.push(entry);
      return;
    }
    const existing = this.journal.findIndex(
      (candidate) => journalKeyOf(candidate) === key,
    );
    if (existing < 0) {
      this.journal.push(entry);
      return;
    }
    this.journal[existing] = entry;
  }

  private evictJournalTray(appId: string, trayId: TrayId): void {
    this.journal = this.journal.filter((entry) => {
      switch (entry.kind) {
        case "create-tray":
          return !(entry.app.appId === appId && entry.trayId === trayId);
        case "set-tray-menu":
        case "set-tray-icon":
        case "set-tray-tooltip":
          return !(entry.appId === appId && entry.trayId === trayId);
        default:
          return true;
      }
    });
  }
}

/**
 * Snapshot candidate for the declarative journal: a defensive clone of every
 * journalable mutating frame, taken before the await so later caller
 * mutation of the frame object cannot corrupt the recorded state. The entry
 * is committed only after the frame settles successfully.
 */
const journalCandidateFrom = (frame: ClientRequestFrame): ClientRequestFrame | undefined => {
  switch (frame.type) {
    case "resolve-default-app":
    case "create-tray":
    case "set-tray-menu":
    case "set-tray-icon":
    case "set-tray-tooltip":
    case "set-app-name":
    case "set-app-icon":
    case "set-app-icon-variant":
    case "load-ext":
      return structuredClone(frame);
    default:
      return undefined;
  }
};

/** Constructs a supervised transport around one connect factory. */
export const createTransportSupervisor = (
  options: CreateTransportSupervisorOptions,
): SupervisedLocalBrokerConnection =>
  new SupervisedLocalBrokerConnection(options.connect, options);

const noop = (): void => {};
const noopAsync = (): void => {};
