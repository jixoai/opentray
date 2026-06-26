import { describe, expect, it } from "vitest";

import { createTray } from "./sdk";
import type { OpenTrayRuntimeBinding } from "./native-runtime";

describe("Feature: SDK runtime selection", () => {
  it("Scenario: Given headless binding mode When createTray runs Then tray creation uses the binding-owned runtime", async () => {
    const frames: unknown[] = [];
    const binding = createRecordingBinding(frames);

    const tray = await createTray(
      {
        id: "status",
      },
      {
        runtime: "headless-binding",
        binding,
        packageVersion: "0.9.0",
        appId: "com.example.build",
        appName: "Build",
      }
    );

    expect(tray.trayId).toBe("status");
    expect(frames).toEqual([
      {
        type: "init",
        protocolVersion: 1,
        clientVersion: "0.9.0",
      },
      {
        type: "resolve-default-app",
        requestId: "opentray-1",
      },
      {
        type: "create-tray",
        requestId: "opentray-2",
        app: {
          appId: "app-default",
        },
        tray: {
          id: "status",
        },
      },
    ]);
  });
});

const createRecordingBinding = (frames: unknown[]): OpenTrayRuntimeBinding => ({
  runtimeBindingInfo: () => ({
    kind: "opentray-node-runtime",
    protocolVersion: 1,
  }),
  createHeadlessRuntime: (packageVersion, appId, appName) => ({
    request(frameJson: string): string[] {
      const frame = JSON.parse(frameJson) as {
        type: string;
        requestId?: string;
      };
      frames.push(frame);
      switch (frame.type) {
        case "init":
          expect(packageVersion).toBe("0.9.0");
          expect(appId).toBe("com.example.build");
          expect(appName).toBe("Build");
          return [
            JSON.stringify({
              type: "ready",
              protocolVersion: 1,
              brokerVersion: "0.9.0",
              sessionId: "session-1",
            }),
          ];
        case "resolve-default-app":
          return [
            JSON.stringify({
              type: "default-app",
              requestId: frame.requestId,
              app: {
                appId: "app-default",
              },
            }),
          ];
        case "create-tray":
          return [
            JSON.stringify({
              type: "tray-created",
              requestId: frame.requestId,
              appId: "app-default",
              trayId: "status",
            }),
          ];
        default:
          return [
            JSON.stringify({
              type: "error",
              requestId: frame.requestId,
              code: "unsupported",
              message: frame.type,
            }),
          ];
      }
    },
    close: () => [],
  }),
});
