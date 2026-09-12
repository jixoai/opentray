import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  canonicalJsonByteCount,
  canonicalJsonEncode,
  utf8ByteCount,
} from "./canonical-json";

interface CanonicalJsonFixture {
  name: string;
  input: unknown;
  expected: string;
}

const fixturesDir = fileURLToPath(new URL("../../../fixtures/canonical-json", import.meta.url));

const loadFixtures = (): CanonicalJsonFixture[] =>
  readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as CanonicalJsonFixture);

/**
 * Shared byte-truth suite: the same fixture files are consumed by
 * `crates/opentray-spec/src/canonical_json.rs` so the TypeScript and Rust
 * encoders are pinned to identical bytes for the same input values.
 */
describe("canonical JSON (RFC 8785) shared fixtures", () => {
  const fixtures = loadFixtures();

  it("loads the fixture directory", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  for (const fixture of fixtures) {
    it(`produces the expected bytes: ${fixture.name}`, () => {
      const result = canonicalJsonEncode(fixture.input);

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.error);
      }
      expect(result.text).toBe(fixture.expected);
      expect(result.bytes.byteLength).toBe(utf8ByteCount(fixture.expected));
      // The canonical text must itself be valid JSON parsing back to the
      // same value (JSON.stringify normalizes `-0` exactly like JCS, so the
      // round-trip comparison stays valid for the negative-zero fixture).
      expect(JSON.parse(result.text)).toEqual(JSON.parse(JSON.stringify(fixture.input)));
    });
  }
});

describe("canonical JSON (RFC 8785) unit behavior", () => {
  it("rejects values outside the RFC 8785 domain", () => {
    for (const invalid of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
      () => {},
      Symbol("x"),
      1n,
    ] as unknown[]) {
      const result = canonicalJsonEncode(invalid);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects non-finite numbers nested inside objects and arrays", () => {
    expect(canonicalJsonEncode({ a: [Number.NaN] }).ok).toBe(false);
    expect(canonicalJsonEncode({ a: { b: Number.POSITIVE_INFINITY } }).ok).toBe(false);
    expect(canonicalJsonEncode({ a: undefined }).ok).toBe(false);
  });

  it("rejects lone surrogates instead of corrupting bytes", () => {
    const loneSurrogate = String.fromCharCode(0xd800);
    expect(canonicalJsonEncode({ key: loneSurrogate }).ok).toBe(false);
  });

  it("formats ECMAScript number forms exactly", () => {
    const cases: ReadonlyArray<[number, string]> = [
      [-0, "0"],
      [0, "0"],
      [1.0, "1"],
      [4.5, "4.5"],
      [1e21, "1e+21"],
      [1e20, "100000000000000000000"],
      [1e22, "1e+22"],
      [1e-7, "1e-7"],
      [2e-3, "0.002"],
      [0.000001, "0.000001"],
      [333333333.33333329, "333333333.3333333"],
      [9007199254740991, "9007199254740991"],
      [9007199254740993, "9007199254740992"],
      [-9007199254740993, "-9007199254740992"],
      [1.0000000000000002, "1.0000000000000002"],
    ];
    for (const [value, expected] of cases) {
      expect(canonicalJsonEncode(value)).toEqual({
        ok: true,
        text: expected,
        bytes: expect.any(Uint8Array),
      });
      expect(String(value)).toBe(expected);
    }
  });

  it("sorts object keys by UTF-16 code units, not by locale or code point", () => {
    const result = canonicalJsonEncode({
      "\u20ac": 1, // U+20AC (one UTF-16 unit, 8364)
      "\ud83d\ude00": 2, // U+1F600 (surrogate pair, first unit 0xD83D = 55357)
      "\ufffd": 3, // U+FFFD (65533)
      z: 4, // 0x7A (122)
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.text).toBe('{"z":4,"€":1,"😀":2,"\ufffd":3}');
  });

  it("counts UTF-8 bytes for strings and canonical bytes for JSON values", () => {
    expect(utf8ByteCount("héllo")).toBe(6);
    expect(canonicalJsonByteCount("héllo")).toBe(8);
    expect(canonicalJsonByteCount({ b: 1, a: 2 })).toBe('{"a":2,"b":1}'.length);
    expect(() => canonicalJsonByteCount(Number.NaN)).toThrow();
  });
});
