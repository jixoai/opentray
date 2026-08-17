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
} from "./i18n";

export type ThemeMode = "system" | "light" | "dark";

const LOCALE_KEY = "create-opentray.locale";
const THEME_KEY = "create-opentray.theme";

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

export const resolveThemeClass = (mode: ThemeMode): "theme-light" | "theme-dark" =>
  mode === "system" ? (systemPrefersDark() ? "theme-dark" : "theme-light") : mode === "dark" ? "theme-dark" : "theme-light";

/** Apply locale direction + theme class to <html> (idempotent). */
export const applyDocumentChrome = (locale: Locale, mode: ThemeMode): void => {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = localeDirection(locale);
  const themeClass = resolveThemeClass(mode);
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(themeClass);
  root.style.colorScheme = themeClass === "theme-dark" ? "dark" : "light";
};

/** Pre-paint resolution: runs in main.tsx before React renders. */
export const readInitialPreferences = (): { locale: Locale; theme: ThemeMode } => {
  const storedLocale = readStored(LOCALE_KEY);
  const locale = storedLocale !== null && (storedLocale === "zh-CN" || storedLocale === "ja" || storedLocale === "ko" || storedLocale === "en" || storedLocale === "ar" || storedLocale === "fr" || storedLocale === "es" || storedLocale === "de" || storedLocale === "ru")
    ? storedLocale
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
    writeStored(LOCALE_KEY, next);
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
