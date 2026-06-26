import { describe, expect, it } from "vitest";

import { resolveDaemonPaths } from "./paths";

describe("daemon paths", () => {
  it("resolves caller-scoped runtime metadata", () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-home",
      packageVersion: "0.1.0",
      callerLabel: "myapp",
      platform: "darwin",
    });

    expect(paths.callerLabel).toBe("myapp");
    expect(paths.appId).toBe("myapp");
    expect(paths.appName).toBe("myapp");
    expect(paths.runtimeDir).toBe(
      "/tmp/opentray-home/.opentray/0.1.0/myapp/runtime"
    );
    expect(paths.pidFile).toBe(
      "/tmp/opentray-home/.opentray/0.1.0/myapp/runtime/broker.pid"
    );
    expect(paths.lockFile).toBe(
      "/tmp/opentray-home/.opentray/0.1.0/myapp/runtime/broker.lock"
    );
    expect(paths.endpoint).toBe(
      "/tmp/opentray-home/.opentray/0.1.0/myapp/opentray-p1.sock"
    );
  });

  it("falls back to the neutral caller label when none is provided", () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-home",
      packageVersion: "0.1.0",
      platform: "darwin",
    });

    expect(paths.callerLabel).toBe("opentray");
    expect(paths.appId).toBe("opentray");
    expect(paths.appName).toBe("opentray");
    expect(paths.runtimeDir).toBe(
      "/tmp/opentray-home/.opentray/0.1.0/opentray/runtime"
    );
    expect(paths.endpoint).toBe(
      "/tmp/opentray-home/.opentray/0.1.0/opentray/opentray-p1.sock"
    );
  });

  it("isolates two callers of the same version to distinct endpoints", () => {
    const myapp = resolveDaemonPaths({
      homeDir: "/tmp/opentray-home",
      packageVersion: "0.1.0",
      callerLabel: "myapp",
      platform: "darwin",
    });
    const cliTool = resolveDaemonPaths({
      homeDir: "/tmp/opentray-home",
      packageVersion: "0.1.0",
      callerLabel: "cli-tool",
      platform: "darwin",
    });

    expect(myapp.endpoint).not.toBe(cliTool.endpoint);
    expect(myapp.runtimeDir).not.toBe(cliTool.runtimeDir);
  });

  it("keeps Windows named pipes versioned and caller-scoped", () => {
    const paths = resolveDaemonPaths({
      homeDir: "C:/Users/example",
      packageVersion: "0.2.0",
      callerLabel: "myapp",
      platform: "win32",
    });

    expect(paths.runtimeDir).toBe(
      "C:/Users/example/.opentray/0.2.0/myapp/runtime"
    );
    expect(paths.endpoint).toBe("\\\\.\\pipe\\opentray-0.2.0-p1-myapp");
  });

  it("preserves explicit app identity separately from caller label", () => {
    const paths = resolveDaemonPaths({
      homeDir: "/tmp/opentray-home",
      packageVersion: "0.1.0",
      callerLabel: "build-tool",
      appId: "com.example.build",
      appName: "Example Build",
      platform: "darwin",
    });

    expect(paths.callerLabel).toBe("build-tool");
    expect(paths.appId).toBe("com.example.build");
    expect(paths.appName).toBe("Example Build");
    expect(paths.endpoint).toBe(
      "/tmp/opentray-home/.opentray/0.1.0/build-tool/opentray-p1.sock"
    );
  });
});
