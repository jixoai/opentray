// i18n integrity gates (full wizard coverage, 2026-09-11):
// 1. Every locale catalog is complete (same key tree as `en`, no empty leaf).
// 2. Placeholder tokens `{...}` are identical across locales — a translated
//    string that drops or renames a token renders verbatim `{foo}` at runtime.
// 3. No untranslated copies of English except the documented technical
//    allowlist (product name, pipeline step tokens).
// 4. No hardcoded CJK string literals outside the catalogs — new UI strings
//    must go through src/i18n (comments in Chinese are repo convention and
//    stay allowed; the scan matches quoted literals only).

import { describe, expect, it } from "vitest";

import { LOCALES, messagesFor, type Messages } from "./i18n";

/** Flatten a catalog to dot-paths → string leaves. */
const flatten = (node: unknown, prefix = ""): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      out[path] = value;
    } else {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
};

const EN = flatten(messagesFor("en"));

const placeholdersOf = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]!).sort();

/**
 * Values that legitimately stay identical to English in every locale:
 * proper nouns and the materialize pipeline step tokens (they mirror the
 * server's step ids and appear in logs).
 */
const TECHNICAL_ALLOWLIST: readonly string[] = [
  "shell.product",
  "dialog.stepScaffold",
  "dialog.stepIcon",
  "dialog.stepInstall",
  "dialog.macosBundle",
];

/**
 * Per-locale cognate collisions: the correct target-language word happens to
 * spell identically to English (e.g. German "Terminal", French "Version").
 * Every entry was adjudicated during the translation pass; anything new
 * failing this gate must be justified here explicitly.
 */
const COGNATE_ALLOWLIST: Partial<Record<Exclude<import("./i18n").Locale, "en">, string[]>> = {
  "zh-CN": ["family.runner"],
  ja: [],
  ko: ["family.runner"],
  ar: [],
  fr: [
    "family.runner",
    "family.version",
    "icon.modelStandard",
    "icon.bgTransparent",
    "icon.bgNameTransparent",
    "tabs.terminal",
    "nav.applications",
    "applications.title",
    "help.listTitle",
    "applications.source",
    "applications.payload",
  ],
  es: [
    "family.runner",
    "tabs.terminal",
    "tabs.cursor",
    "command.modeArray",
    "applications.payload",
  ],
  de: [
    "family.runner",
    "family.version",
    "icon.modelStandard",
    "icon.bgTransparent",
    "icon.bgNameTransparent",
    "tabs.terminal",
    "tabs.cursor",
    "theme.system",
    "dialog.textTray",
    "command.modeArray",
    "family.namePreview",
    "applications.details",
    "applications.payload",
  ],
  ru: ["family.runner", "applications.payload"],
};

describe("i18n catalogs (full wizard coverage)", () => {
  it("ships all nine language families", () => {
    expect(LOCALES).toEqual(["zh-CN", "ja", "ko", "en", "ar", "fr", "es", "de", "ru"]);
  });

  for (const locale of LOCALES) {
    it(`${locale}: complete key tree, non-empty leaves, preserved placeholders`, () => {
      const leaves = flatten(messagesFor(locale));
      expect(Object.keys(leaves).sort()).toEqual(Object.keys(EN).sort());
      for (const [path, value] of Object.entries(leaves)) {
        expect(value.length, `${locale}.${path}`).toBeGreaterThan(0);
        expect(placeholdersOf(value), `${locale}.${path}`).toEqual(placeholdersOf(EN[path]!));
      }
    });

    if (locale !== "en") {
      it(`${locale}: no untranslated English outside the adjudicated allowlists`, () => {
        const allowed = [...TECHNICAL_ALLOWLIST, ...(COGNATE_ALLOWLIST[locale] ?? [])];
        const leaves = flatten(messagesFor(locale));
        const untranslated = Object.entries(leaves)
          .filter(([path, value]) => value === EN[path] && !allowed.includes(path))
          .map(([path]) => path);
        expect(untranslated).toEqual([]);
      });
    }
  }
});

describe("hardcoded-string gate", () => {
  // All of src is scanned (vite ?raw imports); only these paths are exempt:
  //  - src/i18n/**            the catalogs themselves
  //  - src/prototypes/**      design prototypes, not shipped
  //  - src/lib/command-family.ts  golden-mirror of @create-opentray/core (its
  //                               constants never render directly; the UI maps
  //                               `custom` through familyLabel)
  //  - *.test.*               zh-CN assertions against the catalog are intended
  const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const EXEMPT_PATHS = (path: string): boolean =>
    path.includes("/i18n/") ||
    path.includes("/prototypes/") ||
    path.endsWith("lib/command-family.ts") ||
    /\.test\.[jt]sx?$/.test(path);

  it("has no CJK string literals outside the catalogs (comments excepted)", () => {
    const offenders: string[] = [];
    for (const [file, source] of Object.entries(SOURCES)) {
      if (EXEMPT_PATHS(file)) continue;
      const lines = source.split("\n");
      lines.forEach((line: string, index: number) => {
        // Strip line comments (repo convention writes Chinese comments); the
        // remaining quoted segments must not carry CJK.
        const code = line.replace(/(^|\s)\/\/.*$/u, "");
        if (/["'`][^"'`\n]*[\u3400-\u9fff][^"'`\n]*["'`]/u.test(code)) {
          offenders.push(`${file.replace("../", "src/")}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("exercises Messages typing through every locale (compile-time contract)", () => {
    // Runtime smoke: each catalog resolves the deepest wizard keys.
    for (const locale of LOCALES) {
      const messages: Messages = messagesFor(locale);
      expect(messages.advanced.serviceNone.length).toBeGreaterThan(0);
      expect(messages.icon.extractingDownload).toContain("{percent}");
      expect(messages.dialog.portSelected).toContain("{port}");
      expect(messages.family.namePreview).toContain("{dir}");
    }
  });
});
