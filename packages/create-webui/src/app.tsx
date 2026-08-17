/** create-opentray wizard page: command bar + tabs panel + identity form. */
import * as React from "react";

import { AppConfigCard } from "@/components/app-config-card";
import { CommandCard } from "@/components/command-card";
import { CreateDialog } from "@/components/create-dialog";
import { TabsPanel, type IframeTab, type TerminalStatusBarState } from "@/components/tabs-panel";
import {
  createGhosttyTerminal,
  prewarmGhostty,
  type TerminalHandle,
} from "@/components/terminal-pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  api,
  hostnameOf,
  iconDataUrl,
  openEventStream,
  type DiscoveredService,
  type IconCandidate,
  type WizardEvent,
  type WizardFormDefaults,
  type WizardFormValues,
  DEFAULT_COMMAND_OPTIONS,
  type WizardCommandOptions,
  type WizardState,
} from "@/wizard-protocol";

const EMPTY_VALUES: WizardFormValues = {
  appId: "",
  appName: "",
  iconPath: "",
  trayIconPath: "",
  force: false,
  pm: "npm",
  showStartupTerminal: false,
  showAddressBar: false,
};
const EMPTY_DEFAULTS: WizardFormDefaults = { appId: "", appName: "", targetDir: "" };

export function App(): React.JSX.Element {
  const [command, setCommand] = React.useState("");
  const [argv, setArgv] = React.useState<string[]>([]);
  const [commandOptions, setCommandOptions] = React.useState<WizardCommandOptions>(
    DEFAULT_COMMAND_OPTIONS,
  );
  const [defaultCwd, setDefaultCwd] = React.useState("");
  const [targetDirExists, setTargetDirExists] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [runAlive, setRunAlive] = React.useState(false);
  const [wizardState, setWizardState] = React.useState<WizardState>("idle");
  const [failReason, setFailReason] = React.useState<string | undefined>();
  const [displayCommand, setDisplayCommand] = React.useState("");
  const [interactive, setInteractive] = React.useState(true);
  const [termReady, setTermReady] = React.useState(false);
  const [termFallback, setTermFallback] = React.useState<string | undefined>();
  const [values, setValues] = React.useState<WizardFormValues>(EMPTY_VALUES);
  const [defaults, setDefaults] = React.useState<WizardFormDefaults>(EMPTY_DEFAULTS);
  const [services, setServices] = React.useState<readonly DiscoveredService[]>([]);
  const [selectedPort, setSelectedPort] = React.useState<number | undefined>();
  const [hasScrapedIcon, setHasScrapedIcon] = React.useState(false);
  const [iconCandidates, setIconCandidates] = React.useState<IconCandidate[]>([]);
  const [iconCandidatesPort, setIconCandidatesPort] = React.useState<number | undefined>();
  const [selectedIconRef, setSelectedIconRef] = React.useState<string | undefined>();
  const [uploadedIconUrl, setUploadedIconUrl] = React.useState<string | undefined>();
  const [selectedTrayRef, setSelectedTrayRef] = React.useState<string | undefined>();
  const [uploadedTrayUrl, setUploadedTrayUrl] = React.useState<string | undefined>();
  const [activeTab, setActiveTab] = React.useState("terminal");
  const [iframeTabs, setIframeTabs] = React.useState<IframeTab[]>([]);
  const [status, setStatus] = React.useState<TerminalStatusBarState>({
    cursorX: 0,
    cursorY: 0,
    cols: 0,
    rows: 0,
  });
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogPhase, setDialogPhase] = React.useState<
    "confirm" | "pending" | "success" | "failed"
  >("confirm");
  const [dialogLogs, setDialogLogs] = React.useState<string[]>([]);
  const [currentStep, setCurrentStep] = React.useState("");
  const [dialogError, setDialogError] = React.useState<string | undefined>();
  const [result, setResult] = React.useState<
    { projectDir: string; bundlePath?: string; pinHint: string } | undefined
  >();
  const [frozenValues, setFrozenValues] = React.useState<WizardFormValues>(EMPTY_VALUES);

  const terminalHostRef = React.useRef<HTMLDivElement>(null);
  const terminalRef = React.useRef<TerminalHandle | undefined>(undefined);
  /** Chunks that arrived before the renderer was ready, flushed in order. */
  const pendingOutputRef = React.useRef<string[]>([]);
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const stateRef = React.useRef(wizardState);
  stateRef.current = wizardState;

/** Whether the tracked selection no longer exists in the latest candidates. */
const selectedIconRefStale = (
  icons: readonly IconCandidate[],
  ref: string | undefined,
  port: number,
): boolean => {
  if (ref === undefined) return false;
  const index = Number.parseInt(ref.split(":")[1] ?? "", 10);
  return !icons.some((icon) => icon.index === index) || ref.split(":")[0] !== String(port);
};

  // ---- ghostty prewarm: module + WASM load at page load, before any Run ----
  React.useEffect(() => {
    prewarmGhostty();
  }, []);

  // ---- ghostty terminal mount (host element exists once the panel opens) ----
  React.useEffect(() => {
    if (!panelOpen) return;
    let disposed = false;
    void (async () => {
      const host = terminalHostRef.current;
      if (host === null) return;
      const handle = await createGhosttyTerminal(host);
      if (disposed || handle === undefined) {
        if (!disposed) setTermFallback("ghostty-web 加载失败，输出将以纯文本显示");
        return;
      }
      terminalRef.current = handle;
      setTermReady(true);
      // Flush anything that arrived while the renderer was loading.
      const pending = pendingOutputRef.current;
      pendingOutputRef.current = [];
      for (const chunk of pending) handle.write(chunk);
      handle.onData((data) => {
        if (interactiveRef.current) void api("/api/terminal-input", { data });
      });
      handle.onResize(({ cols, rows }) => {
        void api("/api/terminal-resize", { cols, rows });
      });
      // Status bar refresh: cursor/selection polling + on-demand reads.
      const interval = window.setInterval(() => {
        if (stateRef.current === "idle" && !terminalRef.current) return;
        try {
          setStatus(handle.readState());
        } catch {
          // terminal mid-dispose
        }
      }, 300);
      return () => window.clearInterval(interval);
    })();
    return () => {
      disposed = true;
      terminalRef.current?.dispose();
      terminalRef.current = undefined;
    };
  }, [panelOpen]);

  const interactiveRef = React.useRef(true);
  React.useEffect(() => {
    interactiveRef.current = interactive;
  }, [interactive]);

  // ---- SSE event stream ----
  React.useEffect(() => {
    const source = openEventStream();
    source.onmessage = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as WizardEvent;
      switch (payload.type) {
        case "state":
          setWizardState(payload.state);
          if (payload.state === "failed") setFailReason(payload.reason);
          if (payload.state === "frozen") {
            setDialogPhase("confirm");
            setDialogOpen(true);
          }
          if (payload.state === "materializing") {
            setDialogPhase("pending");
            setDialogLogs([]);
          }
          if (payload.state === "success") setDialogPhase("success");
          if (payload.state === "failed" && dialogOpenRef.current) {
            setDialogPhase("failed");
            setDialogError(payload.reason);
          }
          break;
        case "log": {
          // Objective passthrough: write exactly what arrived. Until the
          // renderer is live, buffer instead of dropping.
          if (terminalRef.current !== undefined) {
            terminalRef.current.write(payload.chunk);
          } else if (termFallbackRef.current !== undefined) {
            setTermFallback((prev) => (prev ?? "") + payload.chunk);
          } else {
            pendingOutputRef.current.push(payload.chunk);
          }
          break;
        }
        case "term-mode":
          setInteractive(payload.interactive);
          if (!payload.interactive && payload.message !== undefined) {
            const notice = `\u001b[33m${payload.message}\u001b[0m\r\n`;
            if (terminalRef.current !== undefined) {
              terminalRef.current.write(notice);
            } else {
              pendingOutputRef.current.push(notice);
            }
          }
          break;
        case "run-status":
          setRunAlive(payload.running);
          break;
        case "command-display":
          setDisplayCommand(payload.command);
          break;
        case "command-options":
          setCommandOptions(payload.options);
          setDefaultCwd(payload.defaultCwd);
          break;
        case "services": {
          setServices(payload.services);
          setSelectedPort(payload.selectedPort);
          // One iframe tab per confirmed service (TCP + HTTP verified).
          setIframeTabs((previous) => {
            const next = [...previous];
            let added: number | undefined;
            for (const service of payload.services) {
              const existing = next.find((tab) => tab.port === service.port);
              if (existing === undefined) {
                next.push({
                  port: service.port,
                  url: service.url,
                  history: [service.url],
                  historyIndex: 0,
                });
                added = service.port;
              }
            }
            if (added !== undefined) {
              // A newly sniffed service opens its tab and takes focus.
              setActiveTab(`svc-${added}`);
            }
            return next;
          });
          break;
        }
        case "icons":
          setIconCandidates(payload.icons);
          setIconCandidatesPort(payload.port);
          // Server-side selection reset: revert to the default candidate.
          if (selectedIconRefStale(payload.icons, selectedIconRef, payload.port)) {
            setSelectedIconRef(undefined);
          }
          break;
        case "scrape":
          setHasScrapedIcon(payload.hasIcon);
          break;
        case "form":
          setValues(payload.values);
          setDefaults(payload.defaults);
          setTargetDirExists(payload.targetDirExists);
          break;
        case "materialize-step":
          setCurrentStep(payload.step);
          setDialogLogs((prev) => [...prev, `[${payload.step}] ${payload.message}`]);
          break;
        case "materialize-log":
          setDialogLogs((prev) => [...prev, payload.message]);
          break;
        case "success":
          setResult({
            projectDir: payload.projectDir,
            ...(payload.bundlePath === undefined ? {} : { bundlePath: payload.bundlePath }),
            pinHint: payload.pinHint,
          });
          break;
      }
    };
    return () => source.close();
  }, []);

  const termFallbackRef = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    termFallbackRef.current = termFallback;
  }, [termFallback]);
  const dialogOpenRef = React.useRef(false);
  React.useEffect(() => {
    dialogOpenRef.current = dialogOpen;
  }, [dialogOpen]);

  // Resolved icon for the confirm/success dialog.
  const selectedCandidateIndex =
    selectedIconRef === undefined ? undefined : Number.parseInt(selectedIconRef.split(":")[1] ?? "", 10);
  const dialogIconSrc =
    uploadedIconUrl !== undefined
      ? uploadedIconUrl
      : iconCandidatesPort !== undefined && selectedCandidateIndex !== undefined && iconCandidates.some((c) => c.index === selectedCandidateIndex)
        ? iconDataUrl(iconCandidatesPort, selectedCandidateIndex)
        : iconCandidatesPort !== undefined && iconCandidates[0] !== undefined && selectedIconRef === undefined
          ? iconDataUrl(iconCandidatesPort, iconCandidates[0].index)
          : undefined;
  const dialogIconLabel =
    uploadedIconUrl !== undefined
      ? "本地图片"
      : iconCandidates[0] !== undefined
        ? `${iconCandidates[0].width}×${iconCandidates[0].height} ${iconCandidates[0].format.toUpperCase()}`
        : "首字母图标";

  // ---- actions ----
  const running = wizardState === "running" || wizardState === "discovered";
  // The form is the core flow: usable from idle, before any command runs.
  const showForm = true;
  React.useEffect(() => {
    const trimmed = command.trim();
    if (trimmed.length === 0) return;
    const timer = window.setTimeout(() => {
      void api("/api/prime", { command: trimmed });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [command]);

  const runCommand = async (): Promise<void> => {
    const trimmed = command.trim();
    if (commandOptions.argsMode === "string" && trimmed.length === 0) return;
    // Instant feedback: open the panel (and reset the terminal) before the
    // POST round-trip or any output event.
    setPanelOpen(true);
    setActiveTab("terminal");
    terminalRef.current?.reset();
    setIframeTabs([]);
    setServices([]);
    setHasScrapedIcon(false);
    setIconCandidates([]);
    setIconCandidatesPort(undefined);
    setSelectedIconRef(undefined);
    setUploadedIconUrl(undefined);
    setSelectedTrayRef(undefined);
    setUploadedTrayUrl(undefined);
    if (commandOptions.argsMode === "array") {
      if (argv.length === 0 || (argv[0] ?? "").trim().length === 0) return;
      await api("/api/command", { argv });
      return;
    }
    await api("/api/command", { command: trimmed });
  };

  const jumpToService = (port: number): void => {
    const tab = iframeTabs.find((candidate) => candidate.port === port);
    if (tab === undefined) {
      // Not confirmed yet: the click just notes the port; no tab to open.
      void api("/api/select-service", { port });
      return;
    }
    void api("/api/select-service", { port });
    setActiveTab(`svc-${port}`);
  };

  const navigateIframe = (port: number, url: string, mode: "push" | "replace"): void => {
    setIframeTabs((previous) =>
      previous.map((tab) => {
        if (tab.port !== port) return tab;
        if (mode === "replace") {
          return { ...tab, url };
        }
        const history = [...tab.history.slice(0, tab.historyIndex + 1), url];
        return { ...tab, url, history, historyIndex: history.length - 1 };
      }),
    );
  };

  const moveHistory = (port: number, delta: -1 | 1): void => {
    setIframeTabs((previous) =>
      previous.map((tab) => {
        if (tab.port !== port) return tab;
        const index = tab.historyIndex + delta;
        if (index < 0 || index >= tab.history.length) return tab;
        return { ...tab, historyIndex: index, url: tab.history[index] as string };
      }),
    );
  };

  const confirmCreate = async (): Promise<void> => {
    try {
      await api("/api/confirm", {});
    } catch {
      // state event will surface the reason
    }
  };
  React.useEffect(() => {
    if (wizardState === "frozen") {
      setFrozenValues(valuesRef.current);
    }
  }, [wizardState]);

  const createApp = async (): Promise<void> => {
    await api("/api/create", {});
  };

  const stateBadge =
    wizardState === "discovered" || wizardState === "success"
      ? "success"
      : wizardState === "running" || wizardState === "materializing"
        ? "warning"
        : wizardState === "failed"
          ? "destructive"
          : "secondary";

  // Grid-driven list→detail transition (owner round-11): the page is ONE
  // grid whose template columns animate from a centered single column to
  // "list + detail" — the browser interpolates the column sizes, so the list
  // pane glides from center to left while the detail pane grows in.
  // Column plan: closed = [edge | list(center) | edge]; open = [list | detail | 0].
  // The list and detail live in FIXED tracks (1 and 2) so the browser only
  // animates track WIDTHS between the two states — the modern grid-template
  // interpolation the owner asked for.
  const gridTemplate = panelOpen
    ? "minmax(0, 520px) minmax(0, 1fr) minmax(0, 0fr)"
    : "minmax(0, 1fr) minmax(0, var(--list-w)) minmax(0, 1fr)";

  return (
    <div
      className="grid h-screen w-full overflow-hidden"
      style={{
        // --list-w caps the centered list at the mobile width (with page
        // padding) and drives the closed-state middle column.
        ["--list-w" as string]: "min(520px, 100vw - 40px)",
        gridTemplateColumns: gridTemplate,
        transition: "grid-template-columns 450ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* List pane: the stable main view at mobile width, independently
          scrollable; the detail pane appearing never shifts it. */}
      <div
        className={
          "flex w-full flex-col gap-4 overflow-y-auto p-5 max-md:min-h-screen " +
          (panelOpen ? "md:border-r md:border-border" : "")
        }
        style={{
          gridColumn: panelOpen ? "1" : "2",
          gridRow: "1",
          transition: "border-color 450ms",
          // Reserve the gutter so the scrollbar appearing/disappearing never
          // shifts the pane content (thin scrollbars take layout room).
          scrollbarGutter: "stable",
        }}
      >
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-bold">create-opentray</h1>
        <Badge variant={stateBadge} className="ml-auto shrink-0">
          {wizardState}
        </Badge>
      </header>

      {/* Card 1 — command + 命令选项 accordion inside */}
      <CommandCard
        command={command}
        onCommandChange={setCommand}
        argv={argv}
        onArgvChange={(tags) => setArgv([...tags])}
        runAlive={runAlive}
        frozen={wizardState === "materializing" || wizardState === "frozen" || wizardState === "success"}
        failedReason={wizardState === "failed" ? failReason : undefined}
        commandOptions={commandOptions}
        defaultCwd={defaultCwd}
        onCommandOptionsChange={(next) => {
          setCommandOptions(next);
          void api("/api/command-options", {
            cwd: next.cwd,
            env: next.env,
            argsMode: next.argsMode,
          });
        }}
        onRun={() => void runCommand()}
        onStop={() => void api("/api/stop", {})}
      />

      {/* Card 2 — 应用配置: identity form + merged 高级选项 */}
      <AppConfigCard
        frozen={wizardState === "frozen" || wizardState === "materializing" || wizardState === "success"}
        values={values}
        defaults={defaults}
        candidates={iconCandidates}
        candidatesPort={iconCandidatesPort}
        selectedIconRef={selectedIconRef}
        uploadedIconUrl={uploadedIconUrl}
        selectedTrayRef={selectedTrayRef}
        uploadedTrayUrl={uploadedTrayUrl}
        selectedPort={selectedPort}
        targetDirExists={targetDirExists}
        onPickIconCandidate={(candidate) => {
          if (iconCandidatesPort === undefined) return;
          setSelectedIconRef(`${iconCandidatesPort}:${candidate.index}`);
          setUploadedIconUrl(undefined);
          void api("/api/icon-select", {
            port: iconCandidatesPort,
            index: candidate.index,
          });
        }}
        onUploadIcon={(file) => {
          const preview = URL.createObjectURL(file);
          setUploadedIconUrl(preview);
          setSelectedIconRef(undefined);
          void file.arrayBuffer().then((buffer) => {
            void fetch("/api/icon-upload", {
              method: "POST",
              headers: {
                "content-type": file.type || "application/octet-stream",
                authorization: `Bearer ${new URLSearchParams(location.search).get("token") ?? ""}`,
              },
              body: buffer,
            })
              .then((response) => response.json() as Promise<{ path?: string }>)
              .then(({ path }) => {
                if (path === undefined || path.length === 0) return;
                setValues((previous) => ({ ...previous, iconPath: path }));
              })
              .catch(() => undefined);
          });
        }}
        onClearIcon={() => {
          setSelectedIconRef(undefined);
          setUploadedIconUrl(undefined);
          setValues((previous) => ({ ...previous, iconPath: "" }));
          void api("/api/form", { iconPath: "" });
        }}
        onPickTray={(candidate) => {
          if (iconCandidatesPort === undefined) return;
          setSelectedTrayRef(`${iconCandidatesPort}:${candidate.index}`);
          setUploadedTrayUrl(undefined);
          void api("/api/tray-icon-select", {
            port: iconCandidatesPort,
            index: candidate.index,
          });
        }}
        onUploadTray={(file) => {
          const preview = URL.createObjectURL(file);
          setUploadedTrayUrl(preview);
          setSelectedTrayRef(undefined);
          void file.arrayBuffer().then((buffer) => {
            void fetch("/api/icon-upload", {
              method: "POST",
              headers: {
                "content-type": file.type || "application/octet-stream",
                authorization: `Bearer ${new URLSearchParams(location.search).get("token") ?? ""}`,
              },
              body: buffer,
            })
              .then((response) => response.json() as Promise<{ path?: string }>)
              .then(({ path }) => {
                if (path === undefined || path.length === 0) return;
                setValues((previous) => ({ ...previous, trayIconPath: path }));
                void api("/api/form", { trayIconPath: path });
              })
              .catch(() => undefined);
          });
        }}
        onClearTray={() => {
          setSelectedTrayRef(undefined);
          setUploadedTrayUrl(undefined);
          setValues((previous) => ({ ...previous, trayIconPath: "" }));
          void api("/api/form", { trayIconPath: "" });
        }}
        onPatch={(patch) => {
          setValues((previous) => ({ ...previous, ...patch }));
          void api("/api/form", patch);
        }}
        onConfirm={() => void confirmCreate()}
      />
      </div>

      {/* Detail pane: lives in the second grid column. The column itself
          animates from 0fr; content mounts only once a command starts so the
          terminal/iframe state still resets between runs. */}
      <div
        className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-4 max-md:hidden"
        style={{
          scrollbarGutter: "stable",
          gridColumn: panelOpen ? "2" : "3",
          gridRow: "1",
          opacity: panelOpen ? 1 : 0,
          visibility: panelOpen ? "visible" : "hidden",
          transition: "opacity 450ms cubic-bezier(0.4, 0, 0.2, 1), visibility 0s linear " + (panelOpen ? "0s" : "450ms"),
        }}
      >
        {panelOpen ? (
          <>
            <TabsPanel
              command={displayCommand}
              terminalHostRef={terminalHostRef}
              terminalReady={termReady}
              interactive={interactive}
              status={status}
              services={[...services]}
              iframeTabs={iframeTabs}
              activeTab={activeTab}
              onActiveTabChange={setActiveTab}
              onIframeNavigate={navigateIframe}
              onIframeHistoryMove={moveHistory}
              onJumpToService={jumpToService}
              className="min-h-[480px] flex-1"
            />
            {termFallback !== undefined ? (
              <pre className="max-h-56 overflow-auto rounded-xl border border-border bg-card p-3 font-mono text-xs whitespace-pre-wrap">
                {termFallback}
              </pre>
            ) : null}
          </>
        ) : null}
      </div>

      <CreateDialog
        open={dialogOpen}
        phase={dialogPhase}
        frozenValues={frozenValues}
        iconSrc={dialogIconSrc}
        iconLabel={dialogIconLabel}
        selectedPort={selectedPort}
        currentStep={currentStep}
        logs={dialogLogs}
        error={dialogError ?? failReason}
        result={result}
        onBack={() => setDialogOpen(false)}
        onCreate={() => void createApp()}
        onOpenApp={() => void api("/api/open-app", {})}
      />
    </div>
  );
}
