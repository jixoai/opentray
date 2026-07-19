// Orthogonal intents (2026-07-19; original user request: appIcon follows native identity rules):
// 1. Decide whether an Icon contains native-capable application artwork for this platform.
// 2. Reject menu-bar template/text-only icons at the App identity boundary.

import type { Icon, IconImage } from "@opentray/spec";

export class InvalidAppIconError extends Error {
  readonly code = "OPENTRAY_INVALID_APP_ICON";

  constructor(platform: NodeJS.Platform) {
    super(
      `appIcon does not contain native-capable application artwork for ${platform}`,
    );
    this.name = "InvalidAppIconError";
  }
}

/** Returns whether an icon can serve as native application artwork on the selected platform. */
export const isNativeCapableAppIcon = (
  icon: Icon,
  platform: NodeJS.Platform = process.platform,
): boolean => selectNativeAppImage(icon, platform) !== undefined;

const selectNativeAppImage = (
  icon: Icon,
  platform: NodeJS.Platform,
): IconImage | undefined => {
  const generic = [icon["icon-only"], icon["icon-text"], rootImage(icon)];
  if (platform === "darwin") {
    return firstImage([
      icon["darwin-icon-only"]?.isTemplate === true
        ? undefined
        : icon["darwin-icon-only"],
      ...generic,
      icon["darwin-icon-text"]?.isTemplate === true
        ? undefined
        : icon["darwin-icon-text"],
    ]);
  }
  if (platform === "win32") {
    return firstImage([
      icon["win32-icon-only"],
      ...generic,
      icon["win32-icon-text"],
    ]);
  }
  if (platform === "linux") {
    return firstImage([
      icon["linux-icon-only"],
      ...generic,
      icon["linux-icon-text"],
    ]);
  }
  return firstImage(generic);
};

const rootImage = (icon: Icon): IconImage | undefined => {
  switch (icon.type) {
    case "rgba": {
      if (
        icon.data === undefined ||
        icon.width === undefined ||
        icon.height === undefined
      ) {
        return undefined;
      }
      return {
        type: icon.type,
        data: icon.data,
        width: icon.width,
        height: icon.height,
      };
    }
    case "encoded":
      if (icon.data === undefined) return undefined;
      return { type: icon.type, data: icon.data };
    case "file":
      if (icon.path === undefined) return undefined;
      return { type: icon.type, path: icon.path };
    case undefined:
      return undefined;
  }
};

const firstImage = (
  candidates: readonly (IconImage | undefined)[],
): IconImage | undefined =>
  candidates.find((candidate) => candidate !== undefined);
