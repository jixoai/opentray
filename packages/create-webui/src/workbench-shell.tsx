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
import { useHashLocation } from "wouter/use-hash-location";
import { CircleHelpIcon, ListIcon, MonitorIcon, MoonIcon, PanelLeftIcon, PlusIcon, SunIcon } from "lucide-react";

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
  useSidebar,
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

/**
 * Routes (wouter hash history):
 *   /add                default: the creation workflow (edit param optional)
 *   /applications       registration list
 *   /help               help center
 * Unknown paths fall back to /add — the default route is the workflow.
 */
export const WORKBENCH_ROUTES = ["/add", "/applications", "/help"] as const;

interface NavigationValue {
  readonly route: WorkbenchRoute;
  navigate: (route: WorkbenchRoute) => void;
}

const NavigationContext = createContext<NavigationValue | undefined>(undefined);

/** Route hooks co-located with the shell (single wouter instance). */
export const useWorkbenchRoute = (): { readonly route: WorkbenchRoute; readonly query: URLSearchParams } => {
  const [location] = useHashLocation();
  const query = useMemo(() => new URLSearchParams(location.split("?")[1] ?? ""), [location]);
  const route = (location.split("?")[0] ?? "/add").replace(/^\/?/u, "");
  const resolved: WorkbenchRoute =
    route === "applications" || route === "help" ? route : "add";
  return { route: resolved, query };
};

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

/**
 * Header row: [logo] [title] ... [toggle] when expanded; when collapsed
 * only the logo shows and hovering it swaps in the toggle button.
 */
/**
 * Sidebar header row.
 *  - expanded: [logo] [title] ······················· [toggle button]
 *    (the button is a persistent right-aligned element, always visible)
 *  - collapsed: only [logo]; hovering the logo swaps in the toggle button
 */
const SidebarBrandRow = ({ product }: { product: string }): React.JSX.Element => {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const label = `${product} · ${collapsed ? "展开" : "收起"}`;

  if (collapsed) {
    return (
      <SidebarMenuButton size="lg" className="group/brand relative justify-center">
        {/* Logo fades out on hover; the absolutely-positioned toggle fades in. */}
        <span className="relative grid size-8 shrink-0 place-items-center">
          <img
            src="/logo.png"
            alt={product}
            width={24}
            height={24}
            className="size-6 rounded-md transition-opacity group-hover/brand:opacity-0 focus-visible-within:opacity-0"
          />
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={label}
            title={label}
            className="absolute inset-0 grid place-items-center rounded-md opacity-0 transition-opacity hover:bg-sidebar-accent focus-visible:opacity-100 group-hover/brand:opacity-100"
          >
            <PanelLeftIcon aria-hidden className="size-4" />
          </button>
        </span>
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuButton size="lg" className="justify-start pr-1">
      <img
        src="/logo.png"
        alt={product}
        width={24}
        height={24}
        className="size-6 shrink-0 rounded-md"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{product}</span>
      {/* Persistent right-aligned collapse control. */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={label}
        title={label}
        className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-sidebar-accent"
      >
        <PanelLeftIcon aria-hidden className="size-4" />
      </button>
    </SidebarMenuButton>
  );
};

export const WorkbenchShell = ({
  children,
  panelOpen,
}: {
  children: ReactNode;
  /** Detail pane visibility: when the detail opens the sidebar collapses. */
  panelOpen?: boolean;
}): React.JSX.Element => {
  const { locale, messages, setLocale, theme, setTheme } = usePreferences();
  const { route } = useWorkbenchRoute();

  const navigate = useCallback((next: WorkbenchRoute) => {
    window.location.hash = `#/${next}`;
  }, []);

  // Auto expand/collapse:
  //  - non-mobile width → expanded, mobile width → collapsed
  //  - the detail pane being open forces collapsed (it needs the room)
  // The user's explicit toggle still wins until one of these facts change.
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => window.innerWidth >= 768);
  const detailOpen = panelOpen === true;

  useEffect(() => {
    const nonMobile = window.matchMedia("(min-width: 768px)");
    const apply = (): void => {
      setSidebarOpen(nonMobile.matches && !detailOpen);
    };
    apply();
    nonMobile.addEventListener("change", apply);
    return () => nonMobile.removeEventListener("change", apply);
  }, [detailOpen]);

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
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarBrandRow product={messages.shell.product} />
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
          {children}
        </main>
      </SidebarProvider>
    </NavigationContext.Provider>
  );
};
