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

/** Listener snapshot with process ownership: port -> owning PIDs. */
export type ListenerOwners = ReadonlyMap<number, ReadonlySet<number>>;

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

/** Listeners with ownership; used to attribute ports to the preview process tree. */
export const listListeningPortOwners = async (
  platform: NodeJS.Platform = process.platform,
): Promise<ListenerOwners> => {
  if (platform === "win32") {
    const structured = await listWindowsListenersStructured().catch(() => undefined);
    if (structured !== undefined) {
      return structured;
    }
    const stdout = await runCapture("netstat", ["-ano", "-p", "tcp"]).catch(() => "");
    return parseNetstatPortOwners(stdout);
  }
  const stdout = await runCapture("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pPn"]).catch(
    () => "",
  );
  return parseLsofPortOwners(stdout);
};

const listLsofListeningPorts = async (): Promise<ReadonlySet<number>> => {
  // lsof exits non-zero when NO listener matches ("no process found") —
  // an empty result, not an error. The sibling owner-scan above already
  // treats it that way; this call site rejected and killed whole test
  // suites on quiet machines (CI runners).
  const stdout = await runCapture("lsof", [
    "-nP",
    "-iTCP",
    "-sTCP:LISTEN",
    "-F",
    "Pn",
  ]).catch(() => "");
  return parseLsofPorts(stdout);
};

/**
 * Parse `lsof -F pPn` output into port -> owning PIDs. The field stream is
 * `p<pid>`, `P<proto>`, `n<host:port>` per socket, so each address inherits
 * the most recent pid field.
 */
export const parseLsofPortOwners = (stdout: string): ListenerOwners => {
  const owners = new Map<number, Set<number>>();
  let currentPid: number | undefined;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) {
      const pid = Number.parseInt(line.slice(1), 10);
      currentPid = Number.isInteger(pid) ? pid : undefined;
      continue;
    }
    if (!line.startsWith("n")) {
      continue;
    }
    const hostPort = line.slice(1);
    const index = hostPort.lastIndexOf(":");
    if (index < 0) {
      continue;
    }
    const port = Number.parseInt(hostPort.slice(index + 1), 10);
    if (!Number.isInteger(port) || port <= 0 || currentPid === undefined) {
      continue;
    }
    const pids = owners.get(port) ?? new Set<number>();
    pids.add(currentPid);
    owners.set(port, pids);
  }
  return owners;
};

/** Parse `netstat -ano -p tcp` into port -> owning PIDs (PID is the last column). */
/**
 * Locale-independent netstat listener discriminator. A TCP listener data row
 * is [TCP, local:endpoint, remote:endpoint, state, pid] and its remote
 * endpoint is always the unspecified address with port 0 (0.0.0.0:0 /
 * [::]:0). We deliberately do NOT match the state word: it is localized on
 * non-English Windows (ABHÖREN, ...), which silently dropped every listener.
 */
const isNetstatListenerRow = (cols: readonly string[]): boolean => {
  if (cols.length < 5 || cols[0]?.toLowerCase() !== "tcp") {
    return false;
  }
  const remote = cols[2] ?? "";
  const portIndex = remote.lastIndexOf(":");
  if (portIndex < 0) {
    return false;
  }
  const remotePort = Number.parseInt(remote.slice(portIndex + 1), 10);
  const localPort = Number.parseInt((cols[1] ?? "").split(":").pop() ?? "", 10);
  return (
    remotePort === 0 &&
    Number.isInteger(localPort) &&
    localPort > 0 &&
    /^\d+$/.test(cols[4] ?? "")
  );
};

export const parseNetstatPortOwners = (stdout: string): ListenerOwners => {
  const owners = new Map<number, Set<number>>();
  for (const rawLine of stdout.split("\n")) {
    const columns = rawLine.trim().split(/\s+/);
    if (!isNetstatListenerRow(columns)) {
      continue;
    }
    const local = columns[1] ?? "";
    const pid = Number.parseInt(columns[columns.length - 1] ?? "", 10);
    if (local === undefined || !Number.isInteger(pid)) {
      continue;
    }
    const index = local.lastIndexOf(":");
    const port = Number.parseInt(local.slice(index + 1), 10);
    if (!Number.isInteger(port) || port <= 0) {
      continue;
    }
    const pids = owners.get(port) ?? new Set<number>();
    pids.add(pid);
    owners.set(port, pids);
  }
  return owners;
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
  // Structured source first: Get-NetTCPConnection is locale-independent
  // (netstat's state column is localized — ABHÖREN on German Windows — which
  // silently breaks the text parser) and carries OwningProcess in one call.
  const structured = await listWindowsListenersStructured().catch(() => undefined);
  if (structured !== undefined) {
    return new Set(structured.keys());
  }
  try {
    const stdout = await runCapture("netstat", ["-ano", "-p", "tcp"]);
    return parseNetstatPorts(stdout);
  } catch {
    const stdout = await runPowerShellTcpListeners().catch(() => "");
    return parsePowerShellPorts(stdout);
  }
};

/**
 * Windows structured listener+owner enumeration via Get-NetTCPConnection
 * (Win8+/PS3.0+): `-State Listen` filters server-side sockets server-side
 * and ConvertTo-Json keeps parsing locale-independent.
 */
const listWindowsListenersStructured = async (): Promise<ListenerOwners> => {
  const script = [
    "Get-NetTCPConnection -State Listen |",
    "Select-Object LocalPort, OwningProcess |",
    "ConvertTo-Json -Compress",
  ].join(" ");
  const stdout = await runCapture("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
  return parseNetTcpConnectionJson(stdout);
};

/** Parse Get-NetTCPConnection JSON (single object or array) into owners. */
export const parseNetTcpConnectionJson = (stdout: string): ListenerOwners => {
  const owners = new Map<number, Set<number>>();
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return owners;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return owners;
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      continue;
    }
    const record = row as { LocalPort?: unknown; OwningProcess?: unknown };
    const port = Number(record.LocalPort);
    const pid = Number(record.OwningProcess);
    if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    const pids = owners.get(port) ?? new Set<number>();
    pids.add(pid);
    owners.set(port, pids);
  }
  return owners;
};

/** Parses `netstat -ano -p tcp` output; keeps LISTENING rows. */
export const parseNetstatPorts = (stdout: string): ReadonlySet<number> => {
  const ports = new Set<number>();
  for (const rawLine of stdout.split("\n")) {
    const columns = rawLine.trim().split(/\s+/);
    if (!isNetstatListenerRow(columns)) {
      continue;
    }
    const local = columns[1] ?? "";
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

const runPowerShellTcpListeners = async (): Promise<string> => {
  // [Net.NetworkInformation.NetworkInformation] does not exist in Windows
  // PowerShell 5.1 (the class was never public); the real surface is the
  // IPGlobalProperties instance method GetActiveTcpListeners.
  const script = "[System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | ForEach-Object { $_.Port }";
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

/** Collect a PID and every descendant (BFS over `pgrep -P` on POSIX). */
export const collectProcessTreePids = async (
  rootPid: number,
  platform: NodeJS.Platform = process.platform,
  options: { runCapture?: typeof runCapture } = {},
): Promise<ReadonlySet<number>> => {
  const capture = options.runCapture ?? runCapture;
  const tree = new Set<number>([rootPid]);
  if (platform === "win32") {
    return collectWindowsProcessTreePids(rootPid, capture);
  }
  const frontier = [rootPid];
  while (frontier.length > 0) {
    const pid = frontier.shift();
    if (pid === undefined) {
      break;
    }
    const stdout = await capture("pgrep", ["-P", String(pid)]).catch(() => "");
    for (const line of stdout.split("\n")) {
      const child = Number.parseInt(line.trim(), 10);
      if (Number.isInteger(child) && child > 0 && !tree.has(child)) {
        tree.add(child);
        frontier.push(child);
      }
    }
  }
  return tree;
};

/**
 * Windows descendant enumeration: BFS over Win32_Process ParentProcessId —
 * the same primitive taskkill /T uses internally (wmic is removed in Win11
 * 24H2, so CIM is the durable surface). npm/pnpm wrappers insert 2-3 layers
 * (cmd.exe -> npm -> node) between the spawned PID and the listener; without
 * this walk the ownership gate rejected every discovered port on Windows.
 */
const collectWindowsProcessTreePids = async (
  rootPid: number,
  capture: typeof runCapture,
): Promise<ReadonlySet<number>> => {
  const script = [
    "$pids = @(" + String(rootPid) + ");",
    "$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId;",
    "for ($i = 0; $i -lt $pids.Count; $i++) {",
    "  $children = $all | Where-Object { $_.ParentProcessId -eq $pids[$i] -and -not $pids.Contains([int]$_.ProcessId) };",
    "  foreach ($c in $children) { [void]$pids.Add([int]$c.ProcessId) }",
    "}",
    "$pids -join ' '",
  ].join(" ");
  const stdout = await capture("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]).catch(() => "");
  const tree = new Set<number>([rootPid]);
  for (const token of stdout.split(/\s+/)) {
    const pid = Number.parseInt(token, 10);
    if (Number.isInteger(pid) && pid > 0) {
      tree.add(pid);
    }
  }
  return tree;
};

export interface PortDiscoveryOptions {
  readonly platform?: NodeJS.Platform;
  readonly baseline: ReadonlySet<number>;
  readonly listListeners?: ListenersRunner;
  readonly verifyHttp?: (port: number) => Promise<boolean>;
  /** Resolves the PIDs whose listeners count as services (preview process tree). */
  readonly resolveOwnerPids?: () => Promise<ReadonlySet<number>>;
  readonly listOwners?: () => Promise<ListenerOwners>;
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
  const listOwners = options.listOwners ?? (() => listListeningPortOwners(platform));
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

    // Ownership filter: only ports owned by the preview process tree may
    // become services, so foreign loopback listeners (browser DevTools
    // sockets, sync daemons) are never adopted.
    let owners: ListenerOwners | undefined;
    let ownerPids: ReadonlySet<number> | undefined;
    if (options.resolveOwnerPids !== undefined) {
      const [ownerMap, pids] = await Promise.all([
        listOwners().catch(() => undefined),
        options.resolveOwnerPids().catch(() => undefined),
      ]);
      owners = ownerMap;
      ownerPids = pids;
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
      // Ownership gating only when BOTH sides enumerated. An empty owner map
      // (enumeration failed) or an empty tree must NOT reject every port —
      // that was the Windows "zero services, zero errors" failure mode.
      const ownersKnown = owners !== undefined && owners.size > 0;
      const treeKnown = ownerPids !== undefined && ownerPids.size > 0;
      if (ownersKnown && treeKnown && owners !== undefined && ownerPids !== undefined) {
        const portOwners = owners.get(port);
        const owned =
          portOwners !== undefined &&
          [...portOwners].some((pid) => ownerPids.has(pid));
        if (!owned) {
          // Another process owns this listener; ignore it permanently unless
          // ownership changes (re-checked next poll while unknown).
          continue;
        }
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

export const runCapture = async (
  command: string,
  args: readonly string[],
): Promise<string> =>
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
