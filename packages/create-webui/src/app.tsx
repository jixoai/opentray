/** create-opentray wizard page: command bar + tabs panel + identity form. */
import { Play, Square } from "lucide-react";
import * as React from "react";

import { AppForm } from "@/components/app-form";
import { CreateDialog } from "@/components/create-dialog";
import { TabsPanel, type IframeTab, type TerminalStatusBarState } from "@/components/tabs-panel";
import {
  createGhosttyTerminal,
  type TerminalHandle,
} from "@/components/terminal-pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  api,
  hostnameOf,
  openEventStream,
  type DiscoveredService,
  type WizardEvent,
  type WizardFormDefaults,
  type WizardFormValues,
  type WizardState,
} from "@/wizard-protocol";

const EMPTY_VALUES: WizardFormValues = {
  appId: "",
  appName: "",
  iconPath: "",
  servicePort: "",
  targetDir: "",
  pm: "npm",
};
const EMPTY_DEFAULTS: WizardFormDefaults = { appId: "", appName: "", targetDir: "" };

export function App(): React.JSX.Element {
  const [command, setCommand] = React.useState("");
  const [panelOpen, setPanelOpen] = React.useState(false);
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
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const stateRef = React.useRef(wizardState);
  stateRef.current = wizardState;

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
          // Objective passthrough: write exactly what arrived.
          if (terminalRef.current !== undefined) {
            terminalRef.current.write(payload.chunk);
          } else if (termFallbackRef.current !== undefined) {
            setTermFallback((prev) => (prev ?? "") + payload.chunk);
          }
          break;
        }
        case "term-mode":
          setInteractive(payload.interactive);
          if (!payload.interactive && payload.message !== undefined) {
            terminalRef.current?.write(
              `\u001b[33m${payload.message}\u001b[0m\r\n`,
            );
          }
          break;
        case "command-display":
          setDisplayCommand(payload.command);
          break;
        case "services": {
          setServices(payload.services);
          setSelectedPort(payload.selectedPort);
          // One iframe tab per confirmed service (TCP + HTTP verified).
          setIframeTabs((previous) => {
            const next = [...previous];
            for (const service of payload.services) {
              const existing = next.find((tab) => tab.port === service.port);
              if (existing === undefined) {
                next.push({
                  port: service.port,
                  url: service.url,
                  history: [service.url],
                  historyIndex: 0,
                });
              }
            }
            return next;
          });
          break;
        }
        case "scrape":
          setHasScrapedIcon(payload.hasIcon);
          break;
        case "form":
          setValues(payload.values);
          setDefaults(payload.defaults);
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

  // ---- actions ----
  const running = wizardState === "running" || wizardState === "discovered";
  const manualPort = (() => {
    const parsed = Number.parseInt(values.servicePort, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : undefined;
  })();
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
    if (trimmed.length === 0) return;
    // Instant feedback: open the panel (and reset the terminal) before the
    // POST round-trip or any output event.
    setPanelOpen(true);
    setActiveTab("terminal");
    terminalRef.current?.reset();
    setIframeTabs([]);
    setServices([]);
    setHasScrapedIcon(false);
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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 p-5">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-bold">create-opentray</h1>
        <span className="text-xs text-muted-foreground">
          把任意启动命令打包成 OpenTray 托管的本地应用
        </span>
        <Badge variant={stateBadge} className="ml-auto">
          {wizardState}
        </Badge>
      </header>

      {/* Command bar */}
      <div className="flex gap-2">
        <Input
          className="font-mono"
          placeholder="npx somecommand start --xx"
          value={command}
          disabled={running}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !running) void runCommand();
          }}
        />
        <Button disabled={running} onClick={() => void runCommand()}>
          <Play />
          运行
        </Button>
        <Button
          variant="outline"
          disabled={!running}
          onClick={() => void api("/api/stop", {})}
        >
          <Square />
          停止
        </Button>
      </div>
      {wizardState === "failed" && failReason !== undefined ? (
        <p className="font-mono text-xs text-red-400">{failReason}</p>
      ) : null}

      {/* Tabs panel (terminal + service previews) */}
      {panelOpen ? (
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
        />
      ) : null}
      {termFallback !== undefined ? (
        <pre className="max-h-56 overflow-auto rounded-xl border border-border bg-card p-3 font-mono text-xs whitespace-pre-wrap">
          {termFallback}
        </pre>
      ) : null}

      {/* Identity form */}
      {showForm ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <AppForm
            values={values}
            defaults={defaults}
            frozen={wizardState === "frozen" || wizardState === "materializing" || wizardState === "success"}
            hasScrapedIcon={hasScrapedIcon}
            onPatch={(patch) => {
              setValues((previous) => ({ ...previous, ...patch }));
              void api("/api/form", patch);
            }}
          />
          <div className="mt-4 flex items-center gap-3">
            <Button
              disabled={manualPort === undefined && selectedPort === undefined}
              onClick={() => void confirmCreate()}
            >
              确定创建应用
            </Button>
            <span className="text-xs text-muted-foreground">
              {manualPort !== undefined
                ? `将使用手动端口 :${manualPort}`
                : selectedPort !== undefined
                  ? `已选服务 :${selectedPort}（点击状态栏服务可切换）`
                  : "可先运行命令嗅探端口，或直接在表单中手动填写端口"}
            </span>
          </div>
        </section>
      ) : null}

      <CreateDialog
        open={dialogOpen}
        phase={dialogPhase}
        frozenValues={frozenValues}
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
