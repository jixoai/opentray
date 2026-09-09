// Thin shell over the shared icon kernel (shared-icon-kernel change,
// 2026-09): generation, composition, glyph defaults, and platform encoders
// live in @opentray/icon — one implementation shared with create-opentray and
// the runtime daemon. This module keeps the historical public surface of the
// Vite adapter (openTrayAppIconPlugin plus re-exports) and contributes only
// the Vite lifecycle glue.

import path from "node:path";

import type { Plugin } from "vite";

import {
  generateOpenTrayAppIcon,
  type OpenTrayAppIconCacheMetadata,
  type OpenTrayAppIconOptions,
} from "@opentray/icon";

export type {
  OpenTrayAppIconCacheMetadata,
  OpenTrayAppIconManifest,
  OpenTrayAppIconOptions,
} from "@opentray/icon";

export { generateOpenTrayAppIcon };

export interface OpenTrayAppIconPluginOptions {
  /** Brand source image. This is intentionally explicit so the plugin is app-agnostic. */
  readonly sourcePath: string;
  /**
   * Pre-composed source: the image already carries its background and
   * squircle mask, so glyph re-tiling (trim → symbol → white tile) is
   * skipped and the pixels pass through verbatim.
   */
  readonly composed?: boolean;
  /**
   * Separate macOS content source (e.g. the best-practice 824-in-1024
   * variant): ICNS encodes from this while ICO/Linux use sourcePath.
   */
  readonly macosSourcePath?: string;
  readonly outputPath?: string;
  readonly icnsOutputPath?: string;
  readonly icoOutputPath?: string;
  readonly linuxOutputDirectory?: string;
  readonly manifestOutputPath?: string;
  readonly cachePath?: string;
}

/** Create the Vite plugin used by both serve and build modes. */
export function openTrayAppIconPlugin(
  options: OpenTrayAppIconPluginOptions
): Plugin {
  let generation: Promise<OpenTrayAppIconCacheMetadata> | undefined;

  return {
    name: "opentray/app-icon",
    enforce: "pre",
    async configResolved(config) {
      const outputPath =
        options.outputPath ??
        path.resolve(config.root, "static/icons/app-icon.png");
      const icnsOutputPath =
        options.icnsOutputPath ??
        path.resolve(config.root, "static/icons/app-icon.icns");
      const icoOutputPath =
        options.icoOutputPath ??
        path.resolve(config.root, "static/icons/app-icon.ico");
      const linuxOutputDirectory =
        options.linuxOutputDirectory ??
        path.resolve(config.root, "static/icons/linux");
      const manifestOutputPath =
        options.manifestOutputPath ??
        path.resolve(config.root, "static/icons/app-icon.json");
      const cachePath =
        options.cachePath ?? path.resolve(config.root, ".cache/app-icon.json");
      generation ??= generateOpenTrayAppIcon({
        sourcePath: path.resolve(options.sourcePath),
        ...(options.composed === true ? { composed: true } : {}),
        ...(options.macosSourcePath === undefined
          ? {}
          : { macosSourcePath: path.resolve(options.macosSourcePath) }),
        outputPath,
        icnsOutputPath,
        icoOutputPath,
        linuxOutputDirectory,
        manifestOutputPath,
        cachePath,
      });
      await generation;
    },
  };
}
