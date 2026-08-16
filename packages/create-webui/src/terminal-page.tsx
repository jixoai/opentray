/**
 * Dedicated terminal window for a generated app: the wizard's terminal-page
 * components on their own — command bar on top, ghostty PTY stream, status
 * bar (cursor/size/listened ports with detach marks) at the bottom.
 */
import { Terminal as TerminalIcon } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
  createGhosttyTerminal,
  prewarmGhostty,
  type TerminalHandle,
} from "@/components/terminal-pane";

interface ShellService {
  port: number;
  detached?: boolean;
}

type ShellEvent =
  | {
      type: "state";
      command: string;
      interactive: boolean;
      services: ShellService[];
      output: string[];
    }
  | { type: "log"; chunk: string }
  | { type: "services"; services: ShellService[] };

export function TerminalPage(): React.JSX.Element {
  const [command, setCommand] = React.useState("");
  const [interactive, setInteractive] = React.useState(false);
  const [services, setServices] = React.useState<ShellService[]>([]);
  const [status, setStatus] = React.useState({ cursorX: 0, cursorY: 0, cols: 0, rows: 0 });

  const hostRef = React.useRef<HTMLDivElement>(null);
  const terminalRef = React.useRef<TerminalHandle | undefined>(undefined);
  const pendingRef = React.useRef<string[]>([]);
  const interactiveRef = React.useRef(false);

  React.useEffect(() => {
    prewarmGhostty();
  }, []);

  React.useEffect(() => {
    let disposed = false;
    void (async () => {
      const host = hostRef.current;
      if (host === null) return;
      const handle = await createGhosttyTerminal(host);
      if (disposed || handle === undefined) return;
      terminalRef.current = handle;
      handle.onData((data) => {
        if (!interactiveRef.current) return;
        void fetch("/api/terminal-input", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data }),
        }).catch(() => undefined);
      });
      const pending = pendingRef.current;
      pendingRef.current = [];
      for (const chunk of pending) handle.write(chunk);
      const timer = window.setInterval(() => {
        try {
          setStatus(handle.readState());
        } catch {
          /* mid-dispose */
        }
      }, 300);
      return () => window.clearInterval(timer);
    })();
    return () => {
      disposed = true;
      terminalRef.current?.dispose();
      terminalRef.current = undefined;
    };
  }, []);

  React.useEffect(() => {
    const write = (chunk: string): void => {
      const handle = terminalRef.current;
      if (handle !== undefined) handle.write(chunk);
      else pendingRef.current.push(chunk);
    };
    const source = new EventSource("/api/events");
    source.onmessage = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ShellEvent;
      if (payload.type === "state") {
        setCommand(payload.command);
        interactiveRef.current = payload.interactive;
        setInteractive(payload.interactive);
        setServices(payload.services);
        for (const chunk of payload.output) write(chunk);
      } else if (payload.type === "log") {
        write(payload.chunk);
      } else {
        setServices(payload.services);
      }
    };
    return () => source.close();
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Command bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs text-muted-foreground">
          {command || "…"}
        </span>
        {!interactive ? (
          <span className="ml-auto shrink-0 text-[10px] text-amber-400">非交互</span>
        ) : null}
      </div>
      {/* PTY stream */}
      <div ref={hostRef} className="min-h-0 flex-1 bg-[#05070b] px-1" />
      {/* Status bar: cursor, size, ports with detach marks */}
      <div className="flex h-8 shrink-0 items-center gap-3 overflow-x-auto border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
        <span className="font-mono whitespace-nowrap">
          光标 {status.cursorY}:{status.cursorX}
        </span>
        <span className="font-mono whitespace-nowrap">
          {status.cols}×{status.rows}
        </span>
        <span className="h-3 w-px bg-border" />
        {services.length === 0 ? (
          <span>监听端口嗅探中…</span>
        ) : (
          services.map((service) => (
            <Badge
              key={service.port}
              variant={service.detached ? "destructive" : "secondary"}
              className="font-mono whitespace-nowrap"
            >
              :{service.port}
              {service.detached ? " · detached" : ""}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
