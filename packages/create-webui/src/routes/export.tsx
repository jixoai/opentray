// Export/Share dialog (openspec change redesign-create-opentray-webui;
// generalized by wizard-share-and-list-scan and reshaped by owner review:
// script formats only — no direct-command mode; the full artifact lives in
// an expandable accordion with wrapped text; the footer is 复制命令/下载文件).
//
// Scraped web icons default to sharing their http source URL plus the
// icon-generation flags; the inline toggle (shown only when a URL share is
// active) opts into embedding the bytes. Env-bearing shares keep the
// NON-preselected acknowledgement checkbox that blocks copy/download.

import { useEffect, useState } from "react";
import { CopyIcon, DownloadIcon } from "lucide-react";

import { type ExportResponse } from "../api";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../components/ui/accordion";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
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
  readonly format: "sh" | "ps1";
  readonly acknowledgeEnv: boolean;
  readonly inlineIcon: boolean;
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
  const [format, setFormat] = useState<"sh" | "ps1">("sh");
  const [ackEnv, setAckEnv] = useState(false);
  const [inlineIcon, setInlineIcon] = useState(false);
  const [script, setScript] = useState<{ filename: string; content: string; iconSharedAs?: string } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setAckEnv(false);
    setInlineIcon(false);
  }, [open]);

  // 打开即自动生成；格式 / 环境确认 / 内联切换都触发生成。
  useEffect(() => {
    if (!open) {
      setScript(null);
      setBlocked(null);
      return;
    }
    let cancelled = false;
    setBuilding(true);
    setCopied(false);
    setBlocked(null);
    void (async () => {
      // 未确认 env 时服务端会拒绝：本地同样压住生成，勾选后自动重建。
      if (hasEnv && !ackEnv) {
        if (!cancelled) {
          setScript(null);
          setBuilding(false);
        }
        return;
      }
      const response = await runner({ format, acknowledgeEnv: ackEnv, inlineIcon });
      if (cancelled) return;
      setBuilding(false);
      if (response.status === 200) {
        const data = response.data;
        if ("content" in data && data.content !== undefined) {
          setScript({
            filename: data.filename ?? "create-opentray.sh",
            content: data.content,
            ...(data.iconSharedAs === undefined ? {} : { iconSharedAs: data.iconSharedAs }),
          });
        }
        return;
      }
      setScript(null);
      const data = response.data;
      if ("code" in data) {
        setBlocked(`${data.message ?? data.code}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, format, ackEnv, inlineIcon, hasEnv, runner]);

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
    if (script === null) return;
    await navigator.clipboard.writeText(script.content);
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

        <div className="flex gap-2">
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[format]}
            onValueChange={(group: string[]) => {
              const next = group[0];
              if (next === "sh" || next === "ps1") {
                setFormat(next);
              }
            }}
          >
            <ToggleGroupItem value="sh">{messages.export.scriptSh}</ToggleGroupItem>
            <ToggleGroupItem value="ps1">{messages.export.scriptPs1}</ToggleGroupItem>
          </ToggleGroup>
          {building && <span className="text-muted-foreground self-center text-xs">{messages.export.building}</span>}
        </div>

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

        {script?.iconSharedAs === "url" && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="export-inline-icon"
              checked={inlineIcon}
              onCheckedChange={(checked) => setInlineIcon(checked === true)}
            />
            <Label htmlFor="export-inline-icon" className="text-xs leading-snug">
              {messages.export.inlineIcon}
              <span className="text-muted-foreground block">{messages.export.inlineIconHint}</span>
            </Label>
          </div>
        )}

        {blocked !== null && (
          <p className="text-destructive text-xs" role="alert">
            {messages.export.blocked} {blocked}
          </p>
        )}

        {script !== null && (
          <Accordion>
            <AccordionItem value="content">
              <AccordionTrigger className="text-xs">{messages.export.viewFull}</AccordionTrigger>
              <AccordionContent>
                <pre className="tech-ltr bg-muted max-h-72 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap break-all">
                  {script.content}
                </pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.common.close}
          </Button>
          <Button size="sm" variant="outline" disabled={!canEmit || script === null} onClick={() => void copy()}>
            <CopyIcon width={14} height={14} aria-hidden />
            {copied ? messages.common.copied : messages.export.copyCommand}
          </Button>
          <Button size="sm" disabled={!canEmit || script === null} onClick={download}>
            <DownloadIcon width={14} height={14} aria-hidden />
            {messages.export.downloadFile}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
