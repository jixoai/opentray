import { describe, expect, it } from "vitest";

import {
  collectProcessTreePids,
  createPortDiscovery,
  parseLsofPortOwners,
  parseLsofPorts,
  parseNetstatPortOwners,
  parseNetstatPorts,
  parsePowerShellPorts,
  serviceUrl,
} from "./port-scan";

describe("parseLsofPorts", () => {
  it("extracts LISTEN ports from lsof -F Pn output", () => {
    const stdout = [
      "p1234",
      "Ptcp",
      "n*:19080",
      "p1235",
      "Ptcp",
      "n127.0.0.1:5173",
      "p1236",
      "Ptcp6",
      "n[::1]:9000",
    ].join("\n");
    expect(new Set(parseLsofPorts(stdout))).toEqual(new Set([19080, 5173, 9000]));
  });

  it("ignores non-address lines", () => {
    expect(parseLsofPorts("p1\nPtcp\nf12")).toEqual(new Set());
  });
});

describe("parseNetstatPorts", () => {
  it("keeps LISTENING rows only", () => {
    const stdout = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State",
      "  TCP    127.0.0.1:19080        0.0.0.0:0              LISTENING       1234",
      "  TCP    127.0.0.1:19081        10.0.0.1:443           ESTABLISHED     1234",
    ].join("\n");
    expect(parseNetstatPorts(stdout)).toEqual(new Set([19080]));
  });
});

describe("parsePowerShellPorts", () => {
  it("parses one port per line", () => {
    expect(parsePowerShellPorts("19080\n19081\n\n")).toEqual(new Set([19080, 19081]));
  });
});

describe("createPortDiscovery", () => {
  it("lists only new HTTP-verified ports in first-seen order", async () => {
    const listenersSequence: ReadonlySet<number>[] = [
      new Set([80, 19080]),
      new Set([80, 19080, 19081]),
      new Set([80, 19080, 19081]),
    ];
    let call = 0;
    const discovery = createPortDiscovery({
      baseline: new Set([80]),
      listListeners: async () => listenersSequence[Math.min(call++, 2)]!,
      verifyHttp: async (port) => port === 19080 || port === 19081,
    });

    const first = await discovery.poll();
    expect(first.map((service) => service.port)).toEqual([19080]);

    const second = await discovery.poll();
    expect(second.map((service) => service.port)).toEqual([19080, 19081]);
    expect(discovery.services().map((service) => service.port)).toEqual([19080, 19081]);
  });

  it("excludes ports that fail HTTP verification", async () => {
    const discovery = createPortDiscovery({
      baseline: new Set(),
      listListeners: async () => new Set([19080, 19082]),
      verifyHttp: async (port) => port === 19080,
    });
    const found = await discovery.poll();
    expect(found.map((service) => service.port)).toEqual([19080]);
  });

  it("stops returning services after stop()", async () => {
    const discovery = createPortDiscovery({
      baseline: new Set(),
      listListeners: async () => new Set([19080]),
      verifyHttp: async () => true,
    });
    discovery.stop();
    expect(await discovery.poll()).toEqual([]);
  });
});

describe("listener ownership parsing", () => {
  it("maps lsof -F pPn output to port owners", () => {
    const stdout = [
      "p1234",
      "Ptcp",
      "n*:19080",
      "p99",
      "Ptcp",
      "n127.0.0.1:5173",
      "p1235",
      "Ptcp",
      "n*:19080",
    ].join("\n");
    const owners = parseLsofPortOwners(stdout);
    expect(owners.get(19080)).toEqual(new Set([1234, 1235]));
    expect(owners.get(5173)).toEqual(new Set([99]));
  });

  it("maps netstat -ano LISTENING rows to port owners", () => {
    const stdout = [
      "  TCP    127.0.0.1:19080        0.0.0.0:0              LISTENING       4321",
      "  TCP    127.0.0.1:19081        0.0.0.0:0              LISTENING       777",
    ].join("\n");
    const owners = parseNetstatPortOwners(stdout);
    expect(owners.get(19080)).toEqual(new Set([4321]));
    expect(owners.get(19081)).toEqual(new Set([777]));
  });
});

describe("ownership-filtered discovery", () => {
  it("adopts only ports owned by the preview process tree", async () => {
    const owners = new Map<number, ReadonlySet<number>>([
      [19080, new Set([111])],
      [5173, new Set([999])], // foreign listener (e.g. browser DevTools)
      [19081, new Set([222])], // child of the preview process
    ]);
    const discovery = createPortDiscovery({
      baseline: new Set(),
      listListeners: async () => new Set([19080, 5173, 19081]),
      listOwners: async () => owners,
      resolveOwnerPids: async () => new Set([111, 222]),
      verifyHttp: async () => true,
    });
    const found = await discovery.poll();
    expect(found.map((service) => service.port).sort()).toEqual([19080, 19081]);
  });

  it("keeps all ports when no ownership resolver is provided", async () => {
    const discovery = createPortDiscovery({
      baseline: new Set(),
      listListeners: async () => new Set([19080, 5173]),
      verifyHttp: async () => true,
    });
    const found = await discovery.poll();
    expect(found.map((service) => service.port).sort()).toEqual([19080, 5173]);
  });
});

describe("collectProcessTreePids", () => {
  it("walks children via pgrep on POSIX", async () => {
    const pgrepOutputs = new Map<number, string>([
      [10, "11\n12\n"],
      [12, "13\n"],
    ]);
    const { execFile } = await import("node:child_process");
    const originalExecFile = execFile;
    void originalExecFile;
    const tree = await collectProcessTreePids(10, "darwin", {
      runCapture: async (command, args) => {
        if (command !== "pgrep") {
          throw new Error(`unexpected command: ${command}`);
        }
        const parent = Number.parseInt(args[1] ?? "", 10);
        const output = pgrepOutputs.get(parent);
        if (output === undefined) {
          throw new Error("no children");
        }
        return output;
      },
    });
    expect([...tree].sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
  });
});

describe("serviceUrl", () => {
  it("formats the loopback service URL", () => {
    expect(serviceUrl(19080)).toBe("http://127.0.0.1:19080");
  });
});
