// Locale + theme providers (openspec change redesign-create-opentray-webui).
//
// Theme offers exactly system | light | dark. An explicit choice persists;
// system mode observes the OS color scheme live without reload. Initial
// resolution happens before first paint (main.tsx sets the class on <html>).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  localeDirection,
  messagesFor,
  resolveSystemLocale,
  type Locale,
  type Messages,
  LOCALES,
} from "./i18n";

export type ThemeMode = "system" | "light" | "dark";

const LOCALE_KEY = "create-opentray.locale"; // legacy fallback (pre-URL persistence)
const THEME_KEY = "create-opentray.theme";
const LOCALE_PARAM = "lang";

const SUPPORTED_LOCALES = new Set<string>(LOCALES);

/** Read ?lang= from the URL (shared by initial resolution and switching). */
const readLocaleFromUrl = (): string | null => {
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get(LOCALE_PARAM);
    return value !== null && SUPPORTED_LOCALES.has(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * Write ?lang=<locale> into the URL (replaceState: no history pollution).
 * The token query parameter and the hash route are preserved verbatim.
 */
const writeLocaleToUrl = (locale: Locale): void => {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(LOCALE_PARAM, locale);
    window.history.replaceState(null, "", url);
  } catch {
    // history API unavailable; the choice still applies for this session
  }
};

const readStored = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage may be unavailable (embedded contexts); choice stays in-memory
  }
};

const systemPrefersDark = (): boolean =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;

export const resolveThemeClass = (mode: ThemeMode): "dark" | "light" =>
  mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;

/** Apply locale direction + the canonical .dark class to <html> (idempotent). */
export const applyDocumentChrome = (locale: Locale, mode: ThemeMode): void => {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = localeDirection(locale);
  root.classList.toggle("dark", resolveThemeClass(mode) === "dark");
  root.style.colorScheme = resolveThemeClass(mode);
};

/** Pre-paint resolution: runs in main.tsx before React renders. */
export const readInitialPreferences = (): { locale: Locale; theme: ThemeMode } => {
  // Priority: explicit ?lang= in the URL (shareable/deep-linkable) > the
  // previously chosen locale (localStorage) > the OS/browser preference.
  const urlLocaleRaw = readLocaleFromUrl();
  const urlLocale = urlLocaleRaw !== null ? (urlLocaleRaw as Locale) : null;
  const storedLocale = readStored(LOCALE_KEY);
  const locale = urlLocale !== null
    ? urlLocale
    : storedLocale !== null && SUPPORTED_LOCALES.has(storedLocale)
      ? (storedLocale as Locale)
      : resolveSystemLocale(navigator.languages ?? [navigator.language]);
  const storedTheme = readStored(THEME_KEY);
  const theme: ThemeMode =
    storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
      ? storedTheme
      : "system";
  return { locale, theme };
};

interface PreferencesValue {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly direction: "ltr" | "rtl";
  readonly theme: ThemeMode;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeMode) => void;
}

const PreferencesContext = createContext<PreferencesValue | undefined>(undefined);

export const PreferencesProvider = ({
  initialLocale,
  initialTheme,
  children,
}: {
  initialLocale: Locale;
  initialTheme: ThemeMode;
  children: ReactNode;
}): React.JSX.Element => {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [theme, setThemeState] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    applyDocumentChrome(locale, theme);
  }, [locale, theme]);

  // Live OS color-scheme observation in system mode (no reload, no state loss).
  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      applyDocumentChrome(locale, "system");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme, locale]);

  const setLocale = useCallback((next: Locale) => {
    writeLocaleToUrl(next);
    writeStored(LOCALE_KEY, next); // legacy echo: survives a manual ?lang= strip
    setLocaleState(next);
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    writeStored(THEME_KEY, next);
    setThemeState(next);
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      locale,
      messages: messagesFor(locale),
      direction: localeDirection(locale),
      theme,
      setLocale,
      setTheme,
    }),
    [locale, theme, setLocale, setTheme],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

export const usePreferences = (): PreferencesValue => {
  const value = useContext(PreferencesContext);
  if (value === undefined) {
    throw new Error("usePreferences must be used inside PreferencesProvider");
  }
  return value;
};
