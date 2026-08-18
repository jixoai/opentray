// Export/Share dialog (openspec change redesign-create-opentray-webui;
// generalized by wizard-share-and-list-scan: the same artifact flow serves
// listed applications (key-addressed export) and the wizard's frozen
// parameters (pre-create share)).
//
// Script export is the DEFAULT for uploaded resources; direct copy requires
// the explicit force-copy override. Env-bearing exports show an editable
// review plus a NON-preselected disclaimer checkbox that blocks complete
// copy/download until acknowledged — with no secret heuristics.

import { useEffect, useState } from "react";
import { CopyIcon, DownloadIcon } from "lucide-react";

import { type ExportResponse } from "../api";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { usePreferences } from "../preferences";

export interface ExportRunnerOptions {
  readonly format: "command" | "sh" | "ps1";
  readonly acknowledgeEnv: boolean;
  readonly forceCopy: boolean;
}

/** Artifact runner: list rows call the key-addressed export; the wizard
 * confirm panel calls the frozen-parameter share endpoint. */
export type ExportRunner = (
  options: ExportRunnerOptions,
) => Promise<{
  readonly status: number;
  readonly data: ExportResponse | { readonly code: string; readonly message?: string };
}>;

export interface ExportDialogProps {
  readonly open: boolean;
  readonly subtitle: string;
  readonly hasEnv: boolean;
  /** Share mode titles the dialog 分享应用 and notes that nothing runs. */
  readonly share?: boolean;
  readonly runner: ExportRunner;
  readonly onClose: () => void;
}

export const ExportDialog = ({
  open,
  subtitle,
  hasEnv,
  share = false,
  runner,
  onClose,
}: ExportDialogProps): React.JSX.Element => {
  const { messages } = usePreferences();
  const [format, setFormat] = useState<"command" | "sh" | "ps1">("sh");
  const [forceCopy, setForceCopy] = useState(false);
  const [ackEnv, setAckEnv] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [script, setScript] = useState<{ filename: string; content: string } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCommand(null);
    setScript(null);
    setBlocked(null);
    setCopied(false);
    setAckEnv(false);
  }, [open, format]);

  const build = async (): Promise<void> => {
    if (!open) return;
    setCopied(false);
    setCommand(null);
    setScript(null);
    setBlocked(null);
    const response = await runner({
      format,
      acknowledgeEnv: ackEnv,
      forceCopy,
    });
    if (response.status === 200) {
      const data = response.data;
      if ("command" in data && data.command !== undefined) {
        setCommand(data.command);
      } else if ("content" in data && data.content !== undefined) {
        setScript({ filename: data.filename ?? "create-opentray.sh", content: data.content });
      }
      return;
    }
    const data = response.data;
    if ("code" in data) {
      setBlocked(`${data.message ?? data.code}`);
    }
  };

  const canEmit = !hasEnv || ackEnv;
  const download = (): void => {
    if (script === null) return;
    const blob = new Blob([script.content], {
      type: format === "sh" ? "text/x-shellscript" : "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = script.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copy = async (): Promise<void> => {
    const text = command ?? script?.content ?? null;
    if (text === null) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <Dialog open={open} onOpenChange={(open_) => { if (!open_) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{share ? messages.export.shareTitle : messages.export.title}</DialogTitle>
          <DialogDescription>
            <span className="tech-ltr block truncate">{subtitle}</span>
            {share && (
              <span className="text-muted-foreground mt-1 block text-xs">{messages.export.shareSubtitle}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label={messages.export.title} className="flex gap-2">
          {(
            [
              ["command", messages.export.command],
              ["sh", messages.export.scriptSh],
              ["ps1", messages.export.scriptPs1],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={format === value}
              className={`flex-1 rounded-md border px-3 py-2 text-xs ${
                format === value ? "border-primary bg-primary text-primary-foreground" : "border-border"
              }`}
              onClick={() => {
                setFormat(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {format === "command" && (
          <div className="space-y-1">
            <div className="flex items-start gap-2">
              <Checkbox id="export-force-copy" checked={forceCopy} onCheckedChange={(checked) => setForceCopy(checked === true)} />
              <Label htmlFor="export-force-copy" className="text-xs leading-snug">
                {messages.export.forceCopy}
                <span className="text-muted-foreground block">{messages.export.forceCopyHint}</span>
              </Label>
            </div>
          </div>
        )}

        {hasEnv && (
          <div className="border-warning rounded-md border p-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="export-env-ack"
                checked={ackEnv}
                onCheckedChange={(checked) => setAckEnv(checked === true)}
              />
              <Label htmlFor="export-env-ack" className="text-xs leading-snug">
                {messages.export.envAck}
                <span className="text-muted-foreground block">{messages.export.envAckHint}</span>
              </Label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.common.close}
          </Button>
          <Button disabled={!canEmit} onClick={() => void build()}>
            {share ? messages.export.shareTitle : messages.export.title}
          </Button>
        </DialogFooter>

        {blocked !== null && (
          <p className="text-destructive text-xs" role="alert">
            {messages.export.blocked} {blocked}
          </p>
        )}

        {command !== null && (
          <div className="space-y-2">
            <pre className="tech-ltr bg-muted max-h-40 overflow-auto rounded-md p-2 text-xs">{command}</pre>
            <Button size="sm" onClick={() => void copy()}>
              <CopyIcon width={14} height={14} aria-hidden />
              {copied ? messages.common.copied : messages.export.copyCommand}
            </Button>
          </div>
        )}

        {script !== null && (
          <div className="space-y-2">
            <pre className="tech-ltr bg-muted max-h-40 overflow-auto rounded-md p-2 text-xs">{script.content.slice(0, 2_000)}</pre>
            <div className="flex gap-2">
              <Button size="sm" onClick={download}>
                <DownloadIcon width={14} height={14} aria-hidden />
                {messages.export.downloadScript}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                <CopyIcon width={14} height={14} aria-hidden />
                {copied ? messages.common.copied : messages.common.copy}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
