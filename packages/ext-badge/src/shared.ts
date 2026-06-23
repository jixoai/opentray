export type BadgeCapabilityLevel = "native" | "reduced" | "unsupported";

export type BadgePlatform = "darwin" | "win32" | "linux";

export interface BadgeState {
  badgeText: string;
  badgeCount: number | null;
  progressValue: number;
  progressMax: number;
  progressState: "none" | "indeterminate" | "normal" | "paused" | "error";
  overlayIcon: "none" | "dot" | "alert";
  attention: boolean;
}

export interface BadgeCapabilityFamily {
  badgeText: BadgeCapabilityLevel;
  progress: BadgeCapabilityLevel;
  overlayIcon: BadgeCapabilityLevel;
  attention: BadgeCapabilityLevel;
}

export interface BadgeCapabilities {
  platform: BadgePlatform;
  mode: "native" | "reduced" | "unsupported";
  capabilities: BadgeCapabilityFamily;
  state: BadgeState;
  reason?: string;
}

export type BadgeCommand =
  | { type: "getCapabilities" }
  | { type: "setBadge"; value: string }
  | { type: "clearBadge" }
  | { type: "setProgress"; value: number; max?: number }
  | { type: "setProgressState"; value: BadgeState["progressState"] }
  | { type: "setOverlayIcon"; value: BadgeState["overlayIcon"] }
  | { type: "setAttention"; value: boolean }
  | { type: "showPanel" }
  | { type: "hidePanel" }
  | { type: "reset" }
  ;

export type BadgeEvent =
  | { type: "capabilities"; snapshot: BadgeCapabilities }
  | { type: "state"; snapshot: BadgeCapabilities }
  | { type: "result"; op: string; ok: true; snapshot: BadgeCapabilities }
  | { type: "result"; op: string; ok: false; error: string; snapshot: BadgeCapabilities };

export interface BadgeHandle {
  getCapabilities(): Promise<BadgeCapabilities>;
  setBadge(value: string): Promise<BadgeCapabilities>;
  clearBadge(): Promise<BadgeCapabilities>;
  setProgress(value: number, max?: number): Promise<BadgeCapabilities>;
  setProgressState(value: BadgeState["progressState"]): Promise<BadgeCapabilities>;
  setOverlayIcon(value: BadgeState["overlayIcon"]): Promise<BadgeCapabilities>;
  setAttention(value: boolean): Promise<BadgeCapabilities>;
  showPanel(): Promise<BadgeCapabilities>;
  hidePanel(): Promise<BadgeCapabilities>;
  reset(): Promise<BadgeCapabilities>;
}

export interface BadgePanelEnvelope {
  platform: BadgePlatform;
  mode: "native" | "reduced" | "unsupported";
  capabilities: BadgeCapabilityFamily;
  state: BadgeState;
  log: string[];
  reason?: string;
}

export const defaultBadgeState = (): BadgeState => ({
  badgeText: "12",
  badgeCount: 12,
  progressValue: 0,
  progressMax: 100,
  progressState: "none",
  overlayIcon: "dot",
  attention: false,
});

export const defaultBadgeCapabilities = (platform: BadgePlatform): BadgeCapabilities => {
  const common = {
    badgeText: "reduced",
    progress: "unsupported",
    overlayIcon: "reduced",
    attention: "reduced",
  } satisfies BadgeCapabilityFamily;
  return {
    platform,
    mode: "reduced",
    capabilities: common,
    state: defaultBadgeState(),
    reason: "badge projection is currently reduced to a local proof surface",
  };
};

export const normalizeProgress = (value: number, max?: number): { value: number; max: number } => {
  const normalizedMax = Number.isFinite(max ?? 100) ? Math.max(1, Math.round(max ?? 100)) : 100;
  const normalizedValue = Number.isFinite(value) ? Math.max(0, Math.min(normalizedMax, Math.round(value))) : 0;
  return { value: normalizedValue, max: normalizedMax };
};

export const normalizeBadgeText = (value: string): { badgeText: string; badgeCount: number | null } => {
  const badgeText = value.trim();
  const parsed = Number.parseInt(badgeText, 10);
  return {
    badgeText,
    badgeCount: Number.isFinite(parsed) ? parsed : null,
  };
};

export const badgePanelEnvelopeFromCapabilities = (
  snapshot: BadgeCapabilities,
): BadgePanelEnvelope => ({
  platform: snapshot.platform,
  mode: snapshot.mode,
  capabilities: snapshot.capabilities,
  state: snapshot.state,
  log: [],
  ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }),
});
