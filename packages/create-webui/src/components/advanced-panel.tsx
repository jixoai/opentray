/**
 * Advanced options panel: tray icon picker (includes solid-color variants,
 * default coupled to the app icon) and the generated-app shell toggles.
 */
import { Settings2 } from "lucide-react";
import * as React from "react";

import { IconPicker } from "@/components/icon-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { IconCandidate, WizardFormValues } from "@/wizard-protocol";

export interface AdvancedPanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  frozen: boolean;
  values: WizardFormValues;
  candidates: IconCandidate[];
  candidatesPort: number | undefined;
  selectedTrayRef: string | undefined;
  uploadedTrayUrl: string | undefined;
  onPickTray(candidate: IconCandidate): void;
  onUploadTray(file: File): void;
  onClearTray(): void;
  onPatch(patch: Partial<WizardFormValues>): void;
}

export function AdvancedPanel({
  open,
  onOpenChange,
  frozen,
  values,
  candidates,
  candidatesPort,
  selectedTrayRef,
  uploadedTrayUrl,
  onPickTray,
  onUploadTray,
  onClearTray,
  onPatch,
}: AdvancedPanelProps): React.JSX.Element | null {
  if (!open) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">高级选项</h2>
        <button
          type="button"
          className="ml-auto text-xs text-muted-foreground hover:underline"
          onClick={() => onOpenChange(false)}
        >
          收起
        </button>
      </div>

      <div>
        <Label>托盘图标</Label>
        <p className="mb-1.5 mt-0.5 text-[11px] text-muted-foreground">
          默认与应用图标一致；纯色候选适合系统托盘（macOS 模板风格）。
        </p>
        <IconPicker
          candidates={candidates}
          port={candidatesPort}
          disabled={frozen}
          selectedRef={selectedTrayRef}
          uploadedUrl={uploadedTrayUrl}
          includeVariants
          defaultLabel="默认跟随应用图标"
          onPick={onPickTray}
          onUpload={onUploadTray}
          onClear={onClearTray}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <Switch
            id="showStartupTerminal"
            checked={values.showStartupTerminal}
            disabled={frozen}
            onCheckedChange={(checked) => onPatch({ showStartupTerminal: checked })}
          />
          <div>
            <Label htmlFor="showStartupTerminal" className="text-foreground">
              显示启动终端
            </Label>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              应用窗口内嵌终端标签页，实时显示命令的 PTY 输出（可交互）。
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-border p-3">
          <Switch
            id="showAddressBar"
            checked={values.showAddressBar}
            disabled={frozen}
            onCheckedChange={(checked) => onPatch({ showAddressBar: checked })}
          />
          <div>
            <Label htmlFor="showAddressBar" className="text-foreground">
              显示地址栏
            </Label>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              服务标签页顶部显示地址栏（Web Navigation API 管理导航）。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
