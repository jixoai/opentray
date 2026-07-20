// Orthogonal intents (2026-07-20; original user request: appIcon follows strict
// operating-system application icon standards):
// 1. Prove each declared native format against encoded bytes.
// 2. Prove platform coverage and duplicate rejection independently of the SDK.

import { resolve } from "node:path";

import type { AppIconVariantOf } from "@opentray/spec";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AppIconVariantNotFoundError,
  normalizeAppIcon,
  selectAppIconVariant,
  validateAppIcon,
} from "./app-icon";

describe("strict AppIcon validation", () => {
  it("normalizes file sources to absolute paths before broker dispatch", () => {
    const [asset] = normalizeAppIcon([
      {
        platform: "darwin",
        format: "icns",
        source: { type: "file", path: "relative/app-icon.icns" },
      },
    ]);

    expect(asset?.source).toEqual({
      type: "file",
      path: resolve("relative/app-icon.icns"),
    });
  });

  it("accepts the standard native format for each platform", async () => {
    await expect(
      validateAppIcon(
        [
          {
            platform: "darwin",
            format: "icns",
            source: { type: "encoded", data: [105, 99, 110, 115, 0, 0, 0, 8] },
          },
          {
            platform: "windows",
            format: "ico",
            source: { type: "encoded", data: [0, 0, 1, 0, 1, 0] },
          },
          {
            platform: "linux",
            format: "png",
            size: 32,
            source: {
              type: "encoded",
              data: [137, 80, 78, 71, 13, 10, 26, 10],
            },
          },
          {
            platform: "linux",
            format: "svg",
            source: {
              type: "encoded",
              data: [...new TextEncoder().encode("<svg></svg>")],
            },
          },
        ],
        "darwin"
      )
    ).resolves.toBeUndefined();
  });

  it("rejects a declared format whose bytes are another format", async () => {
    await expect(
      validateAppIcon(
        [
          {
            platform: "darwin",
            format: "icns",
            source: {
              type: "encoded",
              data: [137, 80, 78, 71, 13, 10, 26, 10],
            },
          },
        ],
        "darwin"
      )
    ).rejects.toMatchObject({ code: "OPENTRAY_INVALID_APP_ICON" });
  });

  it("rejects duplicate single-asset platforms and Linux theme sizes", async () => {
    const darwin = {
      platform: "darwin",
      format: "icns",
      source: { type: "encoded", data: [105, 99, 110, 115] },
    };
    await expect(validateAppIcon([darwin, darwin], "darwin")).rejects.toThrow(
      "duplicate darwin asset"
    );

    const linux = {
      platform: "linux",
      format: "png",
      size: 32,
      source: { type: "encoded", data: [137, 80, 78, 71, 13, 10, 26, 10] },
    };
    await expect(validateAppIcon([linux, linux], "linux")).rejects.toThrow(
      "duplicate Linux PNG size 32"
    );
  });

  it("normalizes omission to default and preserves literal alias names", async () => {
    const catalog = [
      {
        platform: "darwin",
        format: "icns",
        variant: ["default", "light"],
        source: { type: "encoded", data: [105, 99, 110, 115] },
      },
      {
        platform: "darwin",
        format: "icns",
        variant: "dark",
        source: { type: "encoded", data: [105, 99, 110, 115] },
      },
    ] as const;
    type Variant = AppIconVariantOf<typeof catalog>;
    expectTypeOf<Variant>().toEqualTypeOf<"default" | "light" | "dark">();

    await expect(validateAppIcon(catalog, "darwin")).resolves.toBeUndefined();
    expect(selectAppIconVariant(catalog, "light", "darwin")).toEqual([
      catalog[0],
    ]);
    expect(selectAppIconVariant(catalog, "dark", "darwin")).toEqual([
      catalog[1],
    ]);
    const omittedVariant = {
      platform: "darwin",
      format: "icns",
      source: catalog[0].source,
    } as const;
    expect(normalizeAppIcon([omittedVariant])).toEqual([
      { ...omittedVariant, variant: "default" },
    ]);
  });

  it("rejects incomplete or missing semantic variants", async () => {
    await expect(
      validateAppIcon(
        [
          {
            platform: "darwin",
            format: "icns",
            source: { type: "encoded", data: [105, 99, 110, 115] },
          },
          {
            platform: "windows",
            format: "ico",
            variant: "files",
            source: { type: "encoded", data: [0, 0, 1, 0, 1, 0] },
          },
        ],
        "darwin"
      )
    ).rejects.toThrow("variant files has no darwin asset");
    expect(() =>
      selectAppIconVariant(
        [
          {
            platform: "darwin",
            format: "icns",
            source: { type: "encoded", data: [105, 99, 110, 115] },
          },
        ],
        "files",
        "darwin"
      )
    ).toThrow(AppIconVariantNotFoundError);
  });

  it("rejects an explicit set without the current platform default", async () => {
    await expect(
      validateAppIcon(
        [
          {
            platform: "windows",
            format: "ico",
            source: { type: "encoded", data: [0, 0, 1, 0, 1, 0] },
          },
        ],
        "darwin"
      )
    ).rejects.toThrow("no darwin default asset was provided");
  });
});
