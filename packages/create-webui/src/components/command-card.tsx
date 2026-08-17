/**
 * Command card (first card): the command input row plus the 命令选项
 * accordion living INSIDE the card. No external toggle — the accordion
 * sections expand/collapse on their own.
 */
import { Play, Settings2, Square, Terminal as TerminalIcon } from "lucide-react";
import * as React from "react";

import { TagInput } from "@/components/tag-input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardCommandOptions } from "@/wizard-protocol";

export interface CommandCardProps {
  command: string;
  onCommandChange(command: string): void;
  argv: readonly string[];
  onArgvChange(argv: readonly string[]): void;
  runAlive: boolean;
  frozen: boolean;
  failedReason?: string | undefined;
  commandOptions: WizardCommandOptions;
  /** Resolved USER_HOME default — displayed in full as the cwd placeholder. */
  defaultCwd: string;
  onCommandOptionsChange(options: WizardCommandOptions): void;
  onRun(): void;
  onStop(): void;
}

export function CommandCard({
  command,
  onCommandChange,
  argv,
  onArgvChange,
  runAlive,
  frozen,
  failedReason,
  commandOptions,
  defaultCwd,
  onCommandOptionsChange,
  onRun,
  onStop,
}: CommandCardProps): React.JSX.Element {
  const patchCommand = (patch: Partial<WizardCommandOptions>): void => {
    onCommandOptionsChange({ ...commandOptions, ...patch });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      {/* Command row */}
      <div className="flex gap-2">
        {commandOptions.argsMode === "array" ? (
          <TagInput
            tags={argv}
            onTagsChange={onArgvChange}
            disabled={runAlive}
            aria-label="命令参数（argv）"
          />
        ) : (
          <Input
            className="font-mono"
            placeholder="npx somecommand start --xx"
            value={command}
            disabled={runAlive}
            onChange={(event) => onCommandChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !runAlive) onRun();
            }}
          />
        )}
        {runAlive ? (
          <Button variant="destructive" onClick={onStop} aria-label="中断命令">
            <Square />
            中断
          </Button>
        ) : (
          <Button disabled={frozen} onClick={onRun} aria-label="运行命令">
            <Play />
            运行
          </Button>
        )}
      </div>
      {failedReason !== undefined ? (
        <p className="mt-2 font-mono text-xs text-red-400">{failedReason}</p>
      ) : null}

      {/* 命令选项 accordion lives inside this card */}
      <Accordion
        type="multiple"
        defaultValue={["command"]}
        className="mt-3 border-t border-border pt-1"
      >
        <AccordionItem value="command" className="border-b-0">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              <Settings2 className="size-4 text-muted-foreground" />
              命令选项
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
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
                  <TerminalIcon className="size-3.5" />
                  添加变量
                </Button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
