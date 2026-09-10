/**
 * OpenTray identity form. Auto-derived defaults live in placeholders; an
 * empty input means "use the default" and confirmation resolves them. The
 * icon row is a square file picker plus clickable scraped candidates ranked
 * by clarity (full row — not a text input).
 */
import { Upload } from "lucide-react";
import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/i18n";
import { usePreferences } from "@/preferences";
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
  /** Settings changes apply immediately (debounced re-extraction upstream). */
  onSubjectSettingsChange(settings: SubjectExtractionSettings): void;
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
  onIconBackgroundChange,
  onIconScaleChange,
  onPickIconCandidate,
  onUploadIcon,
  onClearIcon,
  onPatch,
}: AppFormProps): React.JSX.Element {
  const { messages } = usePreferences();
  const disabled = frozen;
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [subjectPanelOpen, setSubjectPanelOpen] = React.useState(false);

  return (
    <div className="grid grid-cols-1 gap-y-1">
      {/* Icon picker: square file input + scraped candidates, full row. */}
      <div>
        <Label>{messages.icon.appLabel}</Label>
        <div className="mt-1.5 flex flex-wrap items-start gap-3">
          <button
            type="button"
            disabled={disabled}
            aria-label={messages.icon.uploadAria}
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
              <img
                src={uploadedIconUrl}
                alt={messages.icon.uploadedAlt}
                className="icon-checker size-full rounded object-contain"
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-muted-foreground">
                <Upload className="size-4" />
                <span className="text-[10px] leading-tight">{messages.icon.clickOrDrop}</span>
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
              <span className="text-xs text-muted-foreground">{messages.icon.noCandidates}</span>
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
                        ? fmt(messages.icon.subjectTitle, {
                            w: candidate.width,
                            h: candidate.height,
                            format: candidate.format.toUpperCase(),
                          })
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
                            ? fmt(messages.icon.subjectAlt, {
                                w: candidate.width,
                                h: candidate.height,
                              })
                            : fmt(messages.icon.candidateAlt, {
                                w: candidate.width,
                                h: candidate.height,
                              })
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
                {subjectStage ?? messages.icon.extracting}
              </span>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              aria-expanded={subjectPanelOpen}
              onClick={() => setSubjectPanelOpen((open) => !open)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {messages.icon.settings}
            </button>
          </div>
          {subjectPanelOpen ? (
            <div className="mt-2 grid grid-cols-1 gap-2.5 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground">
                  {messages.icon.modelPrecision}
                </span>
                <div className="flex gap-1.5">
                  {([
                    ["isnet", messages.icon.modelHigh],
                    ["isnet_fp16", messages.icon.modelStandard],
                    ["isnet_quint8", messages.icon.modelLight],
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
                  <span className="text-[11px] text-muted-foreground">
                    {messages.icon.alphaLabel}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {subjectSettings.alphaThreshold === 0
                      ? messages.common.off
                      : subjectSettings.alphaThreshold}
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
                  aria-label={messages.icon.alphaAria}
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    {messages.icon.shrinkLabel}
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {subjectSettings.shrink === 0
                      ? messages.common.off
                      : `${subjectSettings.shrink}px`}
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
                  aria-label={messages.icon.shrinkAria}
                />
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {messages.icon.settingsHint}
              </p>
            </div>
          ) : null}
          {selectedIconRef !== undefined || uploadedIconUrl !== undefined ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onClearIcon}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {messages.icon.clearSelection}
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
              aria-label={messages.icon.composePreviewAria}
            >
              {iconComposition !== undefined ? (
                <img
                  src={composedIconUrl(iconComposition.key)}
                  alt={messages.icon.composePreviewAria}
                  className="size-full object-contain"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <span className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                  {messages.icon.previewOnly}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Label>{messages.icon.background}</Label>
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
                    {bg === "black"
                      ? messages.icon.bgBlack
                      : bg === "white"
                        ? messages.icon.bgWhite
                        : messages.icon.bgTransparent}
                    {iconAnalysis !== undefined && iconAnalysis.suggested === bg ? (
                      <span className="text-[10px] text-muted-foreground/70">
                        {messages.icon.autoBadge}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="mt-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px]">{messages.icon.scale}</Label>
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
                  aria-label={messages.icon.scaleAria}
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
                    ? messages.icon.transparentNote
                    : fmt(messages.icon.luminanceNote, {
                        manual:
                          iconAnalysis.suggested === iconBackground ? "" : messages.icon.manualOverride,
                        detail:
                          iconAnalysis.luminance === undefined
                            ? messages.icon.luminanceUnavailable
                            : fmt(messages.icon.luminanceDetail, {
                                luminance: iconAnalysis.luminance.toFixed(2),
                                coverage: (iconAnalysis.coverage * 100).toFixed(0),
                              }),
                      })}
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
          placeholder={defaults.appId || messages.form.appIdPlaceholder}
          onChange={(event) => onPatch({ appId: event.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="appName">{messages.form.appName}</Label>
        <Input
          id="appName"
          className="mt-1"
          disabled={disabled}
          value={values.appName}
          placeholder={defaults.appName || messages.form.appNamePlaceholder}
          onChange={(event) => onPatch({ appName: event.target.value })}
        />
      </div>
    </div>
  );
}
