import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const runtimeBuildScript = (): string =>
  readFileSync(
    resolve(repoRoot, "scripts/release/build-lynx-runtime.sh"),
    "utf8"
  );
const runtimeHostText = (relativePath: string): string =>
  readFileSync(resolve(repoRoot, "native/lynx-runtime-macos", relativePath), "utf8");

describe("Feature: Lynx runtime packaging path law", () => {
  test("Scenario: Given a relative output zip When the script changes directories Then the archive still lands in the caller-owned path", () => {
    const script = runtimeBuildScript();

    expect(script).toContain('caller_dir="$(pwd)"');
    expect(script).toContain('output_zip="${caller_dir}/${output_zip}"');
    expect(script).toContain(
      'output_zip="${output_dir}/$(basename "${output_zip}")"'
    );
    expect(script).toContain('if [[ ! -f "${output_zip}" ]]; then');
    expect(
      script.indexOf('output_zip="${output_dir}/$(basename "${output_zip}")"')
    ).toBeLessThan(script.indexOf('cd "${lynx_dir}"'));
  });

  test("Scenario: Given the runtime carrier is OpenTray-owned When the build script stages host sources Then it copies the repo-owned host tree into the ephemeral upstream checkout", () => {
    const script = runtimeBuildScript();

    expect(script).toContain(
      'runtime_host_source_dir="${root_dir}/native/lynx-runtime-macos"'
    );
    expect(script).toContain(
      'lynx_patches_dir="${root_dir}/native/lynx-patches"'
    );
    expect(script).toContain('runtime_app_name="OpenTrayLynxRuntime"');
    expect(script).toContain(
      'cp -R "${runtime_host_source_dir}" "${runtime_host_upstream_dir}"'
    );
    expect(script).toContain('git apply --whitespace=nowarn "${patch_file}"');
    expect(script).toContain("apply_opentray_lynx_patches");
    expect(script).toContain(
      'app_bundle_path="${lynx_dir}/${out_dir}/${runtime_app_name}.app"'
    );
  });

  test("Scenario: Given macOS needs a nonblank Dock identity When the runtime host is packaged Then the carrier metadata references a real repo-owned app icon", () => {
    const infoPlist = runtimeHostText("OpenTrayLynxRuntime/Info.plist");
    const buildGn = runtimeHostText("BUILD.gn");
    const iconPath = resolve(
      repoRoot,
      "native/lynx-runtime-macos/OpenTrayLynxRuntime/OpenTrayLynxRuntime.icns"
    );

    expect(infoPlist).toContain("<key>CFBundleIconFile</key>");
    expect(infoPlist).toContain("<string>OpenTrayLynxRuntime.icns</string>");
    expect(buildGn).toContain('"OpenTrayLynxRuntime/OpenTrayLynxRuntime.icns",');
    expect(existsSync(iconPath)).toBe(true);
  });

  test("Scenario: Given OpenTray owns upstream runtime law patches When native builds run Then a concrete patch file is versioned next to the runtime host sources", () => {
    const patchPath = resolve(
      repoRoot,
      "native/lynx-patches/0001-delay-desktop-mouse-scroll-until-tap-slop.patch"
    );

    expect(existsSync(patchPath)).toBe(true);
    expect(readFileSync(patchPath, "utf8")).toContain(
      "default_gesture_handler.cc"
    );
    expect(readFileSync(patchPath, "utf8")).toContain(
      "Desktop mouse input often reports a tiny move before button-up."
    );
  });
});
