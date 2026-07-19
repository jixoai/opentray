import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { materializeDarwinBrokerCarrier } from "./darwin-carrier";
import { resolveDaemonPaths } from "./paths";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Darwin broker carrier", () => {
  it.skipIf(process.platform !== "darwin")(
    "materializes the exact broker bytes with caller bundle identity",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "opentray-darwin-carrier-"));
      tempDirs.push(root);
      const brokerPath = join(root, "opentray");
      const archivePath = join(root, "OpenTray.app.zip");
      await writeFile(brokerPath, "test-broker-bytes", "utf8");
      await chmod(brokerPath, 0o755);
      await execFileAsync(
        "bash",
        [
          join(repoRoot, "scripts/release/build-darwin-runtime-carrier.sh"),
          archivePath,
          brokerPath,
        ],
        { cwd: repoRoot },
      );

      const paths = resolveDaemonPaths({
        homeDir: root,
        packageVersion: "0.1.0",
        callerLabel: "skill-creator",
        appId: "com.skill-creator",
        appName: "Skill Creator",
      });
      const materialized = await materializeDarwinBrokerCarrier({
        archivePath,
        brokerPath,
        paths,
      });

      expect(await readFile(materialized, "utf8")).toBe("test-broker-bytes");
      const plistPath = join(materialized, "..", "..", "Info.plist");
      const { stdout } = await execFileAsync("/usr/bin/plutil", [
        "-convert",
        "json",
        "-o",
        "-",
        plistPath,
      ]);
      expect(JSON.parse(stdout)).toMatchObject({
        CFBundleIdentifier: "com.skill-creator",
        CFBundleName: "Skill Creator",
        CFBundleDisplayName: "Skill Creator",
        CFBundleExecutable: "opentray",
      });
      await expect(
        materializeDarwinBrokerCarrier({ archivePath, brokerPath, paths }),
      ).resolves.toBe(materialized);
    },
  );
});
