import { describe, expect, it } from "vitest";

import { resolveDaemonPaths } from "./paths";

describe("daemon paths", () => {
  it("resolves version-scoped runtime metadata", () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-home",
      packageVersion: "0.1.0",
      platform: "darwin",
    });

    expect(paths.runtimeDir).toBe("/tmp/opentray-home/.opentray/0.1.0/runtime");
    expect(paths.pidFile).toBe("/tmp/opentray-home/.opentray/0.1.0/runtime/broker.pid");
    expect(paths.lockFile).toBe("/tmp/opentray-home/.opentray/0.1.0/runtime/broker.lock");
    expect(paths.endpoint).toBe("/tmp/opentray-home/.opentray/0.1.0/opentray-p1.sock");
  });

  it("keeps Windows named pipes versioned without using filesystem state roots", () => {
    const paths = resolveDaemonPaths({
      homeDir: "C:/Users/example",
      packageVersion: "0.2.0",
      platform: "win32",
    });

    expect(paths.runtimeDir).toBe("C:/Users/example/.opentray/0.2.0/runtime");
    expect(paths.endpoint).toBe("\\\\.\\pipe\\opentray-0.2.0-p1");
  });
});
