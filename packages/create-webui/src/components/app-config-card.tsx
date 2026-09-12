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
import { fmt } from "@/i18n";
import { usePreferences } from "@/preferences";
import type { SubjectExtractionSettings } from "@/subject-extraction";
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
  candidatesGeneration: number;
  selectedIconRef: string | undefined;
  uploadedIconUrl: string | undefined;
  /** Icon composition state (owner round-12). */
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
  candidatesGeneration,
  selectedIconRef,
  uploadedIconUrl,
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
  const { messages } = usePreferences();
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <AppForm
        values={values}
        defaults={defaults}
        frozen={frozen}
        iconCandidates={candidates}
        iconCandidatesPort={candidatesPort}
        iconCandidatesGeneration={candidatesGeneration}
        uploadedIconUrl={uploadedIconUrl}
        selectedIconRef={selectedIconRef}
        iconAnalysis={iconAnalysis}
        iconComposition={iconComposition}
        iconComposeError={iconComposeError}
        iconBackground={iconBackground}
        iconScale={iconScale}
        subjectExtracting={subjectExtracting}
        {...(subjectStage === undefined ? {} : { subjectStage })}
        subjectSettings={subjectSettings}
        onSubjectSettingsChange={onSubjectSettingsChange}
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
          <AccordionTrigger>{messages.advanced.title}</AccordionTrigger>
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
                    {messages.advanced.startupTerminal}
                  </Label>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    <TerminalIcon className="mr-0.5 inline size-3" />
                    {messages.advanced.startupTerminalHint}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-border p-3">
                <Switch
                  id="toolbar"
                  checked={values.toolbar}
                  disabled={frozen}
                  onCheckedChange={(checked) => onPatch({ toolbar: checked })}
                />
                <div>
                  <Label htmlFor="toolbar" className="text-foreground">
                    {messages.advanced.addressBar}
                  </Label>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {messages.advanced.addressBarHint}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-border p-3">
                <Switch
                  id="imageSmoothingEnabled"
                  checked={values.imageSmoothingEnabled}
                  disabled={frozen}
                  onCheckedChange={(checked) => onPatch({ imageSmoothingEnabled: checked })}
                />
                <div>
                  <Label htmlFor="imageSmoothingEnabled" className="text-foreground">
                    {messages.advanced.smoothing}
                  </Label>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {messages.advanced.smoothingHint}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-border p-3">
                <Switch
                  id="developerMode"
                  checked={values.developerMode}
                  disabled={frozen}
                  onCheckedChange={(checked) => onPatch({ developerMode: checked })}
                />
                <div>
                  <Label htmlFor="developerMode" className="text-foreground">
                    {messages.advanced.developer}
                  </Label>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {messages.advanced.developerHint}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <Label>{messages.advanced.tray}</Label>
              <p className="mb-1.5 mt-0.5 text-[11px] text-muted-foreground">
                {messages.advanced.trayHint}
              </p>
              <IconPicker
                candidates={candidates}
                port={candidatesPort}
                generation={candidatesGeneration}
                disabled={frozen}
                selectedRef={selectedTrayRef}
                uploadedUrl={uploadedTrayUrl}
                includeVariants
                defaultLabel={messages.icon.followApp}
                onPick={onPickTray}
                onUpload={onUploadTray}
                onClear={onClearTray}
              />
            </div>

            <div>
              <Label htmlFor="pm">{messages.advanced.pm}</Label>
              <p className="mt-0.5 mb-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {messages.advanced.pmHint}
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
              <Label>{messages.advanced.location}</Label>
              <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                {defaults.targetDir || messages.advanced.locationDefault}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {messages.advanced.locationHint}
              </p>
              {targetDirExists ? (
                <p className="mt-2 text-[11px] font-medium text-amber-400">
                  {messages.advanced.dirExistsWarning}
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
                    {messages.advanced.force}
                  </Label>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {messages.advanced.forceHint}
                  </p>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={onConfirm} disabled={frozen}>
          {messages.advanced.confirm}
        </Button>
        <span className="text-xs text-muted-foreground">
          {selectedPort !== undefined
            ? fmt(messages.advanced.serviceSelected, { port: selectedPort })
            : messages.advanced.serviceNone}
        </span>
      </div>
    </section>
  );
}
