// harden-lifecycle-ownership D1 (trace: darwin-runtime-carrier ADDED /
// darwin-launch-descriptor ADDED): the shared owner-stamped lock helper must
// make every stale-lock shape recoverable within a bounded budget and must
// make release token-safe, so a kill -9 at any point of materialization never
// requires a manual lock deletion again (plan §5 D1, F1/F5 evidence).

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { acquireOwnerStampedLock, type OwnerStampedLockOptions } from "./owner-stamped-lock";
import { ensureDarwinAppBundle } from "./app-bundle";
import { updateDarwinAppLaunchDescriptor } from "./app-launch";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

const fastOptions = (overrides: OwnerStampedOptions = {}): OwnerStampedLockOptions => ({
  timeoutMs: 2_000,
  pollIntervalMs: 10,
  unclaimedGraceMs: 50,
  ...overrides,
});

interface OwnerStampedOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly unclaimedGraceMs?: number;
}

const lockPathIn = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "opentray-owner-lock-"));
  roots.push(root);
  return join(root, "Skill Creator.app.opentray.lock");
};

/** A real PID that is guaranteed dead: spawn, SIGKILL, wait for the exit. */
const deadPid = async (): Promise<number> => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
  const pid = child.pid;
  if (pid === undefined) throw new Error("test child did not expose a pid");
  await new Promise((resolve) => {
    setTimeout(resolve, 150);
  });
  child.kill("SIGKILL");
  await new Promise((resolve) => {
    child.once("exit", resolve);
  });
  return pid;
};

describe("owner-stamped lock helper (D1)", () => {
  it("is held only after the owner record (pid + token) is on disk", async () => {
    const lockPath = await lockPathIn();

    const lock = await acquireOwnerStampedLock(lockPath, fastOptions());
    try {
      const owner = JSON.parse(await readFile(lockPath, "utf8")) as {
        pid: number;
        token: string;
      };
      expect(owner.pid).toBe(process.pid);
      expect(typeof owner.token).toBe("string");
      expect(owner.token.length).toBeGreaterThan(0);
    } finally {
      await lock.release();
    }
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reclaims an empty lock file within the bounded budget (F1 shape)", async () => {
    const lockPath = await lockPathIn();
    await writeFile(lockPath, "");

    const startedAt = Date.now();
    const lock = await acquireOwnerStampedLock(lockPath, fastOptions());
    await lock.release();

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reclaims an unparseable lock file within the bounded budget", async () => {
    const lockPath = await lockPathIn();
    await writeFile(lockPath, "not-a-lock-{{{");

    const lock = await acquireOwnerStampedLock(lockPath, fastOptions());
    const owner = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
    expect(owner.pid).toBe(process.pid);
    await lock.release();
  });

  it("reclaims a dead-owner lock left by a SIGKILLed holder", async () => {
    const lockPath = await lockPathIn();
    const pid = await deadPid();
    await writeFile(lockPath, `${JSON.stringify({ pid, token: randomUUID() })}\n`);

    const startedAt = Date.now();
    const lock = await acquireOwnerStampedLock(lockPath, fastOptions());
    const owner = JSON.parse(await readFile(lockPath, "utf8")) as { pid: number };
    expect(owner.pid).toBe(process.pid);
    await lock.release();

    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("preserves a live foreign owner until it times out", async () => {
    const lockPath = await lockPathIn();
    const foreign = `${JSON.stringify({ pid: process.pid, token: randomUUID() })}\n`;
    await writeFile(lockPath, foreign);

    await expect(
      acquireOwnerStampedLock(lockPath, fastOptions({ timeoutMs: 250 })),
    ).rejects.toMatchObject({ code: "lock_timeout" });
    // Contention preserves the live owner byte-for-byte.
    expect(await readFile(lockPath, "utf8")).toBe(foreign);
  });

  it("serializes contenders: a second acquirer waits for the first release", async () => {
    const lockPath = await lockPathIn();
    const first = await acquireOwnerStampedLock(lockPath, fastOptions());
    const second = acquireOwnerStampedLock(lockPath, fastOptions());

    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
    let settled = false;
    void second.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    await first.release();
    const secondLock = await Promise.race([
      second,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("second acquirer did not follow the release")), 2_000);
      }),
    ]);
    await secondLock.release();
  });

  it("delayed release never deletes a replacement owner's lock (token guard)", async () => {
    const lockPath = await lockPathIn();
    const delayed = await acquireOwnerStampedLock(lockPath, fastOptions());

    // The lock was reclaimed and re-stamped by a replacement owner while the
    // original holder was delayed in release.
    const replacement = `${JSON.stringify({ pid: process.pid, token: randomUUID() })}\n`;
    await writeFile(lockPath, replacement);

    await delayed.release();

    expect(await readFile(lockPath, "utf8")).toBe(replacement);
  });
});

describe("shared helper adoption (D1: app-bundle + app-launch)", () => {
  const bundleFixture = async (): Promise<{
    readonly bundlePath: string;
    readonly options: Parameters<typeof ensureDarwinAppBundle>[0];
  }> => {
    const root = await mkdtemp(join(tmpdir(), "opentray-owner-lock-shared-"));
    roots.push(root);
    const templatePath = join(root, "Info.plist");
    const brokerPath = join(root, "broker");
    const bundlePath = join(root, "Skill Creator.app");
    await writeFile(
      templatePath,
      `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>opentray</string><key>CFBundleIdentifier</key><string>com.jixoai.skill-creator</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`,
    );
    await writeFile(brokerPath, "broker-v1");
    await mkdir(join(bundlePath, "Contents/Resources"), { recursive: true });
    await writeFile(join(bundlePath, "Contents/Resources/opentray-app-bundle.json"), "{}\n");
    return {
      bundlePath,
      options: {
        bundlePath,
        packageName: "@jixoai/skill-creator",
        appId: "com.jixoai.skill-creator",
        appName: "Skill Creator",
        target: { os: "darwin" as const, arch: "arm64" as const },
        brokerPath,
        templatePath,
      },
    };
  };

  it("bundle materialization recovers a lock left empty by a killed materialization", async () => {
    const { bundlePath, options } = await bundleFixture();
    const lockPath = `${bundlePath}.opentray.lock`;
    await writeFile(lockPath, "");

    await expect(ensureDarwinAppBundle(options)).resolves.toBe(
      join(bundlePath, "Contents/MacOS/opentray"),
    );
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bundle materialization recovers a dead-owner stamped lock", async () => {
    const { bundlePath, options } = await bundleFixture();
    const lockPath = `${bundlePath}.opentray.lock`;
    await writeFile(lockPath, `${JSON.stringify({ pid: await deadPid(), token: randomUUID() })}\n`);

    await expect(ensureDarwinAppBundle(options)).resolves.toBe(
      join(bundlePath, "Contents/MacOS/opentray"),
    );
  });

  it("launch descriptor updates reclaim a stale lock through the same path", async () => {
    const { bundlePath } = await bundleFixture();
    const lockPath = `${bundlePath}.opentray.lock`;
    await writeFile(lockPath, `${JSON.stringify({ pid: await deadPid(), token: randomUUID() })}\n`);

    await updateDarwinAppLaunchDescriptor(bundlePath, {
      schemaVersion: 1,
      command: "/usr/bin/node",
      args: ["main.mjs"],
      cwd: bundlePath,
    });
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("materialization and descriptor updates serialize on the one shared lock", async () => {
    const { bundlePath, options } = await bundleFixture();
    // A live helper-level holder on the shared path must block both consumers.
    const holder = await acquireOwnerStampedLock(`${bundlePath}.opentray.lock`, fastOptions());

    const materializing = ensureDarwinAppBundle(options);
    const updating = updateDarwinAppLaunchDescriptor(bundlePath, {
      schemaVersion: 1,
      command: "/usr/bin/node",
      args: [],
      cwd: bundlePath,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
    let materialized = false;
    void materializing.then(() => {
      materialized = true;
    });
    expect(materialized).toBe(false);

    await holder.release();
    await materializing;
    await updating;
  });

  it("keeps exactly one lock implementation (no private exclusive-create copy)", async () => {
    const appBundle = await readFile(new URL("./app-bundle.ts", import.meta.url), "utf8");
    const appLaunch = await readFile(new URL("./app-launch.ts", import.meta.url), "utf8");
    expect(appBundle).toContain('from "./owner-stamped-lock"');
    expect(appLaunch).toContain('from "./owner-stamped-lock"');
    // Neither consumer may keep a private exclusive-create lock loop.
    expect(appBundle).not.toContain('open(lockPath, "wx")');
    expect(appLaunch).not.toContain('open(lockPath, "wx")');
  });
});
