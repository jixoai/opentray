// @vitest-environment jsdom
//
// Toolbar-page channel tests (add-webview-orchestration D12/D13): the strip
// holds no iframe; navigation commands and url truth flow exclusively over
// the page-bridge message channel the entry created. The D24/D25 block below
// covers the load-bar state machine (started/progress/finished/failed plus
// the missing-failed convergence path) and the favicon derivation/fallback.
import { act, fireEvent, render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom does not implement matchMedia; the preferences provider's system-theme
// observation path needs it.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}


import { ToolbarPage } from "./toolbar-page";
import { PreferencesProvider } from "@/preferences";

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
  readonly container: () => HTMLElement;
  readonly bar: () => HTMLInputElement;
  readonly buttons: () => NodeListOf<HTMLButtonElement>;
}> => {
  const bridge = installBridge();
  const { container } = render(
      <PreferencesProvider initialLocale="zh-CN" initialTheme="system">
        <ToolbarPage />
      </PreferencesProvider>,
    );
  const endpoint = new FakeEndpoint();
  await act(async () => {
    bridge.deliver(endpoint);
  });
  return {
    endpoint,
    container: () => container,
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
    const { container } = render(
      <PreferencesProvider initialLocale="zh-CN" initialTheme="system">
        <ToolbarPage />
      </PreferencesProvider>,
    );
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(3);
    expect([...buttons].every((button) => button.disabled)).toBe(true);
  });
});

describe("ToolbarPage (load bar state machine, D24)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const loadBar = (container: HTMLElement): HTMLElement | null =>
    container.querySelector('[role="progressbar"]');

  /** The bar's visible segment (sweep or width fill). */
  const fill = (container: HTMLElement): HTMLElement | null =>
    loadBar(container)?.firstElementChild as HTMLElement | null;

  it("raises indeterminate on started, tracks progress frames, flashes finished to full, then settles", async () => {
    const page = await mount();
    // started without progress (Windows shape / pre-estimatedProgress):
    // indeterminate — no aria-valuenow, sweep segment present.
    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "started", url: "https://example.com/a" });
    });
    expect(loadBar(page.container())).not.toBeNull();
    expect(loadBar(page.container())?.getAttribute("aria-valuenow")).toBeNull();
    expect(fill(page.container())?.className).toContain("toolbar-load-indeterminate");

    // Intermediate frames are started frames carrying progress: the bar
    // becomes determinate at the observed fraction.
    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "started", url: "https://example.com/a", progress: 0.3 });
    });
    expect(loadBar(page.container())?.getAttribute("aria-valuenow")).toBe("30");
    expect(fill(page.container())?.style.width).toBe("30%");

    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "started", url: "https://example.com/a", progress: 0.7 });
    });
    expect(loadBar(page.container())?.getAttribute("aria-valuenow")).toBe("70");

    // finished: flash to 100% first (mac finished frames carry progress 1)…
    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "finished", url: "https://example.com/a", progress: 1 });
    });
    expect(loadBar(page.container())?.getAttribute("aria-valuenow")).toBe("100");
    expect(fill(page.container())?.style.width).toBe("100%");

    // …then collapse after the settle window.
    await act(async () => {
      vi.advanceTimersByTime(240);
    });
    expect(loadBar(page.container())).toBeNull();
  });

  it("collapses immediately on failed with no flash and no error color", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "started", url: "https://example.com/a", progress: 0.4 });
    });
    expect(loadBar(page.container())).not.toBeNull();

    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "failed", url: "https://example.com/a", errorCode: -999 });
    });
    expect(loadBar(page.container())).toBeNull();
    // No pending settle timer resurrects anything later.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(loadBar(page.container())).toBeNull();
  });

  it("converges idempotently — terminal frames on an idle bar are no-ops", async () => {
    const page = await mount();
    expect(loadBar(page.container())).toBeNull();

    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "failed", url: "https://example.com/a", errorCode: -999 });
      page.endpoint.push({ kind: "load-state", phase: "finished", url: "https://example.com/a", progress: 1 });
    });
    expect(loadBar(page.container())).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(loadBar(page.container())).toBeNull();
  });

  it("heals a missing failed frame via the honest finished (macOS dead-port about:blank path)", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "started", url: "http://127.0.0.1:1/x" });
    });
    expect(loadBar(page.container())).not.toBeNull();

    // WebKit commits about:blank and finishes honestly; failed never comes.
    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "finished", url: "about:blank", progress: 1 });
    });
    await act(async () => {
      vi.advanceTimersByTime(240);
    });
    expect(loadBar(page.container())).toBeNull();
  });

  it("cancels the pending collapse when a new started lands inside the settle window", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "started", url: "https://example.com/a" });
      page.endpoint.push({ kind: "load-state", phase: "finished", url: "https://example.com/a", progress: 1 });
    });
    await act(async () => {
      vi.advanceTimersByTime(100); // inside the 240ms flash window
    });
    expect(loadBar(page.container())).not.toBeNull();

    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "started", url: "https://example.com/b" });
    });
    await act(async () => {
      vi.advanceTimersByTime(1000); // old settle must NOT collapse the new load
    });
    expect(loadBar(page.container())).not.toBeNull();

    await act(async () => {
      page.endpoint.push({ kind: "load-state", phase: "finished", url: "https://example.com/b", progress: 1 });
    });
    await act(async () => {
      vi.advanceTimersByTime(240);
    });
    expect(loadBar(page.container())).toBeNull();
  });
});

describe("ToolbarPage (favicon origin fetch + fallback, D25)", () => {
  const faviconImg = (container: HTMLElement): HTMLImageElement | null =>
    container.querySelector("img");

  const glyph = (container: HTMLElement): HTMLElement | null =>
    container.querySelector('[aria-label="站点图标回落"]');

  const globe = (container: HTMLElement): HTMLElement | null =>
    container.querySelector('[aria-label="站点图标占位"]');

  it("derives the favicon src from the committed url's origin and follows url pushes", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://news.ycombinator.com/item?id=1" });
    });
    expect(faviconImg(page.container())?.getAttribute("src")).toBe("https://news.ycombinator.com/favicon.ico");

    await act(async () => {
      page.endpoint.push({ kind: "url", url: "http://127.0.0.1:8123/app" });
    });
    expect(faviconImg(page.container())?.getAttribute("src")).toBe("http://127.0.0.1:8123/favicon.ico");
  });

  it("transient address-bar typing never moves the favicon", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://news.ycombinator.com/" });
    });
    fireEvent.change(page.bar(), { target: { value: "http://elsewhere.example/x" } });
    expect(faviconImg(page.container())?.getAttribute("src")).toBe("https://news.ycombinator.com/favicon.ico");
  });

  it("falls back to the hostname letter glyph when the image errors, and retries per navigation", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://news.ycombinator.com/" });
    });
    fireEvent.error(faviconImg(page.container())!);
    expect(faviconImg(page.container())).toBeNull();
    expect(glyph(page.container())?.textContent).toBe("N");

    // A navigation to a new origin retries the image (src remount).
    await act(async () => {
      page.endpoint.push({ kind: "url", url: "https://example.org/" });
    });
    expect(faviconImg(page.container())?.getAttribute("src")).toBe("https://example.org/favicon.ico");
    expect(glyph(page.container())).toBeNull();

    fireEvent.error(faviconImg(page.container())!);
    expect(glyph(page.container())?.textContent).toBe("E");
  });

  it("keeps the globe placeholder for non-http(s) or unparseable targets", async () => {
    const page = await mount();
    await act(async () => {
      page.endpoint.push({ kind: "url", url: "about:blank" });
    });
    expect(faviconImg(page.container())).toBeNull();
    expect(glyph(page.container())).toBeNull();
    expect(globe(page.container())).not.toBeNull();
  });
});

afterEach(cleanup);
