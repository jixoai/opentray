import { describe, expect, it } from "vitest";

import {
  createPortDiscovery,
  parseLsofPorts,
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

describe("serviceUrl", () => {
  it("formats the loopback service URL", () => {
    expect(serviceUrl(19080)).toBe("http://127.0.0.1:19080");
  });
});
