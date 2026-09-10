/**
 * OpenTray identity form. Auto-derived defaults live in placeholders; an
 * empty input means "use the default" and confirmation resolves them. The
 * icon row is a square file picker plus clickable scraped candidates ranked
 * by clarity (full row — not a text input).
 */
import { Upload } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { SubjectExtractionSettings } from "@/subject-extraction";
import {
  composedIconUrl,
  iconDataUrl,
  type IconAnalysis,
  type IconBackground,
  type IconCandidate,
  type IconComposition,
  type WizardFormDefaults,
  type WizardFormValues,
} from "@/wizard-protocol";

interface AppFormProps {
  values: WizardFormValues;
  defaults: WizardFormDefaults;
  frozen: boolean;
  /** Scraped candidates for the selected service (clarity-ranked). */
  iconCandidates: IconCandidate[];
  /** Port the candidates were scraped from (thumbnail endpoint scope). */
  iconCandidatesPort: number | undefined;
  /** Scrape generation (thumbnail cache buster + extraction generations). */
  iconCandidatesGeneration: number;
  /** Local preview object URL for an uploaded icon. */
  uploadedIconUrl: string | undefined;
  /** Selection reference: `port:index` when a candidate is picked. */
  selectedIconRef: string | undefined;
  /** Icon composition (owner round-12): analysis, preview, background, scale. */
  iconAnalysis: IconAnalysis | undefined;
  iconComposition: IconComposition | undefined;
  iconComposeError: string | undefined;
  iconBackground: IconBackground;
  iconScale: number;
  /** True while the browser-side AI subject extraction is running. */
  subjectExtracting: boolean;
  /** Spinner label while extraction runs (model download % / infer). */
  subjectStage?: string | undefined;
  /** Advanced extraction knobs (model precision / alpha threshold / shrink). */
  subjectSettings: SubjectExtractionSettings;
  onSubjectSettingsChange(settings: SubjectExtractionSettings): void;
  /** Re-run extraction for the current top original with current knobs. */
  onSubjectReextract(): void;
  onIconBackgroundChange(background: IconBackground): void;
  onIconScaleChange(scale: number): void;
  onPickIconCandidate(candidate: IconCandidate): void;
  onUploadIcon(file: File): void;
  onClearIcon(): void;
  onPatch(patch: Partial<WizardFormValues>): void;
}

export function AppForm({
  values,
  defaults,
  frozen,
  iconCandidates,
  iconCandidatesPort,
  iconCandidatesGeneration,
  uploadedIconUrl,
  selectedIconRef,
  iconAnalysis,
  iconComposition,
  iconComposeError,
  iconBackground,
  iconScale,
  subjectExtracting,
  subjectStage,
  subjectSettings,
  onSubjectSettingsChange,
  onSubjectReextract,
  onIconBackgroundChange,
  onIconScaleChange,
  onPickIconCandidate,
  onUploadIcon,
  onClearIcon,
  onPatch,
}: AppFormProps): React.JSX.Element {
  const disabled = frozen;
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [subjectPanelOpen, setSubjectPanelOpen] = React.useState(false);

  return (
    <div className="grid grid-cols-1 gap-y-1">
      {/* Icon picker: square file input + scraped candidates, full row. */}
      <div>
        <Label>应用图标</Label>
        <div className="mt-1.5 flex flex-wrap items-start gap-3">
          <button
            type="button"
            disabled={disabled}
            aria-label="选择本地图片作为应用图标"
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              if (!disabled) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              if (disabled) return;
              const file = event.dataTransfer.files[0];
              if (file !== undefined) onUploadIcon(file);
            }}
            className={cn(
              "flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-popover transition-colors",
              disabled ? "opacity-50" : "hover:border-primary",
              dragOver && "border-primary bg-primary/10",
            )}
          >
            {uploadedIconUrl !== undefined ? (
              <img src={uploadedIconUrl} alt="已选图标" className="icon-checker size-full rounded object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-muted-foreground">
                <Upload className="size-4" />
                <span className="text-[10px] leading-tight">点击或拖入图片</span>
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
            className="hidden"
            disabled={disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) onUploadIcon(file);
              event.target.value = "";
            }}
          />
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {iconCandidates.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                未抓取到候选图标；将使用首字母图标
              </span>
            ) : (
              // App-icon picker: originals plus AI subject extractions; the
              // solid silhouettes are tray-template art and stay in the
              // advanced tray picker only.
              iconCandidates
                .filter((candidate) => candidate.variant === "original" || candidate.variant === "subject")
                .map((candidate) => {
                const src =
                  iconCandidatesPort === undefined
                    ? undefined
                    : iconDataUrl(iconCandidatesPort, candidate.index, iconCandidatesGeneration);
                const picked =
                  selectedIconRef ===
                  `${iconCandidatesPort}:${candidate.index}`;
                const isDefault = selectedIconRef === undefined && candidate.variant === "original" && candidate.index === (iconCandidates.find((c) => c.variant === "original")?.index ?? -1);
                return (
                  <button
                    key={candidate.index}
                    type="button"
                    disabled={disabled}
                    title={
                      candidate.variant === "subject"
                        ? `AI 主体提取 ${candidate.width}×${candidate.height} ${candidate.format.toUpperCase()}`
                        : `${candidate.width}×${candidate.height} ${candidate.format.toUpperCase()}`
                    }
                    onClick={() => onPickIconCandidate(candidate)}
                    className={cn(
                      "icon-checker flex size-14 items-center justify-center overflow-hidden rounded-lg border p-1 transition-all",
                      picked || isDefault
                        ? "border-primary ring-2 ring-primary/60"
                        : "border-border hover:border-primary/60",
                      disabled && "opacity-50",
                    )}
                  >
                    {src !== undefined ? (
                      <img
                        src={src}
                        alt={
                          candidate.variant === "subject"
                            ? `主体提取候选 ${candidate.width}×${candidate.height}`
                            : `候选图标 ${candidate.width}×${candidate.height}`
                        }
                        className="size-full object-contain"
                      />
                    ) : null}
                  </button>
                );
              })
            )}
            {subjectExtracting ? (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status">
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
                {subjectStage ?? "AI 提取主体中…"}
              </span>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              aria-expanded={subjectPanelOpen}
              onClick={() => setSubjectPanelOpen((open) => !open)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              AI 提取设置
            </button>
          </div>
          {subjectPanelOpen ? (
            <div className="mt-2 grid grid-cols-1 gap-2.5 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">模型精度</span>
                <div className="flex gap-1.5">
                  {([
                    ["isnet", "高精"],
                    ["isnet_fp16", "标准"],
                    ["isnet_quint8", "轻量"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      disabled={disabled}
                      aria-pressed={subjectSettings.model === value}
                      onClick={() => onSubjectSettingsChange({ ...subjectSettings, model: value })}
                      className={cn(
                        "h-7 rounded-md border px-2.5 text-[11px] transition-colors",
                        subjectSettings.model === value
                          ? "border-foreground bg-secondary text-secondary-foreground"
                          : "border-border text-muted-foreground hover:border-foreground/40",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">去除半透明残留（alpha 阈值）</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {subjectSettings.alphaThreshold === 0 ? "关闭" : subjectSettings.alphaThreshold}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={128}
                  step={8}
                  value={subjectSettings.alphaThreshold}
                  disabled={disabled}
                  onChange={(event) =>
                    onSubjectSettingsChange({ ...subjectSettings, alphaThreshold: Number(event.target.value) })
                  }
                  className="mt-1 w-full accent-foreground"
                  aria-label="主体提取 alpha 阈值"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">边缘收缩（去白边/光晕）</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {subjectSettings.shrink === 0 ? "关闭" : `${subjectSettings.shrink}px`}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={1}
                  value={subjectSettings.shrink}
                  disabled={disabled}
                  onChange={(event) =>
                    onSubjectSettingsChange({ ...subjectSettings, shrink: Number(event.target.value) })
                  }
                  className="mt-1 w-full accent-foreground"
                  aria-label="主体提取边缘收缩"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={disabled || subjectExtracting}
                  onClick={onSubjectReextract}
                >
                  按当前设置重新提取
                </Button>
                <span className="text-[11px] leading-relaxed text-muted-foreground">
                  重新提取会替换现有主体候选及其托盘剪影。
                </span>
              </div>
            </div>
          ) : null}
          {selectedIconRef !== undefined || uploadedIconUrl !== undefined ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onClearIcon}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              清除选择（回到默认）
            </button>
          ) : null}
        </div>
        {/* Icon composition (owner round-12): background + scale + preview.
         * Follows EXPLICIT icon selection only — a URL/command preset
         * commits iconPath into the server form (indistinguishable from a
         * pick there), so the webui's own selection/upload state is the
         * visibility authority. */}
        {(selectedIconRef !== undefined || uploadedIconUrl !== undefined) && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="flex items-start gap-3">
            <div
              role="img"
              className="icon-checker size-14 shrink-0 overflow-hidden rounded-[10px]"
              aria-label="图标合成预览"
            >
              {iconComposition !== undefined ? (
                <img
                  src={composedIconUrl(iconComposition.key)}
                  alt="图标合成预览"
                  className="size-full object-contain"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <span className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                  预览
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Label>图标背景</Label>
              <div className="mt-1.5 flex gap-1.5">
                {(["black", "white", "transparent"] as const).map((bg) => (
                  <button
                    key={bg}
                    type="button"
                    disabled={disabled}
                    aria-pressed={iconBackground === bg}
                    onClick={() => onIconBackgroundChange(bg)}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] transition-colors",
                      iconBackground === bg
                        ? "border-foreground bg-secondary text-secondary-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/40",
                    )}
                  >
                    {bg === "black" ? "黑色" : bg === "white" ? "白色" : "透明"}
                    {iconAnalysis !== undefined && iconAnalysis.suggested === bg ? (
                      <span className="text-[10px] text-muted-foreground/70">自动</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="mt-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px]">前景缩放</Label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(iconScale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={95}
                  step={5}
                  value={Math.round(iconScale * 100)}
                  disabled={disabled}
                  onChange={(event) => onIconScaleChange(Number(event.target.value) / 100)}
                  className="mt-1 w-full accent-foreground"
                  aria-label="前景图标缩放"
                />
              </div>
              {iconComposeError !== undefined ? (
                <p role="alert" className="mt-1.5 text-[11px] font-medium text-red-400">
                  {iconComposeError}
                </p>
              ) : null}
              {iconAnalysis !== undefined ? (
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {iconBackground === "transparent"
                    ? "透明背景：原始像素直接透出。"
                    : `已按明暗自动选择${iconAnalysis.suggested === iconBackground ? "" : "（已手动覆盖）"}：${
                        iconAnalysis.luminance === undefined
                          ? "无法分析明暗"
                          : `前景明度 ${iconAnalysis.luminance.toFixed(2)}、覆盖率 ${(iconAnalysis.coverage * 100).toFixed(0)}%`
                      }。`}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        )}
      </div>

      <div>
        <Label htmlFor="appId">App ID</Label>
        <Input
          id="appId"
          className="mt-1 font-mono"
          disabled={disabled}
          value={values.appId}
          placeholder={defaults.appId || "由命令推导（如 start.somecommand.npx）"}
          onChange={(event) => onPatch({ appId: event.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="appName">应用名称</Label>
        <Input
          id="appName"
          className="mt-1"
          disabled={disabled}
          value={values.appName}
          placeholder={defaults.appName || "从服务页面标题抓取"}
          onChange={(event) => onPatch({ appName: event.target.value })}
        />
      </div>
    </div>
  );
}
