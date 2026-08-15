// Orthogonal intents (maintained 2026-07-22; original user request: run the
// command once and discover the HTTP ports it listens on):
// 1. Snapshot listening TCP ports before spawn as the diff baseline.
// 2. Enumerate listeners per platform: lsof (macOS/Linux), netstat/PowerShell (Windows).
// 3. Verify candidates answer HTTP before listing them as services.

import { execFile } from "node:child_process";
import net from "node:net";

export interface DiscoveredService {
  readonly port: number;
  readonly url: string;
  readonly firstSeenAt: number;
  title?: string;
}

export type ListenersRunner = (platform: NodeJS.Platform) => Promise<ReadonlySet<number>>;

/** Loopback service URL for a discovered port. */
export const serviceUrl = (port: number): string => `http://127.0.0.1:${port}`;

const LOOPBACK_NO_PROXY = "localhost,127.0.0.1,::1";
/** Ensure loopback fetches bypass system proxies (same guard as source examples). */
export const ensureLoopbackNoProxy = (env: NodeJS.ProcessEnv = process.env): void => {
  const existing = env.NO_PROXY ?? env.no_proxy ?? "";
  const merged = [existing, LOOPBACK_NO_PROXY]
    .join(",")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  env.NO_PROXY = Array.from(new Set(merged)).join(",");
  env.no_proxy = env.NO_PROXY;
};

export const listListeningPorts: ListenersRunner = async (platform) => {
  if (platform === "win32") {
    return listWindowsListeningPorts();
  }
  return listLsofListeningPorts();
};

const listLsofListeningPorts = async (): Promise<ReadonlySet<number>> => {
  const stdout = await runCapture("lsof", [
    "-nP",
    "-iTCP",
    "-sTCP:LISTEN",
    "-F",
    "Pn",
  ]);
  return parseLsofPorts(stdout);
};

export const parseLsofPorts = (stdout: string): ReadonlySet<number> => {
  const ports = new Set<number>();
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("n")) {
      continue;
    }
    const hostPort = line.slice(1);
    const index = hostPort.lastIndexOf(":");
    if (index < 0) {
      continue;
    }
    const port = Number.parseInt(hostPort.slice(index + 1), 10);
    if (Number.isInteger(port) && port > 0) {
      ports.add(port);
    }
  }
  return ports;
};

const listWindowsListeningPorts = async (): Promise<ReadonlySet<number>> => {
  try {
    const stdout = await runCapture("netstat", ["-ano", "-p", "tcp"]);
    return parseNetstatPorts(stdout);
  } catch {
    const stdout = await runPowerShellTcpConnections();
    return parsePowerShellPorts(stdout);
  }
};

/** Parses `netstat -ano -p tcp` output; keeps LISTENING rows. */
export const parseNetstatPorts = (stdout: string): ReadonlySet<number> => {
  const ports = new Set<number>();
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line.toLowerCase().includes("listening")) {
      continue;
    }
    const columns = line.split(/\s+/);
    // Typical row: TCP  127.0.0.1:19080  0.0.0.0:0  LISTENING  1234
    const local = columns.find((column) => column.includes(":"));
    if (local === undefined) {
      continue;
    }
    const index = local.lastIndexOf(":");
    const port = Number.parseInt(local.slice(index + 1), 10);
    if (Number.isInteger(port) && port > 0) {
      ports.add(port);
    }
  }
  return ports;
};

const runPowerShellTcpConnections = async (): Promise<string> => {
  const script = "[Net.NetworkInformation.NetworkInformation]::GetActiveTcpConnections() | ForEach-Object { $_.LocalEndPoint.Port }";
  return await runCapture("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
};

export const parsePowerShellPorts = (stdout: string): ReadonlySet<number> => {
  const ports = new Set<number>();
  for (const line of stdout.split("\n")) {
    const port = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(port) && port > 0) {
      ports.add(port);
    }
  }
  return ports;
};

/** TCP-connect probe used by the generated app and discovery verification. */
export const waitForTcpPort = async (
  port: number,
  timeoutMs: number,
  intervalMs = 150,
  host = "127.0.0.1",
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpProbe(host, port)) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
};

export const tcpProbe = (host: string, port: number, timeoutMs = 500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result: boolean): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });

/** Verify a port answers with an HTTP response (any status counts). */
export const verifyHttpService = async (port: number, timeoutMs = 2_000): Promise<boolean> => {
  ensureLoopbackNoProxy();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(serviceUrl(port), {
      signal: controller.signal,
      redirect: "manual",
    });
    // Any HTTP answer (including 4xx/5xx and redirects) proves an HTTP service.
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export interface PortDiscoveryOptions {
  readonly platform?: NodeJS.Platform;
  readonly baseline: ReadonlySet<number>;
  readonly listListeners?: ListenersRunner;
  readonly verifyHttp?: (port: number) => Promise<boolean>;
  readonly intervalMs?: number;
}

export interface PortDiscoverySession {
  /** Known new services, first-seen order. */
  services(): readonly DiscoveredService[];
  /** One polling pass; resolves to services discovered during this pass. */
  poll(): Promise<readonly DiscoveredService[]>;
  stop(): void;
}

/**
 * Diff-based port discovery. Each poll re-enumerates listeners, keeps ports
 * absent from the baseline, and adds HTTP-verified ones in first-seen order.
 */
export const createPortDiscovery = (options: PortDiscoveryOptions): PortDiscoverySession => {
  const platform = options.platform ?? process.platform;
  const listListeners = options.listListeners ?? listListeningPorts;
  const verifyHttp = options.verifyHttp ?? verifyHttpService;
  const services = new Map<number, DiscoveredService>();
  const verifying = new Set<number>();
  const rejected = new Set<number>();
  let stopped = false;

  const poll = async (): Promise<readonly DiscoveredService[]> => {
    if (stopped) {
      return [];
    }
    let listeners: ReadonlySet<number>;
    try {
      listeners = await listListeners(platform);
    } catch {
      return [];
    }
    const added: DiscoveredService[] = [];
    const pending: Promise<void>[] = [];
    for (const port of listeners) {
      if (options.baseline.has(port) || services.has(port) || rejected.has(port)) {
        continue;
      }
      if (verifying.has(port)) {
        continue;
      }
      verifying.add(port);
      pending.push(
        verifyHttp(port)
          .then((ok) => {
            if (!ok) {
              rejected.add(port);
              return;
            }
            const service: DiscoveredService = {
              port,
              url: serviceUrl(port),
              firstSeenAt: Date.now(),
            };
            services.set(port, service);
            added.push(service);
          })
          .catch(() => {
            rejected.add(port);
          })
          .finally(() => {
            verifying.delete(port);
          }),
      );
    }
    await Promise.all(pending);
    return [...services.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt);
  };

  return {
    services: () => [...services.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt),
    poll,
    stop() {
      stopped = true;
    },
  };
};

const runCapture = (command: string, args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
