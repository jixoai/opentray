// Orthogonal intents (maintained 2026-07-21; original user requests: pnpm
// install must be sufficient; an empty App launch command must remember the
// current process.argv invocation for the next stable-bundle launch):
// 1. Expose one direct, ergonomic createTray entrypoint.
// 2. Normalize app-facing menu shorthand into the protocol model.
// 3. Make the returned handle own and deterministically close its broker session.
// 4. Snapshot caller launch intent before initializing the local runtime.

import type { AppIcon, Icon, Tooltip, TrayOptions } from "@opentray/spec";
import type {
  OpenTrayAppBundleOptions,
  OpenTrayAppLaunchOptions,
} from "@opentray/packaging";

import {
  createClient,
  type EventfulTrayHandle,
  type TrayExtension,
} from "./client";
import { connectLocalBroker, BROKER_CONNECTION_CLOSED_MESSAGE } from "./local-broker";
import {
  createTransportSupervisor,
  type TransportRecoveryOptions,
} from "./transport-supervision";
import {
  normalizeCreateTrayMenu,
  type CreateTrayMenu,
  type CreateTrayMenuClickHandler,
} from "./menu-input";
import { normalizeAppIcon, validateAppIcon } from "./app-icon";
import { normalizeAppLaunch } from "./app-launch";

export interface OpenTrayRuntimeOptions {
  endpoint?: string;
  homeDir?: string;
  packageVersion?: string;
  protocolVersion?: number;
  clientVersion?: string;
  appId?: string;
  appName?: string;
  appIcon?: AppIcon;
  appBundle?: OpenTrayAppBundleOptions;
  /** Stable app-entry launch vector. Omitted/null snapshots the current invocation. */
  appLaunch?: OpenTrayAppLaunchOptions | null;
  autoStart?: boolean;
  /**
   * Optional transport supervision policy (Tier 0/2,
   * harden-transport-robustness). Every key has a working default; omitting
   * the object entirely means full default protection: heartbeat death
   * detection, automatic in-process recovery with journal replay, and a
   * bounded restart budget. `enabled: false` keeps death detection but
   * degrades to today's fail-fast behavior.
   */
  recovery?: TransportRecoveryOptions;
}

/** App-facing tray options accepted by top-level createTray. */
export interface CreateTrayOptions {
  id: string;
  tooltip?: Tooltip;
  icon?: Icon;
  menu?: CreateTrayMenu;
}

/** Tray handle returned by top-level createTray with ergonomic menu and session ownership. */
export interface CreateTrayHandle
  extends Omit<EventfulTrayHandle, "setMenu" | "extend" | "destroy"> {
  setMenu(menu: CreateTrayMenu): Promise<void>;
  extend<TCapability extends object, TOptions = undefined>(
    extension: TrayExtension<TCapability, TOptions>,
    options?: TOptions
  ): CreateTrayHandle & TCapability;
  destroy(): Promise<void>;
}

export const createTray = async (
  options: CreateTrayOptions,
  runtimeOptions: OpenTrayRuntimeOptions = {}
): Promise<CreateTrayHandle> => {
  if (runtimeOptions.appIcon !== undefined) {
    await validateAppIcon(runtimeOptions.appIcon);
  }
  const appIcon =
    runtimeOptions.appIcon === undefined
      ? undefined
      : normalizeAppIcon(runtimeOptions.appIcon);
  const normalized = normalizeCreateTrayOptions(options);
  const appLaunch = normalizeAppLaunch(runtimeOptions.appLaunch);
  const { recovery, ...brokerOptions } = runtimeOptions;
  // The supervisor owns the broker connection from here on: it presents the
  // stable transport surface to createClient/handles while holding one
  // LocalBrokerConnection per generation underneath. A respawn is exactly a
  // reconnect through the original options — daemon lifecycle, identity
  // gates, and lock reclaim all reapply unchanged.
  const supervisor = createTransportSupervisor({
    connect: () =>
      connectLocalBroker({
        ...brokerOptions,
        ...(appIcon === undefined ? {} : { appIcon }),
        appLaunch,
      }),
    ...(recovery === undefined ? {} : { recovery }),
  });
  try {
    await supervisor.connect();
    const tray = await createClient(supervisor, {
      appOptions: {
        ...(runtimeOptions.appName === undefined
          ? {}
          : { name: runtimeOptions.appName }),
        ...(appIcon === undefined ? {} : { appIcon }),
      },
    }).createTray(normalized.options);
    return wrapCreateTrayHandle(tray, {
      shutdown: () => supervisor.shutdown(),
      destroyPromise: undefined,
      menuUnsubscribe: bindMenuClickHandlers(tray, normalized.menuHandlers),
    });
  } catch (error) {
    await supervisor.shutdown().catch(noop);
    throw error;
  }
};

const normalizeCreateTrayOptions = (
  options: CreateTrayOptions
): NormalizedCreateTrayOptions => {
  const protocolOptions: Omit<TrayOptions, "menu"> = {
    id: options.id,
    ...(options.tooltip === undefined ? {} : { tooltip: options.tooltip }),
    ...(options.icon === undefined ? {} : { icon: options.icon }),
  };
  if (options.menu === undefined) {
    return { options: protocolOptions, menuHandlers: new Map() };
  }
  const normalized = normalizeCreateTrayMenu(options.menu);
  return {
    options: {
      ...protocolOptions,
      menu: normalized.menu,
    },
    menuHandlers: normalized.handlers,
  };
};

const wrapCreateTrayHandle = (
  tray: EventfulTrayHandle,
  state: CreateTrayHandleState
): CreateTrayHandle => {
  const handle: CreateTrayHandle = {
    ...tray,
    async setMenu(menu: CreateTrayMenu): Promise<void> {
      const normalized = normalizeCreateTrayMenu(menu);
      await tray.setMenu(normalized.menu);
      state.menuUnsubscribe();
      state.menuUnsubscribe = bindMenuClickHandlers(tray, normalized.handlers);
    },
    extend<TCapability extends object, TOptions = undefined>(
      extension: TrayExtension<TCapability, TOptions>,
      options?: TOptions
    ): CreateTrayHandle & TCapability {
      const extended = tray.extend(extension, options);
      return wrapCreateTrayHandle(extended, state) as CreateTrayHandle &
        TCapability;
    },
    async destroy(): Promise<void> {
      state.destroyPromise ??= (async () => {
        state.menuUnsubscribe();
        state.menuUnsubscribe = noop;
        // The broker tears its transport down as soon as its last session
        // closes, so the destroy request can race the broker-side socket
        // close. Both the destroy frame and the connection close rejecting
        // with the transport-close sentinel is the requested end state, not
        // a failure — a generated app's Quit must exit cleanly when the
        // broker exits first (P3.6 quit-path finding, 2026-09-12).
        // The destroy frame carries the teardown budget class (W3), which
        // the supervisor reads as the caller-initiated marker — so this
        // close race can never be misread as uninvited death and never
        // triggers recovery.
        const isTransportClosed = (error: unknown): boolean =>
          error instanceof Error &&
          error.message === BROKER_CONNECTION_CLOSED_MESSAGE;
        try {
          await tray.destroy();
        } catch (error) {
          if (!isTransportClosed(error)) {
            throw error;
          }
        } finally {
          try {
            await state.shutdown();
          } catch (error) {
            if (!isTransportClosed(error)) {
              throw error;
            }
          }
        }
      })();
      await state.destroyPromise;
    },
  };
  return handle;
};

const bindMenuClickHandlers = (
  tray: EventfulTrayHandle,
  handlers: Map<number, CreateTrayMenuClickHandler[]>
): (() => void) => {
  if (handlers.size === 0) {
    return noop;
  }
  return tray.onMenuClick((event) => {
    for (const handler of handlers.get(event.itemId) ?? []) {
      handler(event);
    }
  });
};

const noop = (): void => {};

interface NormalizedCreateTrayOptions {
  options: TrayOptions;
  menuHandlers: Map<number, CreateTrayMenuClickHandler[]>;
}

interface CreateTrayHandleState {
  /** Graceful supervised teardown: marks caller-initiated and closes the generation. */
  shutdown: () => Promise<void>;
  destroyPromise: Promise<void> | undefined;
  menuUnsubscribe: () => void;
}
