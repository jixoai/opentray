import { describe, expect, it } from "vitest";

import { resolveProcessExecutablePath } from "./process-identity";

describe("process identity", () => {
  it("resolves the live executable for the current process", async () => {
    const resolved = await resolveProcessExecutablePath(process.pid);

    expect(resolved).toBeDefined();
    expect(resolved).toMatch(/^(?:[A-Za-z]:[\\/]|\/)/u);
  });

  it("returns undefined for a PID that cannot be resolved", async () => {
    await expect(resolveProcessExecutablePath(2_147_483_647)).resolves.toBeUndefined();
  });
});
