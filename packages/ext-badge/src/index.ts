import type { ExtensionEnvelope } from "@opentray/spec";
import type { NativeExtensionArtifact, TrayHandle } from "opentray";

import { BADGE_NATIVE_ARTIFACT } from "./native-artifact";

import {
  badgePanelEnvelopeFromCapabilities,
  defaultBadgeCapabilities,
  normalizeBadgeText,
  normalizeProgress,
  type BadgeCapabilities,
  type BadgeCapabilityFamily,
  type BadgeEvent,
  type BadgeHandle,
  type BadgePanelEnvelope,
  type BadgePlatform,
  type BadgeState,
} from "./shared";

export type * from "./shared";
export { badgePanelEnvelopeFromCapabilities } from "./shared";

const BADGE_EXTENSION_NAME = "badge";
export interface BadgeExtensionOptions {
  mountId?: string;
  artifact?: NativeExtensionArtifact;
  platform?: BadgePlatform;
}

export interface BadgeExtensionCapability extends BadgeHandle {
  readonly platform: BadgePlatform;
  readonly getPanelEnvelope: () => Promise<BadgePanelEnvelope>;
}

export const attachBadge = (tray: TrayHandle, options: BadgeExtensionOptions = {}): BadgeExtensionCapability => {
  const platform = options.platform ?? process.platform as BadgePlatform;
  const extension = tray.extend(BadgeExt, options);
  return {
    ...extension,
    platform,
    getPanelEnvelope: async () => badgePanelEnvelopeFromCapabilities(await extension.getCapabilities()),
  };
};

export const BadgeExt = {
  name: BADGE_EXTENSION_NAME,
  artifact: BADGE_NATIVE_ARTIFACT,
  resolveMount(options: BadgeExtensionOptions | undefined) {
    return {
      ...(options?.mountId === undefined ? {} : { mountId: options.mountId }),
      ...(options?.artifact === undefined ? {} : { artifact: options.artifact }),
    };
  },
  extend(tray: TrayHandle, context, options: BadgeExtensionOptions | undefined): BadgeHandle {
    const requestedPlatform = options?.platform ?? (process.platform as BadgePlatform);
    const snapshot = defaultBadgeCapabilities(requestedPlatform);
    return createBadgeHandle(() => context.ensureLoaded(), tray, context.mountId, snapshot);
  },
} satisfies import("opentray").TrayExtension<BadgeHandle, BadgeExtensionOptions>;

export const isBadgeEvent = (event: ExtensionEnvelope): event is ExtensionEnvelope<BadgeEvent> =>
  event.scope.ext === BADGE_EXTENSION_NAME &&
  typeof event.data === "object" &&
  event.data !== null &&
  "type" in event.data;

function createBadgeHandle(
  ensureLoaded: () => Promise<void>,
  tray: TrayHandle,
  mountId: string,
  seed: BadgeCapabilities,
): BadgeHandle {
  const state: BadgeState = structuredClone(seed.state);
  const capabilities: BadgeCapabilityFamily = { ...seed.capabilities };
  const platform = seed.platform;
  const mode = seed.mode;
  const reason = seed.reason;

  const snapshot = (): BadgeCapabilities => ({
    platform,
    mode,
    capabilities: { ...capabilities },
    state: structuredClone(state),
    ...(reason === undefined ? {} : { reason }),
  });

  const rejectUnsupported = (family: keyof BadgeCapabilityFamily, op: string): never => {
    const support = capabilities[family];
    throw new Error(`${op} is ${support} on ${platform}`);
  };

  return {
    getCapabilities: async () => {
      await ensureLoaded();
      await tray.requestExtension(mountId, { type: "getCapabilities" });
      return snapshot();
    },
    setBadge: async (value: string) => {
      await ensureLoaded();
      const normalized = normalizeBadgeText(value);
      state.badgeText = normalized.badgeText;
      state.badgeCount = normalized.badgeCount;
      await tray.commandExtension(mountId, { type: "setBadge", value: normalized.badgeText });
      return snapshot();
    },
    clearBadge: async () => {
      await ensureLoaded();
      state.badgeText = "";
      state.badgeCount = null;
      await tray.commandExtension(mountId, { type: "clearBadge" });
      return snapshot();
    },
    setProgress: async (value: number, max?: number) => {
      await ensureLoaded();
      if (capabilities.progress === "unsupported") {
        rejectUnsupported("progress", "setProgress");
      }
      const normalized = normalizeProgress(value, max);
      state.progressValue = normalized.value;
      state.progressMax = normalized.max;
      await tray.commandExtension(mountId, { type: "setProgress", value: normalized.value, max: normalized.max });
      return snapshot();
    },
    setProgressState: async (value: BadgeState["progressState"]) => {
      await ensureLoaded();
      if (capabilities.progress === "unsupported") {
        rejectUnsupported("progress", "setProgressState");
      }
      state.progressState = value;
      await tray.commandExtension(mountId, { type: "setProgressState", value });
      return snapshot();
    },
    setOverlayIcon: async (value: BadgeState["overlayIcon"]) => {
      await ensureLoaded();
      state.overlayIcon = value;
      await tray.commandExtension(mountId, { type: "setOverlayIcon", value });
      return snapshot();
    },
    setAttention: async (value: boolean) => {
      await ensureLoaded();
      state.attention = Boolean(value);
      await tray.commandExtension(mountId, { type: "setAttention", value: Boolean(value) });
      return snapshot();
    },
    showPanel: async () => {
      await ensureLoaded();
      await tray.commandExtension(mountId, { type: "showPanel" });
      return snapshot();
    },
    hidePanel: async () => {
      await ensureLoaded();
      await tray.commandExtension(mountId, { type: "hidePanel" });
      return snapshot();
    },
    reset: async () => {
      await ensureLoaded();
      Object.assign(state, seed.state);
      await tray.commandExtension(mountId, { type: "reset" });
      return snapshot();
    },
  };
}
