import { createBrokerEndpointIdentity, formatUnixSocketPath, formatWindowsPipeName } from "@opentray/spec";

export interface DaemonPathOptions {
  homeDir: string;
  packageVersion: string;
  platform?: NodeJS.Platform;
}

export interface DaemonPaths {
  homeDir: string;
  packageVersion: string;
  protocolVersion: number;
  stateRoot: string;
  runtimeDir: string;
  endpoint: string;
  pidFile: string;
  lockFile: string;
  readyFile: string;
}

export const resolveDaemonPaths = ({
  homeDir,
  packageVersion,
  platform = process.platform,
}: DaemonPathOptions): DaemonPaths => {
  const identity = createBrokerEndpointIdentity({ packageVersion });
  const normalizedHome = homeDir.replace(/[\\/]+$/u, "");
  const stateRoot = `${normalizedHome}/.opentray/${identity.packageVersion}`;
  const runtimeDir = `${stateRoot}/runtime`;
  const endpoint =
    platform === "win32" ? formatWindowsPipeName(identity) : formatUnixSocketPath(normalizedHome, identity);

  return {
    homeDir: normalizedHome,
    packageVersion: identity.packageVersion,
    protocolVersion: identity.protocolVersion,
    stateRoot,
    runtimeDir,
    endpoint,
    pidFile: `${runtimeDir}/broker.pid`,
    lockFile: `${runtimeDir}/broker.lock`,
    readyFile: `${runtimeDir}/ready.json`,
  };
};
