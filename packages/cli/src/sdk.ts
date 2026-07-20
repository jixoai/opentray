// Orthogonal intents (2026-07-19; original user request: pnpm install must be sufficient):
// 1. Expose one direct, ergonomic createTray entrypoint.
// 2. Normalize app-facing menu shorthand into the protocol model.
// 3. Make the returned handle own and deterministically close its broker session.

import type { AppIcon, Icon, Tooltip, TrayOptions } from "@opentray/spec";
import type { OpenTrayAppBundleOptions } from "@opentray/packaging";

import {
  createClient,
  type EventfulTrayHandle,
  type TrayExtension,
} from "./client";
import { connectLocalBroker } from "./local-broker";
import {
  normalizeCreateTrayMenu,
  type CreateTrayMenu,
  type CreateTrayMenuClickHandler,
} from "./menu-input";
import { normalizeAppIcon, validateAppIcon } from "./app-icon";

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
  autoStart?: boolean;
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
  const connection = await connectLocalBroker({
    ...runtimeOptions,
    ...(appIcon === undefined ? {} : { appIcon }),
  });
  try {
    const tray = await createClient(connection, {
      appOptions: {
        ...(runtimeOptions.appName === undefined
          ? {}
          : { name: runtimeOptions.appName }),
        ...(appIcon === undefined ? {} : { appIcon }),
      },
    }).createTray(normalized.options);
    return wrapCreateTrayHandle(tray, {
      closeConnection: () => connection.close(),
      destroyPromise: undefined,
      menuUnsubscribe: bindMenuClickHandlers(tray, normalized.menuHandlers),
    });
  } catch (error) {
    await connection.close().catch(noop);
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
        try {
          await tray.destroy();
        } finally {
          await state.closeConnection();
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
  closeConnection: () => Promise<void>;
  destroyPromise: Promise<void> | undefined;
  menuUnsubscribe: () => void;
}
