/**
 * Shared icon candidate picker (wizard app icon / advanced tray icon / shell).
 * Renders scraped candidates ranked by clarity, marking variants; a square
 * upload tile offers local images. Selection state is the caller's.
 */
import { Upload } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { iconDataUrl, type IconCandidate } from "@/wizard-protocol";

export interface IconPickerProps {
  candidates: IconCandidate[];
  port: number | undefined;
  disabled: boolean;
  /** Currently picked `port:index`, or undefined for the default (index 0). */
  selectedRef: string | undefined;
  /** Upload tile preview (object URL) when a local image was chosen. */
  uploadedUrl: string | undefined;
  /** Include solid variants (advanced tray picker) or originals only. */
  includeVariants: boolean;
  /** Marker for the default-coupled entry (tray follows app icon). */
  defaultLabel?: string;
  onPick(candidate: IconCandidate): void;
  onUpload(file: File): void;
  onClear(): void;
}

export function IconPicker({
  candidates,
  port,
  disabled,
  selectedRef,
  uploadedUrl,
  includeVariants,
  defaultLabel,
  onPick,
  onUpload,
  onClear,
}: IconPickerProps): React.JSX.Element {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const visible = includeVariants
    ? candidates
    : candidates.filter((candidate) => candidate.variant === "original");
  const originals = candidates.filter((candidate) => candidate.variant === "original");

  return (
    <div className="flex flex-wrap items-start gap-3">
      <button
        type="button"
        disabled={disabled}
        aria-label="选择本地图片"
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
          if (file !== undefined) onUpload(file);
        }}
        className={cn(
          "flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-popover transition-colors",
          disabled ? "opacity-50" : "hover:border-primary",
          dragOver && "border-primary bg-primary/10",
        )}
      >
        {uploadedUrl !== undefined ? (
          <img src={uploadedUrl} alt="已选图标" className="size-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-muted-foreground">
            <Upload className="size-4" />
            <span className="text-[10px] leading-tight">上传</span>
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
          if (file !== undefined) onUpload(file);
          event.target.value = "";
        }}
      />
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {visible.length === 0 ? (
          <span className="text-xs text-muted-foreground">暂无候选图标</span>
        ) : (
          visible.map((candidate) => {
            const src =
              port === undefined ? undefined : iconDataUrl(port, candidate.index);
            const picked = selectedRef === `${port}:${candidate.index}`;
            const isDefault = selectedRef === undefined && candidate.variant === "original" && candidate.index === (originals[0]?.index ?? -1);
            return (
              <button
                key={`${candidate.variant}:${candidate.index}`}
                type="button"
                disabled={disabled}
                title={
                  candidate.variant === "original"
                    ? `${candidate.width}×${candidate.height} ${candidate.format.toUpperCase()}`
                    : `${candidate.variant === "solid-black" ? "黑色" : "白色"}纯色 ${candidate.format.toUpperCase()}`
                }
                onClick={() => onPick(candidate)}
                className={cn(
                  "flex size-12 items-center justify-center overflow-hidden rounded-lg border bg-popover p-1 transition-all",
                  picked || isDefault
                    ? "border-primary ring-2 ring-primary/60"
                    : "border-border hover:border-primary/60",
                  candidate.variant === "solid-white" && "bg-neutral-200",
                  disabled && "opacity-50",
                )}
              >
                {src !== undefined ? (
                  <img
                    src={src}
                    alt={`候选 ${candidate.variant}`}
                    className="size-full object-contain"
                  />
                ) : null}
              </button>
            );
          })
        )}
        {defaultLabel !== undefined && selectedRef === undefined && visible.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">{defaultLabel}</span>
        ) : null}
      </div>
      {selectedRef !== undefined || uploadedUrl !== undefined ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          清除
        </button>
      ) : null}
    </div>
  );
}
