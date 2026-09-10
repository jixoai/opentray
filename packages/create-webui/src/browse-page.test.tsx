// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/preferences";
import { BrowsePage } from "./browse-page";

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

const renderPage = (): ReturnType<typeof render> =>
  render(
    <PreferencesProvider initialLocale="en" initialTheme="system">
      <BrowsePage />
    </PreferencesProvider>,
  );

const initialSrc = (): string => {
  const frame = document.querySelector("iframe");
  if (frame === null) throw new Error("iframe not rendered");
  return frame.getAttribute("src") ?? "";
};

const navigateBar = (value: string): void => {
  const input = document.querySelector("input");
  if (input === null) throw new Error("address bar not rendered");
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
};

const press = (init: KeyboardEventInit): void => {
  fireEvent(window, new KeyboardEvent("keydown", init));
};

describe("BrowsePage navigation shortcuts (add-create-url-apps D11)", () => {
  it("drives back/forward through the fallback history with ⌘ arrows", () => {
    window.history.replaceState({}, "", "/browse.html?url=http%3A%2F%2F127.0.0.1%2Fa");
    renderPage();
    expect(initialSrc()).toBe("http://127.0.0.1/a");

    navigateBar("http://127.0.0.1/b");
    expect(initialSrc()).toBe("http://127.0.0.1/b");

    press({ key: "ArrowLeft", metaKey: true });
    expect(initialSrc()).toBe("http://127.0.0.1/a");

    press({ key: "ArrowRight", metaKey: true });
    expect(initialSrc()).toBe("http://127.0.0.1/b");

    // ⌘[ / ⌘] mirror the arrows.
    press({ key: "[", metaKey: true });
    expect(initialSrc()).toBe("http://127.0.0.1/a");
  });

  it("reloads the embedded frame on ⌘R and F5", () => {
    window.history.replaceState({}, "", "/browse.html?url=http%3A%2F%2F127.0.0.1%2Fa");
    renderPage();
    navigateBar("http://127.0.0.1/b");
    const frame = document.querySelector("iframe");
    if (frame === null) throw new Error("iframe not rendered");

    press({ key: "r", metaKey: true });
    expect(frame.getAttribute("src")).toBe("http://127.0.0.1/b");

    press({ key: "F5" });
    expect(frame.getAttribute("src")).toBe("http://127.0.0.1/b");
  });

  it("keeps ordinary typing in the address bar untouched", () => {
    window.history.replaceState({}, "", "/browse.html?url=http%3A%2F%2F127.0.0.1%2Fa");
    renderPage();
    navigateBar("http://127.0.0.1/b");
    // 焦点在地址栏内时，普通字符与 ⌘←（文本编辑光标移动）不触发导航。
    const input = document.querySelector("input");
    if (input === null) throw new Error("address bar not rendered");
    fireEvent.keyDown(input, { key: "x" });
    fireEvent.keyDown(input, { key: "ArrowLeft", metaKey: true });
    expect(initialSrc()).toBe("http://127.0.0.1/b");
  });
});
