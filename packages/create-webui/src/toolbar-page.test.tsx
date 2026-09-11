// @vitest-environment jsdom
//
// Toolbar-page channel tests (add-webview-orchestration D12/D13): the strip
// holds no iframe; navigation commands and url truth flow exclusively over
// the page-bridge message channel the entry created.
import { act, fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolbarPage } from "./toolbar-page";

type MessageHandler = (payload: unknown) => void;

class FakeEndpoint {
  readonly posted: unknown[] = [];
  readonly messageHandlers = new Set<MessageHandler>();
  readonly closeHandlers = new Set<(notice: { reason: string }) => void>();
  readonly id = "channel-1";
  post = vi.fn(async (payload: unknown): Promise<void> => {
    this.posted.push(payload);
  });
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }
  onClose(handler: (notice: { reason: string }) => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }
  close = async (): Promise<void> => {};
  destroy = async (): Promise<void> => {};
  /** Simulate an entry → page push (urlChange truth / get-url answer). */
  push(payload: unknown): void {
    for (const handler of [...this.messageHandlers]) {
      handler(payload);
    }
  }
  simulateClose(): void {
    for (const handler of [...this.closeHandlers]) {
      handler({ reason: "explicit" });
    }
  }
}

/** Install the page-bridge stub; `deliver` hands the page its endpoint. */
const installBridge = (): { readonly deliver: (endpoint: FakeEndpoint) => void } => {
  let created: ((endpoint: FakeEndpoint) => void) | undefined;
  const bridge = {
    id: "toolbar",
    onCreatedMessageChannel: (handler: (endpoint: FakeEndpoint) => void): void => {
      created = handler;
    },
  };
  Object.defineProperty(navigator, "opentrayWebview", {
    value: bridge,
    configurable: true,
  });
  return {
    deliver: (endpoint) => {
      created?.(endpoint);
    },
  };
};

/** Render the strip and connect one endpoint; returns scoped queries. */
const mount = async (): Promise<{
  readonly endpoint: FakeEndpoint;
  readonly bar: () => HTMLInputElement;
  readonly buttons: () => NodeListOf<HTMLButtonElement>;
}> => {
  const bridge = installBridge();
  const { container } = render(<ToolbarPage />);
  const endpoint = new FakeEndpoint();
  await act(async () => {
    bridge.deliver(endpoint);
  });
  return {
    endpoint,
    bar: () => {
      const input = container.querySelector("input");
      if (input === null) throw new Error("address bar not rendered");
      return input;
    },
    buttons: () => container.querySelectorAll("button"),
  };
};

const press = (init: KeyboardEventInit): void => {
  fireEvent(window, new KeyboardEvent("keydown", init));
};

describe("ToolbarPage (channel navigation interface, D12)", () => {
  it("takes address-bar truth from url pushes and answers get-url on connect", async () => {
    const page = await mount();
    // Connect seeds the bar by querying the entry.
    expect(page.endpoint.posted).toContainEqual({ kind: "get-url" });

    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://example.com/a" });
    });
    expect(page.bar().value).toBe("https://example.com/a");

    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://example.com/b" });
    });
    expect(page.bar().value).toBe("https://example.com/b");
  });

  it("posts navigate on Enter with scheme completion", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://example.com/a" });
    });

    fireEvent.change(page.bar(), { target: { value: "news.ycombinator.com" } });
    fireEvent.keyDown(page.bar(), { key: "Enter" });
    expect(page.endpoint.posted).toContainEqual({
      kind: "navigate",
      url: "http://news.ycombinator.com/",
    });
  });

  it("keeps ordinary typing in the address bar from triggering navigation", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://example.com/a" });
    });

    page.bar().focus();
    fireEvent.keyDown(page.bar(), { key: "x" });
    // ⌘← inside the bar is text-caret motion, not history back.
    fireEvent.keyDown(page.bar(), { key: "ArrowLeft", metaKey: true });
    expect(page.endpoint.posted).toEqual([{ kind: "get-url" }]);
  });

  it("sends back/forward/reload shortcuts through the channel", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://example.com/a" });
    });

    press({ key: "ArrowLeft", metaKey: true });
    expect(page.endpoint.posted).toContainEqual({ kind: "back" });

    press({ key: "]", metaKey: true });
    expect(page.endpoint.posted).toContainEqual({ kind: "forward" });

    press({ key: "[", metaKey: true });
    expect(page.endpoint.posted.filter((m) => (m as { kind: string }).kind === "back").length).toBe(2);

    press({ key: "r", metaKey: true });
    expect(page.endpoint.posted).toContainEqual({ kind: "reload" });

    press({ key: "F5" });
    expect(page.endpoint.posted.filter((m) => (m as { kind: string }).kind === "reload").length).toBe(2);
  });

  it("marks the strip disconnected when the channel closes", async () => {
    const page = await mount();
    expect(page.buttons().length).toBeGreaterThan(0);
    expect([...page.buttons()].every((button) => !button.disabled)).toBe(true);

    await act(async () => {
      page.endpoint.simulateClose();
    });
    expect([...page.buttons()].every((button) => button.disabled)).toBe(true);
  });

  it("renders a static disabled strip without the page bridge", async () => {
    Object.defineProperty(navigator, "opentrayWebview", {
      value: undefined,
      configurable: true,
    });
    const { container } = render(<ToolbarPage />);
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(3);
    expect([...buttons].every((button) => button.disabled)).toBe(true);
  });
});

afterEach(cleanup);
