// Workbench shell (openspec change redesign-create-opentray-webui).
//
// Persistent left (logical-start) navigation with Add / Applications / Help
// routes; language and theme controls sit at the bottom of the nav. Routes
// are hash-based (deep-linkable inside the token-guarded session, history
// preserved). RTL mirrors the navigation; every icon-only control carries a
// tooltip + accessible name.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CircleHelpIcon, ListIcon, MonitorIcon, MoonIcon, PlusIcon, SunIcon } from "lucide-react";

import { Button } from "./components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";
import { LOCALES, localeLabel, type Locale } from "./i18n";
import { usePreferences, type ThemeMode } from "./preferences";

export type WorkbenchRoute = "add" | "applications" | "help";

const routeFromHash = (hash: string): WorkbenchRoute => {
  const clean = hash.replace(/^#\/?/u, "").split("?")[0] ?? "";
  if (clean === "applications" || clean === "help" || clean === "add") {
    return clean;
  }
  return "add"; // default route: the actual creation workflow
};

interface NavigationValue {
  readonly route: WorkbenchRoute;
  navigate: (route: WorkbenchRoute) => void;
}

const NavigationContext = createContext<NavigationValue | undefined>(undefined);

export const useWorkbenchNavigation = (): NavigationValue => {
  const value = useContext(NavigationContext);
  if (value === undefined) {
    throw new Error("useWorkbenchNavigation must be used inside WorkbenchShell");
  }
  return value;
};

const NavButton = ({
  route,
  icon,
  label,
}: {
  route: WorkbenchRoute;
  icon: ReactNode;
  label: string;
}): React.JSX.Element => {
  const { route: current, navigate } = useWorkbenchNavigation();
  const active = current === route;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="wb-nav-item"
            aria-current={active ? "page" : undefined}
            aria-label={label}
            onClick={() => {
              navigate(route);
            }}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export const WorkbenchShell = ({ children }: { children: ReactNode }): React.JSX.Element => {
  const { locale, messages, setLocale, theme, setTheme } = usePreferences();
  const [route, setRoute] = useState<WorkbenchRoute>(() => routeFromHash(window.location.hash));

  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(routeFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: WorkbenchRoute) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
  }, []);

  const navigation = useMemo<NavigationValue>(() => ({ route, navigate }), [route, navigate]);

  return (
    <NavigationContext.Provider value={navigation}>
      <div className="flex h-full w-full">
        <nav className="wb-nav" aria-label={messages.nav.add}>
          <img
            src="logo.png"
            alt="create-opentray"
            width={28}
            height={28}
            className="mb-2 shrink-0 rounded-md"
          />
          <NavButton route="add" icon={<PlusIcon width={18} height={18} aria-hidden />} label={messages.nav.add} />
          <NavButton route="applications" icon={<ListIcon width={18} height={18} aria-hidden />} label={messages.nav.applications} />
          <NavButton route="help" icon={<CircleHelpIcon width={18} height={18} aria-hidden />} label={messages.nav.help} />

          <div className="mt-auto flex flex-col items-center gap-1">
            <Select
              value={locale}
              onValueChange={(value) => {
                setLocale(value as Locale);
              }}
            >
              <SelectTrigger aria-label={messages.language.title} className="w-9 justify-center px-0">
                <span aria-hidden className="text-xs font-semibold">
                  {locale === "zh-CN" ? "中" : locale === "ja" ? "日" : locale === "ko" ? "한" : locale === "ar" ? "ع" : locale === "en" ? "EN" : locale === "fr" ? "FR" : locale === "es" ? "ES" : locale === "de" ? "DE" : "RU"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((supported) => (
                  <SelectItem key={supported} value={supported}>
                    {localeLabel(supported)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="wb-nav-item"
                    aria-label={`${messages.theme.title}: ${theme === "system" ? messages.theme.system : theme === "light" ? messages.theme.light : messages.theme.dark}`}
                    onClick={() => {
                      const order: ThemeMode[] = ["system", "light", "dark"];
                      const next = order[(order.indexOf(theme) + 1) % order.length]!;
                      setTheme(next);
                    }}
                  />
                }
              >
                {theme === "light" ? (
                  <SunIcon width={18} height={18} aria-hidden />
                ) : theme === "dark" ? (
                  <MoonIcon width={18} height={18} aria-hidden />
                ) : (
                  <MonitorIcon width={18} height={18} aria-hidden />
                )}
              </TooltipTrigger>
              <TooltipContent>{messages.theme.title}: {theme === "system" ? messages.theme.system : theme === "light" ? messages.theme.light : messages.theme.dark}</TooltipContent>
            </Tooltip>
          </div>
        </nav>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </NavigationContext.Provider>
  );
};

export { Button };
