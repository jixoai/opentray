// Workbench API projection tests (wizard-share-and-list-scan): dual-layout
// discovery, wizard config projection, open, and wizard-branch export. HOME is
// redirected to a fixture root because os.homedir() honors $HOME on POSIX.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleWorkbenchApi } from "./workbench-api";

const writeWizardProject = async (root: string, key: string): Promise<void> => {
  const dir = join(root, key);
  await mkdir(join(dir, "app-icon"), { recursive: true });
  await writeFile(
    join(dir, "opentray.app.json"),
    JSON.stringify({
      schemaVersion: 1,
      appId: "web.dsh.npx",
      appName: "DeepSeek Harness",
      command: {
        command: "/usr/local/bin/node",
        args: ["npx", "-y", "@deepseek-ai/dsh@latest", "web"],
        cwd: "/tmp/home",
        env: { API_TOKEN: "never-echo" },
      },
      service: { port: 3080 },
      window: { width: 1200, height: 800 },
      developerMode: true,
    }),
    "utf8",
  );
  await writeFile(join(dir, "main.mjs"), "// generated\n", "utf8");
  await writeFile(join(dir, "pnpm-lock.yaml"), "", "utf8");
  await writeFile(join(dir, "app-icon", "app-icon.png"), Buffer.alloc(16, 0x89), "utf8");
};

const originalHome = process.env.HOME;
let root: string;

beforeAll(async () => {
  const home = await mkdtemp(join(tmpdir(), "workbench-test-"));
  root = join(home, ".opentray", "create");
  await mkdir(root, { recursive: true });
  await writeWizardProject(root, "web-dsh-npx");
  process.env.HOME = home;
});

afterAll(() => {
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
});

const get = async (pathname: string) =>
  handleWorkbenchApi({ method: "GET", pathname, query: new URLSearchParams(), body: {} });
const post = async (pathname: string, body: Record<string, unknown>) =>
  handleWorkbenchApi({ method: "POST", pathname, query: new URLSearchParams(), body });

describe("workbench /api/apps dual-layout discovery", () => {
  it("lists the wizard project with its projection", async () => {
    const response = await get("/api/apps");
    expect(response?.status).toBe(200);
    const body = response!.body as {
      key: string;
      source: string;
      appId?: string;
      projectDir?: string;
      hasEnv?: boolean;
    }[];
    const wizard = body.find((entry) => entry.key === "web-dsh-npx");
    expect(wizard?.source).toBe("wizard");
    expect(wizard?.appId).toBe("web.dsh.npx");
    expect(wizard?.projectDir).toBe(join(root, "web-dsh-npx"));
    expect(wizard?.hasEnv).toBe(true);
  });

  it("projects the wizard config for the edit flow", async () => {
    const response = await get("/api/apps/web-dsh-npx/config");
    expect(response?.status).toBe(200);
    const config = response!.body as {
      appId: string;
      command: { executable: string; args: string[]; cwd: string; env?: Record<string, string> };
      packageManager: string;
      developerMode: boolean;
    };
    expect(config.appId).toBe("web.dsh.npx");
    expect(config.command.executable).toBe("/usr/local/bin/node");
    expect(config.command.args).toContain("web");
    expect(config.command.env?.API_TOKEN).toBe("never-echo"); // edit surface
    expect(config.packageManager).toBe("pnpm");
    expect(config.developerMode).toBe(true);
  });

  it("exports a wizard project as a self-contained sh script", async () => {
    const response = await post("/api/apps/web-dsh-npx/export", {
      format: "sh",
      acknowledgeEnv: true,
    });
    expect(response?.status).toBe(200);
    const body = response!.body as { filename: string; content: string };
    expect(body.filename).toBe("create-opentray.sh");
    expect(body.content).toContain("--app-id");
    expect(body.content).toContain("web.dsh.npx");
    expect(body.content).toContain("@deepseek-ai/dsh@latest");
    // The stable in-project icon asset travels as embedded base64 bytes.
    expect(body.content).toContain("app_icon_tmp");
    // Acknowledged complete export includes env values BY CONTRACT; the
    // never-echo law guards the UNacknowledged refusal path (tested below).
    expect(body.content).toContain("--env");
    expect(body.content).toContain("API_TOKEN=");
  });

  it("refuses export until env is acknowledged", async () => {
    const response = await post("/api/apps/web-dsh-npx/export", { format: "sh" });
    expect(response?.status).toBe(409);
    expect(response!.body).toMatchObject({ code: "env_ack_required" });
    // The refusal never echoes the env VALUES.
    expect(JSON.stringify(response!.body)).not.toContain("never-echo");
  });

  it("answers 404 for an unknown key", async () => {
    const response = await get("/api/apps/no-such-key/config");
    expect(response?.status).toBe(404);
  });

  it("serves the row icon as a data URL", async () => {
    const list = await get("/api/apps");
    const body = list!.body as { key: string; hasIcon?: boolean }[];
    expect(body.find((entry) => entry.key === "web-dsh-npx")?.hasIcon).toBe(true);
    const response = await get("/api/apps/web-dsh-npx/icon");
    expect(response?.status).toBe(200);
    const data = response!.body as { dataUrl?: string };
    expect(data.dataUrl).toMatch(/^data:image\/png;base64,/u);
  });
});
