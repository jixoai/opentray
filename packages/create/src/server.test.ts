import { describe, expect, it } from "vitest";

import { createWizardServer } from "./server";
import { createWizardSession, type WizardEvent } from "./wizard";

const createTestServer = async () => {
  const events: WizardEvent[] = [];
  const server = await createWizardServer(
    (emit) =>
      createWizardSession({
        cwd: "/tmp/wizard-cwd",
        skipInstall: true,
        force: true,
        dependencyRange: "^0.0.0-test",
        emit,
      }),
  );
  return { events, server };
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
});
