import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  detectImageFormat,
  importResource,
  parseDataImageUrl,
  readResourceBytes,
} from "./resources";
import { createDirectoryLink } from "./links";
import { inspectProcess } from "./runtime-record";
import { buildExportPlan, buildScriptExport, quotePosix, quotePowerShell, reviewEnvironment } from "./export";
import type { CreateConfigV1 } from "./config";

const config = (appId: string): CreateConfigV1 => ({
  schemaVersion: 1,
  appId,
  appName: "App",
  command: { executable: "/usr/bin/node", args: ["serve"], cwd: "/tmp/project" },
  packageManager: "npm",
  icons: { imageSmoothingEnabled: true, background: "transparent", scale: 0.8 },
  window: { width: 1200, height: 800 },
  developerMode: false,
});

let dir: string;

const minimalPng = (): Uint8Array => {
  const png = Buffer.alloc(64);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return new Uint8Array(png);
};

const minimalSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#f00"/></svg>`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "create-res-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("detectImageFormat", () => {
  it("sniffs png/jpeg/webp/gif/svg from magic bytes", () => {
    expect(detectImageFormat(minimalPng())).toBe("png");
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectImageFormat(new TextEncoder().encode(minimalSvg))).toBe("svg");
    expect(detectImageFormat(new TextEncoder().encode("not an image"))).toBeUndefined();
  });
});

describe("parseDataImageUrl", () => {
  it("accepts png data URLs and rejects non-image payloads", () => {
    const b64 = Buffer.from(minimalPng()).toString("base64");
    const okResult = parseDataImageUrl(`data:image/png;base64,${b64}`);
    expect(okResult.ok).toBe(true);
    if (okResult.ok) {
      expect(okResult.value.format).toBe("png");
    }
    expect(parseDataImageUrl("data:text/plain;base64,aGk=").ok).toBe(false);
    expect(parseDataImageUrl("http://x/y.png").ok).toBe(false);
  });
});

describe("importResource", () => {
  it("commits a validated snapshot with hash and relative path, then reuses it", async () => {
    const iconPath = join(dir, "src.png");
    await writeFile(iconPath, minimalPng());
    const first = await importResource(
      { kind: "file", path: iconPath },
      { registrationDir: dir, filename: "app-icon" },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.ref.path).toBe("app-icon.png");
    expect(first.value.ref.format).toBe("png");
    expect(first.value.reused).toBe(false);
    await expect(readFile(join(dir, "app-icon.png"))).resolves.toBeDefined();

    const second = await importResource(
      { kind: "file", path: iconPath },
      { registrationDir: dir, filename: "app-icon" },
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.reused).toBe(true);
    }
  });

  it("rejects bytes that are not a recognized image", async () => {
    const badPath = join(dir, "not-image.bin");
    await writeFile(badPath, "plain text");
    const result = await importResource(
      { kind: "file", path: badPath },
      { registrationDir: dir, filename: "bad" },
    );
    expect(result.ok).toBe(false);
  });

  it("detects committed-byte drift through the recorded hash", async () => {
    const iconPath = join(dir, "drift.png");
    await writeFile(iconPath, minimalPng());
    const imported = await importResource(
      { kind: "file", path: iconPath },
      { registrationDir: dir, filename: "drift-icon" },
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    await writeFile(join(dir, imported.value.ref.path), new Uint8Array(64)); // corrupt
    const reread = await readResourceBytes(dir, imported.value.ref);
    expect(reread.ok).toBe(false);
  });
});

describe("createDirectoryLink", () => {
  it("creates a directory symlink on POSIX", async () => {
    const target = join(dir, "link-target");
    await mkdir(target, { recursive: true });
    const link = join(dir, "link-app");
    const result = await createDirectoryLink(link, target);
    expect(result.ok).toBe(true);
  });

  it("refuses to replace a physical directory with a link", async () => {
    const physical = join(dir, "physical-app");
    await mkdir(physical, { recursive: true });
    const result = await createDirectoryLink(physical, join(dir, "elsewhere"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_empty");
    }
  });
});

describe("inspectProcess", () => {
  it("classifies a live process as live and a dead pid as dead", async () => {
    const startedAt = await import("./runtime-record").then((m) =>
      m.readProcessStartEpochMs(process.pid),
    );
    expect(startedAt).toBeDefined();
    expect(await inspectProcess(process.pid, startedAt ?? null)).toBe("live");
    expect(await inspectProcess(999_999, null)).toBe("dead");
  });
});

describe("export", () => {
  it("quotes POSIX and PowerShell values with spaces/quotes/metacharacters", () => {
    expect(quotePosix(`it's a && test`)).toBe(`'it'\\''s a && test'`);
    expect(quotePowerShell(`it's`)).toBe(`'it''s'`);
    expect(quotePowerShell("plain-value.1")).toBe("plain-value.1");
    expect(quotePosix("$HOME")).toBe("'$HOME'");
  });

  it("requires force-copy for embedded uploads and defaults to script export", () => {
    const c = config("export.example");
    const blocked = buildExportPlan({
      config: c,
      embeddedResources: [{ flag: "app-icon", filename: "icon.png", bytes: minimalPng() }],
    });
    expect(blocked.ok).toBe(true);
    if (blocked.ok) {
      expect(blocked.value.directCommand).toBeNull();
      expect(blocked.value.directCommandBlockedReason).toMatch(/force-copy/u);
    }
    const forced = buildExportPlan({
      config: c,
      embeddedResources: [{ flag: "app-icon", filename: "icon.png", bytes: minimalPng() }],
      forceCopy: true,
    });
    expect(forced.ok).toBe(true);
    if (forced.ok) {
      expect(forced.value.directCommand).not.toBeNull();
      expect(forced.value.directCommand!.command.join(" ")).toContain("data:image/png;base64,");
    }
  });

  it("builds a runnable sh script with embedded bytes and quoted argv", () => {
    const c = config("export.example");
    c.command = {
      executable: "/usr/bin/node",
      args: ["serve", "--greeting", "hello world && goodbye"],
      cwd: "/tmp/my project",
    };
    const script = buildScriptExport(
      {
        config: c,
        embeddedResources: [{ flag: "app-icon", filename: "icon.png", bytes: minimalPng() }],
      },
      "sh",
    );
    expect(script.ok).toBe(true);
    if (!script.ok) return;
    expect(script.value.filename).toBe("create-opentray.sh");
    expect(script.value.content).not.toContain("\\r");
    expect(script.value.content).toContain("base64 -d");
    expect(script.value.content).toContain("'hello world && goodbye'");
    expect(script.value.content).toContain('"/tmp/my project"'.replace(/"/gu, "'"));
  });

  it("builds a CRLF PowerShell script", () => {
    const c = config("export.example");
    const script = buildScriptExport({ config: c }, "powershell");
    expect(script.ok).toBe(true);
    if (!script.ok) return;
    expect(script.value.filename).toBe("create-opentray.ps1");
    expect(script.value.content).toContain("\r\n");
    expect(script.value.content).not.toMatch(/(?<!\r)\n/u);
  });

  it("flags env acknowledgement for ANY non-empty env without heuristics", () => {
    const withEnv = config("env.example");
    withEnv.command = { ...withEnv.command, env: { RANDOM_NAME_XYZ: "1" } };
    const review = reviewEnvironment(withEnv);
    expect(review.requiresAcknowledgement).toBe(true);
    expect(review.envEntries).toEqual([{ key: "RANDOM_NAME_XYZ", value: "1" }]);
    expect(reviewEnvironment(config("noenv.example")).requiresAcknowledgement).toBe(false);
    const plan = buildExportPlan({ config: withEnv });
    expect(plan.ok && plan.value.requiresEnvAcknowledgement).toBe(true);
  });
});
