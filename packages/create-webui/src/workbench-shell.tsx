// Workbench shell (openspec change redesign-create-opentray-webui).
//
// Built on the REAL shadcn Sidebar component (base-nova registry): rail
// navigation with Add / Applications / Help, product logo in the header,
// language + theme controls in the footer. Routes are hash-based
// (deep-linkable inside the token-guarded session, history preserved).
// RTL mirrors the navigation; every icon-only control carries a tooltip +
// accessible name.

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

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

const LOCALE_SHORT: Record<Locale, string> = {
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

  const navItems: readonly { route: WorkbenchRoute; icon: ReactNode; label: string }[] = [
    { route: "add", icon: <PlusIcon aria-hidden />, label: messages.nav.add },
    { route: "applications", icon: <ListIcon aria-hidden />, label: messages.nav.applications },
    { route: "help", icon: <CircleHelpIcon aria-hidden />, label: messages.nav.help },
  ];

  const themeLabel =
    theme === "system" ? messages.theme.system : theme === "light" ? messages.theme.light : messages.theme.dark;

  return (
    <NavigationContext.Provider value={navigation}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg">
                  <img
                    src="/logo.png"
                    alt="create-opentray"
                    width={24}
                    height={24}
                    className="size-6 shrink-0 rounded-md"
                  />
                  <span className="text-sm font-semibold">{messages.shell.product}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.route}>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <SidebarMenuButton
                              isActive={route === item.route}
                              tooltip={item.label}
                              aria-label={item.label}
                              onClick={() => {
                                navigate(item.route);
                              }}
                            />
                          }
                        >
                          {item.icon}
                          <span>{item.label}</span>
                        </TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton tooltip={messages.language.title} aria-label={messages.language.title}>
                        <span aria-hidden className="text-xs font-semibold">
                          {LOCALE_SHORT[locale]}
                        </span>
                        <span>{messages.language.title}</span>
                      </SidebarMenuButton>
                    }
                  />
                  <DropdownMenuContent side="top" align="start">
                    {LOCALES.map((supported) => (
                      <DropdownMenuItem
                        key={supported}
                        onClick={() => {
                          setLocale(supported);
                        }}
                      >
                        {localeLabel(supported)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton
                        tooltip={`${messages.theme.title}: ${themeLabel}`}
                        aria-label={`${messages.theme.title}: ${themeLabel}`}
                      >
                        {theme === "light" ? (
                          <SunIcon aria-hidden />
                        ) : theme === "dark" ? (
                          <MoonIcon aria-hidden />
                        ) : (
                          <MonitorIcon aria-hidden />
                        )}
                        <span>{themeLabel}</span>
                      </SidebarMenuButton>
                    }
                  />
                  <DropdownMenuContent side="top" align="start">
                    {(
                      [
                        ["system", messages.theme.system],
                        ["light", messages.theme.light],
                        ["dark", messages.theme.dark],
                      ] as const
                    ).map(([value, label]) => (
                      <DropdownMenuItem
                        key={value}
                        onClick={() => {
                          setTheme(value as ThemeMode);
                        }}
                      >
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail aria-label={messages.shell.toggleSidebar} />
        </Sidebar>
        <main className="relative flex min-h-svh min-w-0 flex-1 flex-col overflow-hidden">
          <SidebarTrigger className="absolute start-2 top-2 z-10" />
          {children}
        </main>
      </SidebarProvider>
    </NavigationContext.Provider>
  );
};
