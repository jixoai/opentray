import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { authFor, authWithOtp, createPublicRegistryAuth, sanitizedEnv } from "./env";
import { createPackageManifest, readManifest, validateManifest } from "./manifest";
import { configureTrust, registryState, resolveNpmRuntime, run, trustState } from "./npm";
import type { AuthContext, Options, PackageJson, RegistryState, Report } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const packageDirExists = async (dir: string): Promise<boolean> => {
  try {
    await access(dir);
    return true;
  } catch {
    return false;
  }
};

const ensureWorkspacePackage = async (options: Options, report: Report): Promise<boolean> => {
  const absoluteDir = resolve(options.dir);
  const exists = await packageDirExists(absoluteDir);
  if (exists) {
    report.stages.push(`workspace exists: ${options.dir}`);
    return true;
  }
  if (!options.createWorkspace) {
    report.stages.push(`workspace missing: ${options.dir}`);
    return false;
  }
  if (options.dryRun) {
    report.stages.push(`would create workspace: ${options.dir}`);
    return false;
  }
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(
    join(absoluteDir, "package.json"),
    `${JSON.stringify(createPackageManifest(options.packageName, options.initialVersion, options.kind), null, 2)}\n`,
  );
  await writeFile(join(absoluteDir, "README.md"), `# ${options.packageName}\n\nPackage bootstrapped by OpenTray release tooling.\n`);
  report.stages.push(`created workspace: ${options.dir}`);
  return true;
};

const runPackageValidation = async (options: Options, manifest: PackageJson, auth: AuthContext, report: Report): Promise<void> => {
  if (manifest.scripts?.build) {
    const build = await run(["pnpm", "--filter", options.packageName, "build"], sanitizedEnv(), []);
    if (build.exitCode !== 0) throw new Error(`Package build failed:\n${build.stderr || build.stdout}`);
    report.stages.push("package build passed");
  } else {
    report.stages.push("package build skipped");
  }
  const pack = await run(["npm", "pack", "--dry-run", "--json"], auth.env, auth.secrets, resolve(options.dir));
  if (pack.exitCode !== 0) throw new Error(`npm pack dry-run failed:\n${pack.stderr || pack.stdout}`);
  report.stages.push("npm pack dry-run passed");
};

const waitForRegistryVisibility = async (options: Options, auth: AuthContext, report: Report): Promise<RegistryState> => {
  const deadline = Date.now() + options.visibilityTimeoutMs;
  let latest: RegistryState = { type: "missing" };
  // npm publish can succeed before the package document is immediately visible to npm view.
  while (Date.now() <= deadline) {
    latest = await registryState(options.packageName, auth.env, auth.secrets);
    if (latest.type === "exists") {
      report.stages.push(`registry visible: ${latest.version}`);
      return latest;
    }
    await run(["npm", "dist-tag", "ls", options.packageName], auth.env, auth.secrets);
    await sleep(options.visibilityIntervalMs);
  }
  return latest;
};

export const bootstrapPackage = async (options: Options): Promise<Report> => {
  const report: Report = {
    packageName: options.packageName,
    dir: options.dir,
    dryRun: options.dryRun,
    stages: [],
    published: false,
    trustedConfigured: false,
  };

  const hasWorkspace = await ensureWorkspacePackage(options, report);
  const publishAuth = await authFor(options.publishAuth);
  const registryAuth = await createPublicRegistryAuth();
  try {
    if (hasWorkspace) {
      const manifest = await readManifest(resolve(options.dir));
      validateManifest(manifest, options.packageName);
      await runPackageValidation(options, manifest, publishAuth, report);
    }

    const initialRegistry = await registryState(options.packageName, registryAuth.env, registryAuth.secrets);
    report.registry = initialRegistry;
    if (initialRegistry.type === "error") throw new Error(`npm view failed:\n${initialRegistry.message}`);

    if (initialRegistry.type === "missing") {
      if (!options.publishIfMissing) {
        report.stages.push("package missing; initial publish not requested");
      } else if (options.dryRun || !options.yes) {
        report.stages.push(`would publish initial package: ${options.packageName}@${options.initialVersion}`);
      } else {
        if (!hasWorkspace) throw new Error("Cannot publish because workspace package does not exist.");
        const publish = await run(["npm", "publish", "--access", "public", "--registry", options.registry], publishAuth.env, publishAuth.secrets, resolve(options.dir));
        if (publish.exitCode !== 0) throw new Error(`npm publish failed:\n${publish.stderr || publish.stdout}`);
        report.published = true;
        report.stages.push("initial publish succeeded");
        report.registry = await waitForRegistryVisibility(options, registryAuth, report);
        if (report.registry.type !== "exists") throw new Error("Package was published but did not become visible before timeout.");
      }
    } else {
      report.stages.push(`package exists: ${initialRegistry.version}`);
    }

    if (options.configureTrust) {
      if (options.dryRun || !options.yes) {
        report.stages.push("would inspect and configure trusted publisher");
      } else {
        // npm trust requires the package to exist, so this stage must follow publish/visibility.
        const trustAuth = await authFor(options.trustAuth);
        try {
          const runtime = await resolveNpmRuntime(trustAuth);
          report.stages.push(`npm trust runtime: ${runtime.label}`);
          const currentTrust = await trustState(options, runtime, await authWithOtp(trustAuth));
          report.trust = currentTrust;
          if (currentTrust.type === "trusted") {
            report.stages.push("trusted publisher already matches");
          } else if (currentTrust.type === "missing") {
            await configureTrust(options, runtime, await authWithOtp(trustAuth));
            const verified = await trustState(options, runtime, await authWithOtp(trustAuth));
            if (verified.type !== "trusted") throw new Error("Trusted publisher did not verify after configure.");
            report.trust = verified;
            report.trustedConfigured = true;
            report.stages.push("trusted publisher configured");
          } else if (currentTrust.type === "mismatch" && !options.replaceTrust) {
            throw new Error("Trusted publisher mismatch. Re-run with --replace-trust after manual review.");
          } else {
            throw new Error(`Trusted publisher check failed: ${currentTrust.message}`);
          }
        } finally {
          await trustAuth.cleanup();
        }
      }
    }
  } finally {
    await registryAuth.cleanup();
    await publishAuth.cleanup();
  }

  return report;
};
