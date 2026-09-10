import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBJECT_SETTINGS,
  postProcessSubject,
  type SubjectExtractionSettings,
  type SubjectPixels,
} from "./subject-extraction";

/** 4×4 RGBA with per-pixel alpha driven by a label grid (0 = transparent). */
const imageOf = (alphaGrid: readonly number[]): SubjectPixels => {
  const data = new Uint8ClampedArray(alphaGrid.length * 4);
  alphaGrid.forEach((alpha, i) => {
    data[i * 4] = 200;
    data[i * 4 + 1] = 100;
    data[i * 4 + 2] = 50;
    data[i * 4 + 3] = alpha;
  });
  return { data, width: 4, height: 4 };
};
const alphasOf = (image: SubjectPixels): readonly number[] =>
  Array.from({ length: image.data.length / 4 }, (_, i) => image.data[i * 4 + 3] ?? 0);

describe("postProcessSubject (subject extraction knobs)", () => {
  it("default settings are a no-op pass-through", () => {
    const image = imageOf([0, 10, 200, 255, 255, 200, 10, 0, 0, 10, 200, 255, 255, 200, 10, 0]);
    expect(postProcessSubject(image, DEFAULT_SUBJECT_SETTINGS)).toBe(image);
  });

  it("alpha threshold zeroes faint residue and keeps solid pixels", () => {
    const settings: SubjectExtractionSettings = { ...DEFAULT_SUBJECT_SETTINGS, alphaThreshold: 64 };
    const result = postProcessSubject(
      imageOf([0, 10, 63, 64, 65, 127, 200, 255, 255, 200, 127, 65, 64, 63, 10, 0]),
      settings,
    );
    expect(alphasOf(result)).toEqual([0, 0, 0, 64, 65, 127, 200, 255, 255, 200, 127, 65, 64, 0, 0, 0]);
  });

  it("shrink erodes the subject edge one pixel per step", () => {
    // A centered 2×2 opaque block.
    const block = [0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0];
    const oneStep = postProcessSubject(imageOf(block), {
      ...DEFAULT_SUBJECT_SETTINGS,
      shrink: 1,
    });
    expect(alphasOf(oneStep)).toEqual(new Array(16).fill(0));
    // Shrink does not grow: an all-opaque image only loses its border.
    const full = new Array(16).fill(255);
    const bordered = postProcessSubject(imageOf(full), {
      ...DEFAULT_SUBJECT_SETTINGS,
      shrink: 1,
    });
    expect(alphasOf(bordered)).toEqual([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0]);
  });
});
