import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createWizardServer } from "./server";
import { createWizardSession, type WizardEvent } from "./wizard";

const createTestServer = async () => {
  const events: WizardEvent[] = [];
  const session = createWizardSession({
    cwd: "/tmp/wizard-cwd",
    skipInstall: true,
    force: true,
    dependencyRange: "^0.0.0-test",
    emit: (event) => events.push(event),
  });
  const server = await createWizardServer(
    () => session,
  );
  return { events, server, session };
};

const post = async (
  url: URL,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });

describe("wizard server", () => {
  it("serves the page only with a valid token", async () => {
    const { server } = await createTestServer();
    try {
      const url = new URL(server.url);
      const bare = await fetch(url.origin + "/", { redirect: "manual" });
      expect(bare.status).toBe(401);

      const badToken = await fetch(`${url.origin}/?token=deadbeef`, { redirect: "manual" });
      expect(badToken.status).toBe(401);

      const good = await fetch(server.url, { redirect: "manual" });
      expect(good.status).toBe(200);
      expect(await good.text()).toContain("create-opentray");
    } finally {
      await server.close();
    }
  });

  it("rejects mutating requests without the bearer token", async () => {
    const { server } = await createTestServer();
    try {
      const url = new URL("/api/command", server.url);
      const unauthenticated = await post(url, { command: "node -v" });
      expect(unauthenticated.status).toBe(401);

      const authenticated = await post(url, { command: "" }, {
        authorization: `Bearer ${server.token}`,
      });
      // A present-but-empty command is a 400 validation error, proving the
      // request passed the auth gate.
      expect(authenticated.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("accepts authorized requests and streams SSE events", async () => {
    const { server } = await createTestServer();
    try {
      const eventsUrl = new URL(`/api/events?token=${server.token}`, server.url);
      const response = await fetch(eventsUrl);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body!.getReader();
      const { value } = await reader.read();
      const first = new TextDecoder().decode(value ?? new Uint8Array());
      expect(first).toContain(": connected");
      await reader.cancel();

      const stop = await post(new URL("/api/stop", server.url), {}, {
        authorization: `Bearer ${server.token}`,
      });
      expect(stop.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("rejects unknown API endpoints with 404", async () => {
    const { server } = await createTestServer();
    try {
      const response = await post(new URL("/api/nope", server.url), {}, {
        authorization: `Bearer ${server.token}`,
      });
      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("validates terminal input and resize payloads", async () => {
    const { server } = await createTestServer();
    try {
      const input = await post(new URL("/api/terminal-input", server.url), { data: "ls\n" }, {
        authorization: `Bearer ${server.token}`,
      });
      expect(input.status).toBe(200);

      const missing = await post(new URL("/api/terminal-input", server.url), {}, {
        authorization: `Bearer ${server.token}`,
      });
      expect(missing.status).toBe(400);

      const resize = await post(
        new URL("/api/terminal-resize", server.url),
        { cols: 120, rows: 40 },
        { authorization: `Bearer ${server.token}` },
      );
      expect(resize.status).toBe(200);

      const badResize = await post(
        new URL("/api/terminal-resize", server.url),
        { cols: -1, rows: 0 },
        { authorization: `Bearer ${server.token}`,
          "content-type": "application/json" },
      );
      expect(badResize.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("serves only whitelisted vendor assets", async () => {
    const { server } = await createTestServer();
    try {
      const script = await fetch(new URL("/vendor/ghostty-web.js", server.url));
      expect(script.status).toBe(200);
      expect(script.headers.get("content-type")).toContain("text/javascript");

      const traversal = await fetch(new URL("/vendor/..%2f..%2fpackage.json", server.url));
      expect(traversal.status).toBe(404);

      const unknown = await fetch(new URL("/vendor/not-an-asset.js", server.url));
      expect(unknown.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("serves scraped icon bytes and accepts uploads", async () => {
    const { server, session } = await createTestServer();
    try {
      // Simulate a scraped candidate via the session seam.
      const dir = await mkdtemp(join(tmpdir(), "icon-ep-test-"));
      const iconPath = join(dir, "icon-0.bin");
      await writeFile(iconPath, Buffer.from("fake-png-bytes-0123456789"));
      session.replaceIconCandidates(19090, [
        { index: 0, url: "http://127.0.0.1:19090/favicon.svg", path: iconPath, width: 512, height: 512, format: "svg" },
      ]);

      const bytes = await fetch(
        new URL(`/api/icon-data/19090/0?token=${server.token}`, server.url),
      );
      expect(bytes.status).toBe(200);
      expect(bytes.headers.get("content-type")).toBe("image/svg+xml");
      expect(await bytes.text()).toContain("fake-png-bytes");

      // Unauthorized without a token.
      const denied = await fetch(new URL("/api/icon-data/19090/0", server.url));
      expect(denied.status).toBe(401);

      // Wrong port scope → not found.
      const wrongPort = await fetch(
        new URL(`/api/icon-data/19091/0?token=${server.token}`, server.url),
      );
      expect(wrongPort.status).toBe(404);

      // Raw upload persists and reports a server-side path.
      const upload = await fetch(new URL("/api/icon-upload", server.url), {
        method: "POST",
        headers: {
          authorization: `Bearer ${server.token}`,
          "content-type": "image/png",
        },
        body: Buffer.alloc(128, 3),
      });
      expect(upload.status).toBe(200);
      const { path } = (await upload.json()) as { path: string };
      expect(path.length).toBeGreaterThan(0);
      expect(await readFile(path, "utf8").catch(() => "")).toHaveLength(128);
    } finally {
      await server.close();
    }
  });

  it("serves built webui assets with traversal guards", async () => {
    const { server } = await createTestServer();
    try {
      const page = await fetch(new URL(`/?token=${server.token}`, server.url));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("id=\"root\"");

      // The built SPA's wasm sits at the document root where ghostty-web looks.
      const wasm = await fetch(new URL("/ghostty-vt.wasm", server.url));
      expect(wasm.status).toBe(200);
      expect(wasm.headers.get("content-type")).toBe("application/wasm");

      const traversal = await fetch(new URL("/assets/..%2f..%2fpackage.json", server.url));
      expect(traversal.status).toBe(404);

      const missing = await fetch(new URL("/assets/does-not-exist.js", server.url));
      expect(missing.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
