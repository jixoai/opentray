import { describe, expect, it } from "vitest";

import {
  collectProcessTreePids,
  createPortDiscovery,
  parseLsofPortOwners,
  parseLsofPorts,
  parseNetTcpConnectionJson,
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

describe("locale-independent netstat parsing", () => {
  it("keeps listeners on localized (non-English) state words", () => {
    // German Windows prints ABHÖREN; the discriminator is the remote port 0.
    const german = [
      "Aktive Verbindungen",
      "",
      "  Proto  Lokale Adresse         Remoteadresse          Status",
      "  TCP    127.0.0.1:19080        0.0.0.0:0              ABHÖREN         1234",
      "  TCP    127.0.0.1:19081        10.0.0.1:443           HERGESTELLT     1234",
    ].join("\n");
    expect(parseNetstatPorts(german)).toEqual(new Set([19080]));
  });

  it("handles IPv6 [::]:port locals and unspecified remotes", () => {
    const ipv6 = [
      "  TCP    [::]:3000              [::]:0                 LISTENING       900",
      "  TCP    [::1]:3001             [::]:0                 LISTENING       901",
    ].join("\n");
    expect(parseNetstatPorts(ipv6)).toEqual(new Set([3000, 3001]));
  });
});

describe("parseNetTcpConnectionJson (Get-NetTCPConnection)", () => {
  it("parses a single object row", () => {
    const json = JSON.stringify({ LocalPort: 4173, OwningProcess: 4242 });
    const owners = parseNetTcpConnectionJson(json);
    expect(owners.get(4173)).toEqual(new Set([4242]));
  });

  it("parses an array and merges multiple owners per port", () => {
    const json = JSON.stringify([
      { LocalPort: 80, OwningProcess: 4 },
      { LocalPort: 8080, OwningProcess: 900 },
      { LocalPort: 8080, OwningProcess: 901 },
    ]);
    const owners = parseNetTcpConnectionJson(json);
    expect(owners.get(80)).toEqual(new Set([4]));
    expect(owners.get(8080)).toEqual(new Set([900, 901]));
  });

  it("returns empty on malformed output", () => {
    expect(parseNetTcpConnectionJson("not json").size).toBe(0);
    expect(parseNetTcpConnectionJson("").size).toBe(0);
  });
});

describe("collectProcessTreePids on Windows", () => {
  it("walks the Win32_Process PPid BFS output (cmd.exe -> npm -> node)", () => {
    const fakePowershell = async (
      _cmd: string,
      args: readonly string[],
    ): Promise<string> => {
      const script = args.join(" ");
      if (script.includes("Win32_Process")) {
        return "700 701 702"; // cmd.exe -> npm -> node descendants
      }
      throw new Error("unexpected call");
    };
    void collectProcessTreePids(700, "win32", { runCapture: fakePowershell }).then(
      (tree) => {
        expect(tree).toEqual(new Set([700, 701, 702]));
      },
    );
  });
});
