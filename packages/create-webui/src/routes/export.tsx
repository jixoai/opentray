// Export/Share dialog (openspec change redesign-create-opentray-webui;
// generalized by wizard-share-and-list-scan and reshaped by owner reviews:
// script formats only, auto-build, expandable highlighted artifact, footer
// 复制命令/下载文件 — the top-right X is the only close affordance).
//
// Scraped web icons default to sharing their http source URL plus the
// icon-generation flags; the inline toggle (sticky once a URL share is seen,
// so unchecking always works) opts into embedding the bytes. Env-bearing
// shares keep the NON-preselected acknowledgement that blocks copy/download.

import { useEffect, useRef, useState } from "react";
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
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { usePreferences } from "../preferences";

export interface ExportRunnerOptions {
  readonly format: "sh" | "ps1";
  readonly acknowledgeEnv: boolean;
  /** true=内嵌字节；false=按引用；缺省=按来源默认（URL 引用/本地内嵌）。 */
  readonly inlineIcon?: boolean;
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
};

// ─── 轻量 sh/ps1 高亮（自产脚本结构已知，不引高亮库） ─────────────────────
const KEYWORDS = new Set(["npx", "create-opentray", "create", "set"]);

const classNames = {
  comment: "text-muted-foreground italic",
  keyword: "text-emerald-600 dark:text-emerald-400 font-medium",
  flag: "text-sky-600 dark:text-sky-400",
  string: "text-amber-700 dark:text-amber-300 break-all",
  env: "text-violet-600 dark:text-violet-400",
  variable: "text-rose-600 dark:text-rose-400",
} as const;

const renderUnquoted = (text: string, keyPrefix: string): React.ReactNode[] => {
  const parts = text.split(/(\$[A-Za-z_][A-Za-z0-9_]*)/g);
  return parts.map((part, index) =>
    part.startsWith("$")
      ? <span key={`${keyPrefix}-v${index}`} className={classNames.variable}>{part}</span>
      : <span key={`${keyPrefix}-p${index}`}>{part}</span>,
  );
};

const renderLine = (line: string, key: number): React.ReactNode => {
  if (line.startsWith("#")) {
    return <span className={classNames.comment}>{line}</span>;
  }
  // 逐个引号段分类；未引用部分只挑 $变量着色。
  const segments = line.split(/('(?:[^']|'\\'')*')/g);
  return segments.map((segment, index) => {
    const segmentKey = `${key}-s${index}`;
    if (!segment.startsWith("'")) {
      return <span key={segmentKey}>{renderUnquoted(segment, segmentKey)}</span>;
    }
    const inner = segment.slice(1, -1);
    if (KEYWORDS.has(inner)) {
      return <span key={segmentKey} className={classNames.keyword}>{segment}</span>;
    }
    if (inner.startsWith("--")) {
      return <span key={segmentKey} className={classNames.flag}>{segment}</span>;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(inner)) {
      return <span key={segmentKey} className={classNames.env}>{segment}</span>;
    }
    return <span key={segmentKey} className={classNames.string}>{segment}</span>;
  });
};

const HighlightedScript = ({ content }: { content: string }): React.JSX.Element => (
  <pre className="tech-ltr bg-muted max-h-72 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap break-words">
    {content.split("\n").map((line, index) => (
      <div key={index}>{line.length === 0 ? "\u00a0" : renderLine(line, index)}</div>
    ))}
  </pre>
);

interface ScriptArtifact {
  readonly filename: string;
  readonly content: string;
  readonly commandLine?: string;
  readonly iconReference?: "url" | "local" | "none";
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
  // 三态：null=未定（首建按来源默认，不发 inlineIcon）；true/false=用户选择。
  const [inlineIcon, setInlineIcon] = useState<boolean | null>(null);
  const [script, setScript] = useState<ScriptArtifact | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);

  // runner 走 ref：外层箭头函数每渲染都是新引用，进依赖会无限重发请求。
  const runnerRef = useRef(runner);
  runnerRef.current = runner;

  useEffect(() => {
    setAckEnv(false);
    setInlineIcon(null);
  }, [open]);

  // 打开即自动生成；格式 / 环境确认 / 内联切换才触发生成。
  useEffect(() => {
    if (!open) {
      setScript(null);
      setBlocked(null);
      return;
    }
    // 未确认 env 时服务端会拒绝：本地同样压住生成，勾选后自动重建。
    if (hasEnv && !ackEnv) {
      setScript(null);
      setBuilding(false);
      return;
    }
    let cancelled = false;
    setBuilding(true);
    setCopied(false);
    setBlocked(null);
    void (async () => {
      const response = await runnerRef.current({
        format,
        acknowledgeEnv: ackEnv,
        ...(inlineIcon === null ? {} : { inlineIcon }),
      });
      if (cancelled) return;
      setBuilding(false);
      if (response.status === 200) {
        const data = response.data;
        if ("content" in data && data.content !== undefined) {
          // 首建后同步开关默认态：实际是内嵌 → 勾选；按引用 → 不勾选。
          if (inlineIcon === null && data.iconSharedAs !== undefined) {
            setInlineIcon(data.iconSharedAs === "embedded");
          }
          setScript({
            filename: data.filename ?? "create-opentray.sh",
            content: data.content,
            ...(data.commandLine === undefined ? {} : { commandLine: data.commandLine }),
            ...(data.iconReference === undefined ? {} : { iconReference: data.iconReference }),
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
  }, [open, format, ackEnv, inlineIcon, hasEnv]);

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
    // 复制命令 = 核心调用行（跳过注释与内联图标的临时文件脚手架）。
    await navigator.clipboard.writeText(script.commandLine ?? script.content);
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

        {script?.iconReference !== undefined && script.iconReference !== "none" && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="export-inline-icon"
              checked={inlineIcon === true}
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
                <HighlightedScript content={script.content} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={!canEmit || script === null} onClick={() => void copy()}>
            <CopyIcon width={14} height={14} aria-hidden />
            {copied ? messages.common.copied : messages.export.copyCommand}
          </Button>
          <Button size="sm" disabled={!canEmit || script === null} onClick={download}>
            <DownloadIcon width={14} height={14} aria-hidden />
            {messages.export.downloadFile}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
