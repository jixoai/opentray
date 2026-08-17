/**
 * App configuration card (second card): the identity form plus ONE merged
 * 高级选项 accordion (window modes, tray icon, package manager).
 */
import { Plus, Terminal as TerminalIcon } from "lucide-react";
import * as React from "react";

import { AppForm } from "@/components/app-form";
import { IconPicker } from "@/components/icon-picker";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  IconAnalysis,
  IconBackground,
  IconCandidate,
  IconComposition,
  WizardFormDefaults,
  WizardFormValues,
} from "@/wizard-protocol";

export interface AppConfigCardProps {
  frozen: boolean;
  values: WizardFormValues;
  defaults: WizardFormDefaults;
  candidates: IconCandidate[];
  candidatesPort: number | undefined;
  selectedIconRef: string | undefined;
  uploadedIconUrl: string | undefined;
  /** Icon composition state (owner round-12). */
  iconAnalysis: IconAnalysis | undefined;
  iconComposition: IconComposition | undefined;
  iconComposeError: string | undefined;
  iconBackground: IconBackground;
  iconScale: number;
  onIconBackgroundChange(background: IconBackground): void;
  onIconScaleChange(scale: number): void;
  selectedTrayRef: string | undefined;
  uploadedTrayUrl: string | undefined;
  selectedPort: number | undefined;
  /** The resolved target directory is already occupied. */
  targetDirExists: boolean;
  onPickIconCandidate(candidate: IconCandidate): void;
  onUploadIcon(file: File): void;
  onClearIcon(): void;
  onPickTray(candidate: IconCandidate): void;
  onUploadTray(file: File): void;
  onClearTray(): void;
  onPatch(patch: Partial<WizardFormValues>): void;
  onConfirm(): void;
}

export function AppConfigCard({
  frozen,
  values,
  defaults,
  candidates,
  candidatesPort,
  selectedIconRef,
  uploadedIconUrl,
  iconAnalysis,
  iconComposition,
  iconComposeError,
  iconBackground,
  iconScale,
  onIconBackgroundChange,
  onIconScaleChange,
  selectedTrayRef,
  uploadedTrayUrl,
  selectedPort,
  targetDirExists,
  onPickIconCandidate,
  onUploadIcon,
  onClearIcon,
  onPickTray,
  onUploadTray,
  onClearTray,
  onPatch,
  onConfirm,
}: AppConfigCardProps): React.JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <AppForm
        values={values}
        defaults={defaults}
        frozen={frozen}
        iconCandidates={candidates}
        iconCandidatesPort={candidatesPort}
        uploadedIconUrl={uploadedIconUrl}
        selectedIconRef={selectedIconRef}
        iconAnalysis={iconAnalysis}
        iconComposition={iconComposition}
        iconComposeError={iconComposeError}
        iconBackground={iconBackground}
        iconScale={iconScale}
        onIconBackgroundChange={onIconBackgroundChange}
        onIconScaleChange={onIconScaleChange}
        onPickIconCandidate={onPickIconCandidate}
        onUploadIcon={onUploadIcon}
        onClearIcon={onClearIcon}
        onPatch={onPatch}
      />

      {/* Merged 高级选项: window modes + tray icon + package manager */}
      <Accordion className="mt-4 border-t border-border pt-1">
        <AccordionItem value="advanced" className="border-b-0">
          <AccordionTrigger>高级选项</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
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
                    <TerminalIcon className="mr-0.5 inline size-3" />
                    应用启动时打开独立终端窗口，实时显示命令的 PTY 输出（可交互）。
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
                    服务窗口顶部显示地址栏（Web Navigation API 管理导航）。
                  </p>
                </div>
              </div>
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

            <div>
              <Label htmlFor="pm">包管理器</Label>
              <p className="mt-0.5 mb-1.5 text-[11px] leading-relaxed text-muted-foreground">
                仅为生成的应用安装依赖时使用的工具（决定 install
                命令与锁文件形态），不影响应用本身的运行方式——生成的应用始终以
                Node 启动。默认自动跟随你启动向导所用的包管理器，一般无需修改。
              </p>
              <Select
                value={values.pm}
                disabled={frozen}
                onValueChange={(pm) => onPatch({ pm: pm as WizardFormValues["pm"] })}
              >
                <SelectTrigger id="pm" className="mt-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="npm">npm</SelectItem>
                  <SelectItem value="pnpm">pnpm</SelectItem>
                  <SelectItem value="bun">bun</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border border-border p-3">
              <Label>生成位置</Label>
              <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                {defaults.targetDir || "~/.opentray/create/<应用名>"}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                生成的项目默认落在 OpenTray 主目录下，同一命令重复创建会落到同一位置；
                也可在启动向导时通过位置参数指定其他目录。
              </p>
              {targetDirExists ? (
                <p className="mt-2 text-[11px] font-medium text-amber-400">
                  目标目录已存在且非空——继续生成会失败，或开启下方强制覆盖。
                </p>
              ) : null}
              <div className="mt-3 flex items-start gap-3">
                <Switch
                  id="force-overwrite"
                  checked={values.force}
                  disabled={frozen}
                  onCheckedChange={(checked) => onPatch({ force: checked })}
                />
                <div>
                  <Label htmlFor="force-overwrite" className="text-foreground">
                    强制覆盖已存在的目录
                  </Label>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    开启后将清空目标目录内的现有内容并重新生成（等同
                    --force）。请确认目录中没有你需要的文件。
                  </p>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={onConfirm} disabled={frozen}>
          确定创建应用
        </Button>
        <span className="text-xs text-muted-foreground">
          {selectedPort !== undefined
            ? `已选服务 :${selectedPort}（点击状态栏服务可切换）`
            : "未运行也不影响：应用启动时会自行嗅探命令的监听端口"}
        </span>
      </div>
    </section>
  );
}
