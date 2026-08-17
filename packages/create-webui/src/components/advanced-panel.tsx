/**
 * Advanced options as an accordion: 命令选项 (execution cwd, custom env,
 * string/array input mode) and 应用选项 (tray icon, generated-app window
 * modes). Opened by the settings button beside the command bar.
 */
import { Plus, Settings2, Terminal as TerminalIcon } from "lucide-react";
import * as React from "react";

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
import { Switch } from "@/components/ui/switch";
import type {
  IconCandidate,
  WizardCommandOptions,
  WizardFormValues,
} from "@/wizard-protocol";

export interface AdvancedPanelProps {
  open: boolean;
  frozen: boolean;
  values: WizardFormValues;
  commandOptions: WizardCommandOptions;
  /** Resolved USER_HOME default — displayed in full as the cwd placeholder. */
  defaultCwd: string;
  onCommandOptionsChange(options: WizardCommandOptions): void;
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
  frozen,
  values,
  commandOptions,
  defaultCwd,
  onCommandOptionsChange,
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

  const patchCommand = (patch: Partial<WizardCommandOptions>): void => {
    onCommandOptionsChange({ ...commandOptions, ...patch });
  };

  return (
    <Accordion
      type="multiple"
      defaultValue={["command", "app"]}
      className="rounded-xl border border-border bg-card px-4"
    >
      <AccordionItem value="command">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            <Settings2 className="size-4 text-muted-foreground" />
            命令选项
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>参数输入模式</Label>
              <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                数组模式逐个输入参数（回车添加），原样传递、绝不拆分。
              </p>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={commandOptions.argsMode === "string" ? "default" : "outline"}
                  disabled={frozen}
                  onClick={() => patchCommand({ argsMode: "string" })}
                >
                  字符串
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={commandOptions.argsMode === "array" ? "default" : "outline"}
                  disabled={frozen}
                  onClick={() => patchCommand({ argsMode: "array" })}
                >
                  数组 (argv)
                </Button>
              </div>
            </div>
            <div>
              <Label htmlFor="cmd-cwd">工作目录 (cwd)</Label>
              <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                留空使用用户主目录（下方完整路径）；相对路径按主目录解析。
              </p>
              <Input
                id="cmd-cwd"
                className="mt-0 font-mono text-xs"
                disabled={frozen}
                value={commandOptions.cwd}
                placeholder={defaultCwd.length > 0 ? `默认：${defaultCwd}` : "默认：用户主目录"}
                title={defaultCwd}
                onChange={(event) => patchCommand({ cwd: event.target.value })}
              />
              {defaultCwd.length > 0 && commandOptions.cwd.trim().length === 0 ? (
                <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">
                  {defaultCwd}
                </p>
              ) : null}
            </div>
          </div>
          <div>
            <Label>环境变量 (env)</Label>
            <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
              启动命令时叠加在当前环境之上；同时写入生成的应用。
            </p>
            <div className="space-y-1.5">
              {commandOptions.env.length === 0 ? (
                <p className="text-xs text-muted-foreground">未配置</p>
              ) : (
                commandOptions.env.map((entry, index) => (
                  <div key={index} className="flex gap-1.5">
                    <Input
                      className="font-mono text-xs"
                      disabled={frozen}
                      aria-label={`env 名称 ${index + 1}`}
                      value={entry.key}
                      placeholder="NAME"
                      onChange={(event) => {
                        const env = [...commandOptions.env];
                        env[index] = { ...entry, key: event.target.value };
                        patchCommand({ env });
                      }}
                    />
                    <Input
                      className="font-mono text-xs"
                      disabled={frozen}
                      aria-label={`env 值 ${index + 1}`}
                      value={entry.value}
                      placeholder="value"
                      onChange={(event) => {
                        const env = [...commandOptions.env];
                        env[index] = { ...entry, value: event.target.value };
                        patchCommand({ env });
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      disabled={frozen}
                      aria-label="删除环境变量"
                      onClick={() => {
                        patchCommand({
                          env: commandOptions.env.filter((_, i) => i !== index),
                        });
                      }}
                    >
                      ×
                    </Button>
                  </div>
                ))
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={frozen}
                onClick={() =>
                  patchCommand({ env: [...commandOptions.env, { key: "", value: "" }] })
                }
              >
                <Plus className="size-3.5" />
                添加变量
              </Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="app" className="border-b-0">
        <AccordionTrigger>应用选项</AccordionTrigger>
        <AccordionContent className="space-y-4">
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
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
