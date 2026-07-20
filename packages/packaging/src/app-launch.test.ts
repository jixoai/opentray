// Orthogonal intents (2026-07-20; original user request: remember the last
// invocation while keeping the carrier command strict and shell-free):
// 1. Prove the durable descriptor schema rejects drift.
// 2. Prove descriptor writes are atomic and readable from the stable bundle.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseDarwinAppLaunchDescriptor,
  readDarwinAppLaunchDescriptor,
  updateDarwinAppLaunchDescriptor,
} from "./app-launch";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Darwin app launch descriptor", () => {
  it("writes and reads the strict descriptor atomically", async () => {
    const root = await mkdtemp("/tmp/opentray-app-launch-");
    roots.push(root);
    const descriptor = {
      schemaVersion: 1 as const,
      command: "/usr/bin/node",
      args: ["/tmp/consumer.mjs", "--dev"],
      cwd: "/tmp/consumer",
    };

    await prepareBundle(root);
    await updateDarwinAppLaunchDescriptor(root, descriptor);

    expect(await readDarwinAppLaunchDescriptor(root)).toEqual(descriptor);
    expect(await readFile(join(root, "Contents/Resources/opentray-launch.json"), "utf8")).toContain(
      '"schemaVersion": 1',
    );
  });

  it("does not create launch state outside an initialized app bundle", async () => {
    const root = await mkdtemp("/tmp/opentray-app-launch-");
    roots.push(root);

    await expect(
      updateDarwinAppLaunchDescriptor(root, {
        schemaVersion: 1,
        command: "/usr/bin/node",
        args: [],
        cwd: "/tmp",
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unknown fields and invalid strings", () => {
    expect(() =>
      parseDarwinAppLaunchDescriptor({
        schemaVersion: 1,
        command: "/usr/bin/node",
        args: [],
        cwd: "/tmp",
        env: { SECRET: "no" },
      }),
    ).toThrow("unknown or missing fields");
    expect(() =>
      parseDarwinAppLaunchDescriptor({
        schemaVersion: 1,
        command: "",
        args: [],
        cwd: "/tmp",
      }),
    ).toThrow("command must be a non-empty string");
  });
});

const prepareBundle = async (bundlePath: string): Promise<void> => {
  const resources = join(bundlePath, "Contents/Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(join(resources, "opentray-app-bundle.json"), "{}\n");
};
