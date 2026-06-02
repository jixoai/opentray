import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveLynxBundlePath } from "./daemon-lynx";

describe("daemon lynx smoke helpers", () => {
  afterEach(() => {
    delete process.env.INIT_CWD;
  });

  it("resolves bundle paths relative to the original shell cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "opentray-lynx-bundle-"));
    try {
      const bundle = join(dir, "main.lynx.bundle");
      writeFileSync(bundle, "bundle-bytes");
      process.env.INIT_CWD = dir;

      expect(resolveLynxBundlePath("./main.lynx.bundle")).toBe(realpathSync(bundle));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
