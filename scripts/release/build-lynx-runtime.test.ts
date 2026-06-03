import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const runtimeBuildScript = (): string =>
  readFileSync(resolve(repoRoot, "scripts/release/build-lynx-runtime.sh"), "utf8");

describe("Feature: Lynx runtime packaging path law", () => {
  test("Scenario: Given a relative output zip When the script changes directories Then the archive still lands in the caller-owned path", () => {
    const script = runtimeBuildScript();

    expect(script).toContain('caller_dir="$(pwd)"');
    expect(script).toContain('output_zip="${caller_dir}/${output_zip}"');
    expect(script).toContain('output_zip="${output_dir}/$(basename "${output_zip}")"');
    expect(script).toContain('if [[ ! -f "${output_zip}" ]]; then');
    expect(script.indexOf('output_zip="${output_dir}/$(basename "${output_zip}")"')).toBeLessThan(
      script.indexOf('cd "${lynx_dir}"'),
    );
  });
});
