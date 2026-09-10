// Locale catalogs and locale/direction utilities (openspec change
// redesign-create-opentray-webui; full wizard coverage 2026-09-11).
//
// Nine language families: zh-CN, ja, ko, en, ar, fr, es, de, ru. Every
// catalog is a COMPLETE `Messages` object (typed in ./messages) — no
// key-by-key fallback merging, so a locale can never silently render
// English. Initial locale follows a persisted explicit choice, else the
// closest supported system locale, else English. Arabic sets document
// direction RTL; technical islands stay explicitly LTR through .tech-ltr.

import type { Messages } from "./messages";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-cn";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { ar } from "./locales/ar";
import { fr } from "./locales/fr";
import { es } from "./locales/es";
import { de } from "./locales/de";
import { ru } from "./locales/ru";

export const LOCALES = ["zh-CN", "ja", "ko", "en", "ar", "fr", "es", "de", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

export const RTL_LOCALES: readonly Locale[] = ["ar"];

export const localeDirection = (locale: Locale): "ltr" | "rtl" =>
  RTL_LOCALES.includes(locale) ? "rtl" : "ltr";

export const localeLabel = (locale: Locale): string => {
  const labels: Record<Locale, string> = {
    "zh-CN": "简体中文",
    ja: "日本語",
    ko: "한국어",
    en: "English",
    ar: "العربية",
    fr: "Français",
    es: "Español",
    de: "Deutsch",
    ru: "Русский",
  };
  return labels[locale];
};

/** One-or-two-glyph endonym badge per locale (rendered identically in every
 * UI locale — language self-names, like localeLabel, are not translated). */
export const LOCALE_SHORT: Record<Locale, string> = {
  "zh-CN": "中",
  ja: "日",
  ko: "한",
  en: "EN",
  ar: "ع",
  fr: "FR",
  es: "ES",
  de: "DE",
  ru: "RU",
};

/**
 * Interpolate `{name}` tokens in a message. Unknown tokens stay verbatim so a
 * mistranslated placeholder is visible instead of silently dropped.
 */
export const fmt = (
  template: string,
  params: Readonly<Record<string, string | number>>,
): string =>
  template.replace(/\{(\w+)\}/gu, (match, key: string) =>
    Object.hasOwn(params, key) ? String(params[key]) : match,
  );

/** Map a system locale string to the closest supported catalog. */
export const resolveSystemLocale = (system: readonly string[]): Locale => {
  for (const candidate of system) {
    const lower = candidate.toLowerCase();
    const exact = LOCALES.find((locale) => locale.toLowerCase() === lower);
    if (exact !== undefined) return exact;
    const base = lower.split("-")[0]!;
    const prefix = LOCALES.find((locale) => locale.toLowerCase().split("-")[0] === base);
    if (prefix !== undefined) return prefix;
    // zh-TW/zh-HK still map to the zh-CN catalog (closest supported family).
    if (base === "zh") return "zh-CN";
  }
  return "en";
};

const CATALOGS: Record<Locale, Messages> = {
  en,
  "zh-CN": zhCN,
  ja,
  ko,
  ar,
  fr,
  es,
  de,
  ru,
};

export const messagesFor = (locale: Locale): Messages => CATALOGS[locale];

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

export type { Messages };
