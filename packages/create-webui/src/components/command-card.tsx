/**
 * Command card (first card): the command input row plus the 命令选项
 * accordion living INSIDE the card. No external toggle — the accordion
 * sections expand/collapse on their own.
 *
 * String mode renders the series input group (add-create-command-family D1):
 * family selector prefix + free input (custom) / read-only body that opens
 * the family form dialog (npm/Go/Rust/Python/.NET). Array mode keeps the
 * verbatim argv TagInput (?edit= prefill relies on it).
 */
import { Play, Settings2, Square, Terminal as TerminalIcon } from "lucide-react";
import * as React from "react";

import { CommandFamilyInput } from "@/components/command-family/command-family-input";
import { TagInput } from "@/components/tag-input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmt } from "@/i18n";
import { usePreferences } from "@/preferences";
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
  const { messages } = usePreferences();
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
            aria-label={messages.command.argvAria}
          />
        ) : (
          <CommandFamilyInput
            command={command}
            onCommandChange={onCommandChange}
            commandOptions={commandOptions}
            onCommandOptionsChange={onCommandOptionsChange}
            disabled={runAlive || frozen}
            onRun={onRun}
          />
        )}
        {runAlive ? (
          <Button variant="destructive" onClick={onStop} aria-label={messages.command.stopAria}>
            <Square />
            {messages.command.stop}
          </Button>
        ) : (
          <Button disabled={frozen} onClick={onRun} aria-label={messages.command.runAria}>
            <Play />
            {messages.command.run}
          </Button>
        )}
      </div>
      {failedReason !== undefined ? (
        <p className="mt-2 font-mono text-xs text-red-400">{failedReason}</p>
      ) : null}

      {/* 命令选项 accordion lives inside this card */}
      <Accordion
        defaultValue={["command"]}
        className="mt-3 border-t border-border pt-1"
      >
        <AccordionItem value="command" className="border-b-0">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              <Settings2 className="size-4 text-muted-foreground" />
              {messages.command.options}
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label>{messages.command.argsModeLabel}</Label>
                <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                  {messages.command.argsModeHint}
                </p>
                {/* 单选 toggle 组：字符串 vs 数组 (argv)。空选（全不选）被忽略，
                    保证任意时刻恰有一种输入模式。 */}
                <ToggleGroup
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={[commandOptions.argsMode]}
                  onValueChange={(group: string[]) => {
                    const next = group[0];
                    if (next === "string" || next === "array") {
                      patchCommand({ argsMode: next });
                    }
                  }}
                  disabled={frozen}
                >
                  <ToggleGroupItem value="string">{messages.command.modeString}</ToggleGroupItem>
                  <ToggleGroupItem value="array">{messages.command.modeArray}</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <div>
                <Label htmlFor="cmd-cwd">{messages.command.cwdLabel}</Label>
                <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                  {messages.command.cwdHint}
                </p>
                <Input
                  id="cmd-cwd"
                  className="mt-0 font-mono text-xs"
                  disabled={frozen}
                  value={commandOptions.cwd}
                  placeholder={
                    defaultCwd.length > 0
                      ? fmt(messages.command.cwdDefault, { path: defaultCwd })
                      : messages.command.cwdDefaultHome
                  }
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
              <Label>{messages.command.envLabel}</Label>
              <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                {messages.command.envHint}
              </p>
              <div className="space-y-1.5">
                {commandOptions.env.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{messages.command.envEmpty}</p>
                ) : (
                  commandOptions.env.map((entry, index) => (
                    <div key={index} className="flex gap-1.5">
                      <Input
                        className="font-mono text-xs"
                        disabled={frozen}
                        aria-label={fmt(messages.command.envName, { n: index + 1 })}
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
                        aria-label={fmt(messages.command.envValue, { n: index + 1 })}
                        value={entry.value}
                        placeholder="value"
                        onChange={(event) => {
                          const env = [...commandOptions.env];
                          env[index] = { ...entry, value: event.target.value };
                          patchCommand({ env });
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={frozen}
                        aria-label={messages.command.envRemove}
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
                  variant="outline"
                  size="sm"
                  disabled={frozen}
                  onClick={() =>
                    patchCommand({ env: [...commandOptions.env, { key: "", value: "" }] })
                  }
                >
                  <TerminalIcon className="size-3.5" />
                  {messages.command.envAdd}
                </Button>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
