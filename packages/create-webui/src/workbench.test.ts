import { describe, expect, it } from "vitest";

import {
  LOCALES,
  localeDirection,
  messagesFor,
  resolveSystemLocale,
  type Locale,
} from "./i18n";
import { renderMarkdown } from "./routes/help";

describe("i18n catalogs", () => {
  it("ships all nine language families with complete catalogs", () => {
    expect(LOCALES).toEqual(["zh-CN", "ja", "ko", "en", "ar", "fr", "es", "de", "ru"]);
    for (const locale of LOCALES) {
      const messages = messagesFor(locale);
      expect(messages.nav.add.length, locale).toBeGreaterThan(0);
      expect(messages.applications.uninstallTitle.length, locale).toBeGreaterThan(0);
      expect(messages.export.envAck.length, locale).toBeGreaterThan(0);
    }
  });

  it("resolves system locales to the closest supported catalog", () => {
    expect(resolveSystemLocale(["en-US"])).toBe("en");
    expect(resolveSystemLocale(["zh-TW", "en"])).toBe("zh-CN");
    expect(resolveSystemLocale(["ja-JP"])).toBe("ja");
    expect(resolveSystemLocale(["fr-FR"])).toBe("fr");
    expect(resolveSystemLocale(["xx-YY"])).toBe("en");
    expect(resolveSystemLocale([])).toBe("en");
  });

  it("marks only Arabic as RTL", () => {
    for (const locale of LOCALES) {
      expect(localeDirection(locale as Locale)).toBe(locale === "ar" ? "rtl" : "ltr");
    }
  });
});

describe("markdown renderer", () => {
  it("renders the strict subset and escapes raw HTML", () => {
    const html = renderMarkdown("# Title\n\nplain **bold** `code`\n\n- a\n- b\n\n<script>alert(1)</script>");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html.replace(/\n/gu, "")).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps unsafe link schemes inert", () => {
    const html = renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("x");
  });

  it("renders fenced code blocks as LTR technical islands", () => {
    const html = renderMarkdown("```sh\nnpx create-opentray skill\n```");
    expect(html).toContain('<pre class="tech-ltr"><code>');
    expect(html).toContain("npx create-opentray skill");
  });
});
