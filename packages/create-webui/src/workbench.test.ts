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
    // The href is never emitted; the source renders as escaped literal text.
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<a ");
    expect(html).toContain("x");
  });

  it("renders fenced code blocks as LTR technical islands", () => {
    const html = renderMarkdown("```sh\nnpx create-opentray skill\n```");
    expect(html).toContain('<pre class="tech-ltr"><code class="language-sh">');
    expect(html).toContain("npx create-opentray skill");
  });
});

describe("markdown tables", () => {
  it("renders pipe tables as real table elements", () => {
    const html = renderMarkdown(
      "| Option | Meaning |\n| ------ | ------- |\n| `--pm` | package manager |\n| `--exec` | executable |",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Option</th>");
    expect(html).toContain("<code>--pm</code>");
    expect(html).not.toContain("| ------ |");
  });

  it("keeps non-table content intact", () => {
    const html = renderMarkdown("# T\n\nplain | pipe in text is fine\n\n- item");
    expect(html).toContain("<h1>T</h1>");
  });
});

describe("markdown parser correctness", () => {
  it("joins soft-wrapped lines into one paragraph", () => {
    const html = renderMarkdown("first line\nsecond line of the same paragraph");
    expect(html).toContain("<p>first line\nsecond line of the same paragraph</p>");
    expect(html.match(/<p>/gu)).toHaveLength(1);
  });

  it("renders escaped pipes in table cells as literal pipes", () => {
    // GFM: | inside code spans must be escaped as \| — markdown-it honors it
    // (the hand-written renderer split cells on every raw pipe).
    const html = renderMarkdown("| flag | meaning |\n| --- | --- |\n| `a\\|b` | union flag |");
    expect(html).toContain("<code>a|b</code>");
    expect(html).toContain("union flag");
    expect((html.match(/<td>/gu) ?? []).length).toBe(2);
  });

  it("renders nested lists and blockquotes", () => {
    const html = renderMarkdown("- a\n  - a1\n- b\n\n> quoted");
    expect(html.replace(/\n/gu, "")).toContain("<li>a<ul><li>a1</li></ul></li>");
    expect(html).toContain("<blockquote>");
  });

  it("autolinks bare URLs through the safe-scheme filter", () => {
    const html = renderMarkdown("see https://example.com/docs");
    expect(html).toContain('<a href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
  });
});

describe("yaml front matter", () => {
  it("renders --- metadata as a yaml code fence, never as hr/headings", () => {
    const html = renderMarkdown("---\nname: my-skill\ndescription: some guide\n---\n\n# Title\n\nbody");
    expect(html).toContain('<code class="language-yaml">');
    expect(html).toContain("name: my-skill");
    // the raw failure modes are gone
    expect(html).not.toContain("<hr>");
    expect(html).not.toContain("<h2>name:");
    // body still renders after the block
    expect(html).toContain("<h1>Title</h1>");
  });

  it("leaves documents without front matter untouched", () => {
    const html = renderMarkdown("# Just a title\n\nbody");
    expect(html).toContain("<h1>Just a title</h1>");
    expect(html).not.toContain("language-yaml");
  });

  it("keeps horizontal rules elsewhere working", () => {
    const html = renderMarkdown("a\n\n---\n\nb");
    expect(html).toContain("<hr>");
  });
});
