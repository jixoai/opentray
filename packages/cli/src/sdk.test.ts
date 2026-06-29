import { describe, expect, it, vi } from "vitest";

import { createTray } from "./sdk";
import { connectLocalBroker, type LocalBrokerClient } from "./local-broker";

vi.mock("./local-broker", () => ({
  connectLocalBroker: vi.fn(),
}));

describe("Feature: SDK runtime selection", () => {
  it("Scenario: Given no runtime override When createTray runs Then the default transport uses the local broker", async () => {
    const frames: unknown[] = [];
    const connection = createRecordingConnection(frames);
    vi.mocked(connectLocalBroker).mockResolvedValueOnce(connection);

    const tray = await createTray(
      {
        id: "status",
      },
      {
        packageVersion: "0.10.0",
      }
    );

    expect(connectLocalBroker).toHaveBeenCalledWith({
      packageVersion: "0.10.0",
    });
    expect(tray.trayId).toBe("status");
    expect(frames).toEqual([
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

const createRecordingConnection = (frames: unknown[]): LocalBrokerClient => ({
  endpoint: "unix:///tmp/opentray.sock",
  callerLabel: "com.example.build",
  sessionId: "session-1",
  request(frame) {
    const serialized = JSON.stringify(frame);
    const parsed = JSON.parse(serialized) as { type: string; requestId: string };
    frames.push(parsed);
    switch (parsed.type) {
      case "resolve-default-app":
        return Promise.resolve({
          type: "default-app",
          requestId: parsed.requestId,
          app: {
            appId: "app-default",
          },
        });
      case "create-tray":
        return Promise.resolve({
          type: "tray-created",
          requestId: parsed.requestId,
          appId: "app-default",
          trayId: "status",
        });
      default:
        return Promise.resolve({
          type: "error",
          requestId: parsed.requestId,
          code: "unsupported",
          message: parsed.type,
        });
    }
  },
  onEvent: () => () => {},
  close: async () => {},
});
