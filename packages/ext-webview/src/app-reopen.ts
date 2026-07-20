// Orthogonal intents (2026-07-21; original user request: a running app-mode
// Dock click must restore and focus the most recently active retained window):
// 1. Keep app-mode window recency in the WebView extension, not in Core.
// 2. Coalesce one native reopen intent across multiple tray/extension mounts.
// 3. Compose reveal and focus without invoking the cold app launch descriptor.

export interface AppReopenWindowTarget {
  toVisible(): Promise<void>;
  focus(): Promise<void>;
}

export interface AppReopenWindowRegistration {
  setAppMode(appMode: boolean): void;
  setBootstrapped(bootstrapped: boolean): void;
  markActive(): void;
}

interface RegisteredWindow extends AppReopenWindowTarget {
  appMode: boolean;
  bootstrapped: boolean;
  lastActive: number;
}

export interface AppReopenCoordinator {
  register(target: AppReopenWindowTarget): AppReopenWindowRegistration;
  reopen(): Promise<boolean>;
}

const coordinators = new Map<string, AppReopenCoordinator>();

export const getAppReopenCoordinator = (appId: string): AppReopenCoordinator => {
  const existing = coordinators.get(appId);
  if (existing !== undefined) {
    return existing;
  }
  const coordinator = createAppReopenCoordinator();
  coordinators.set(appId, coordinator);
  return coordinator;
};

const createAppReopenCoordinator = (): AppReopenCoordinator => {
  const windows = new Set<RegisteredWindow>();
  let sequence = 0;
  let pending: Promise<boolean> | undefined;

  const reopen = (): Promise<boolean> => {
    if (pending !== undefined) {
      return pending;
    }
    const operation = reopenMostRecent(windows).finally(() => {
      if (pending === operation) {
        pending = undefined;
      }
    });
    pending = operation;
    return operation;
  };

  return {
    register(target) {
      const entry: RegisteredWindow = {
        ...target,
        appMode: false,
        bootstrapped: false,
        lastActive: 0,
      };
      windows.add(entry);
      return {
        setAppMode(appMode) {
          entry.appMode = appMode;
        },
        setBootstrapped(bootstrapped) {
          entry.bootstrapped = bootstrapped;
        },
        markActive() {
          entry.lastActive = ++sequence;
        },
      };
    },
    reopen,
  };
};

const reopenMostRecent = async (
  windows: ReadonlySet<RegisteredWindow>
): Promise<boolean> => {
  const candidates = [...windows]
    .filter((window) => window.appMode && window.bootstrapped)
    .sort((left, right) => right.lastActive - left.lastActive);
  if (candidates.length === 0) {
    return false;
  }

  const errors: unknown[] = [];
  for (const candidate of candidates) {
    try {
      await candidate.toVisible();
      await candidate.focus();
      return true;
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  throw new AggregateError(errors, "no retained app-mode WebView could be reopened");
};
