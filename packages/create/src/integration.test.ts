// Integration: drive the real command-run → port-diff discovery → scrape →
// scaffold pipeline against a `node -e` HTTP server command, with install and
// native runtime materialization skipped.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveDefaultAppId } from "./app-id";
import { startCommandRun } from "./command-run";
import { createPortDiscovery, listListeningPorts } from "./port-scan";
import { scrapeService } from "./scrape";
import { writeScaffold } from "./scaffold";
import { tokenizeCommandLine } from "./tokenize";

const serverScript = `const http = require("node:http");
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/icon.png")) {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256, 9)]);
    res.writeHead(200, { "content-type": "image/png" });
    res.end(bytes);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end([
    "<html><head><title>Integration Service</title>",
    '<link rel="icon" href="/icon.png" sizes="128x128">',
    "</head><body>ok</body></html>",
  ].join(""));
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("LISTENING " + server.address().port + "\\n");
});
`;

describe("wizard pipeline integration", () => {
  it("runs the command, discovers the service, scrapes identity, and scaffolds", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "create-opentray-integration-"));
    const serverPath = join(workDir, "server.cjs");
    await writeFile(serverPath, serverScript, "utf8");

    const command = `node ${serverPath}`;
    const tokens = tokenizeCommandLine(command);
    expect(tokens.ok).toBe(true);
    if (!tokens.ok) return;

    const baseline = await listListeningPorts(process.platform);
    const run = await startCommandRun({
      tokens: tokens.tokens,
      cwd: workDir,
      onEvent: () => {},
    });

    try {
      const discovery = createPortDiscovery({ baseline });
      const deadline = Date.now() + 15_000;
      let services = discovery.services();
      while (services.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await discovery.poll();
        services = discovery.services();
      }
      expect(services.length).toBeGreaterThan(0);
      const port = services[0]!.port;

      const scraped = await scrapeService(port);
      expect(scraped.ok).toBe(true);
      expect(scraped.title).toBe("Integration Service");
      expect(scraped.iconPath).toBeDefined();
      expect(await readFile(scraped.iconPath!)).toHaveLength(256 + 8);

      const targetDir = join(workDir, "project");
      const scaffold = await writeScaffold({
        config: {
          schemaVersion: 1,
          appId: deriveDefaultAppId(tokens.tokens),
          appName: scraped.title ?? "Fallback",
          command: { command: process.execPath, args: tokens.tokens.slice(1), cwd: workDir },
          service: { port },
          window: { width: 1_200, height: 800 },
        },
        targetDir,
        dependencyRange: "^0.18.0",
        skipInstall: true,
      });
      const persisted = JSON.parse(await readFile(scaffold.configPath, "utf8"));
      expect(persisted.service.port).toBe(port);
      expect(persisted.appName).toBe("Integration Service");
      expect(persisted.appId).toBe("server.cjs.node");
      expect(scaffold.writtenFiles).toContain("main.mjs");
    } finally {
      await run.kill();
    }
  }, 30_000);
});
