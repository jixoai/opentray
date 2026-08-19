/**
 * 系列命令输入组（add-create-command-family D1/D4/D8）：单行 InputGroup 取代
 * 自由命令输入 —— 前缀域选择器（官方品牌图标；自定义 = edit 图标）+ 主体。
 * 自定义系列 → 自由输入（现状行为，Enter 运行）；其它系列 → 只读命令区，
 * 点击弹 FamilyFormDialog 详细配置。npm 系列（npx/pnpx）env 预设以行内
 * Terminal 图标披露（Tooltip：hover 显示 + click 钉住）。
 */
import { Terminal } from "lucide-react";
import * as React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildCommand,
  EMPTY_FAMILY_STATE,
  envPresetsFor,
  FAMILY_LABEL,
  FAMILY_ORDER,
  parseCommand,
  type Family,
} from "@/lib/command-family";
import type { WizardCommandOptions } from "@/wizard-protocol";
import { FAMILY_ICON } from "./brand-icons";
import { FamilyFormDialog } from "./family-form-dialog";

export interface CommandFamilyInputProps {
  command: string;
  onCommandChange(command: string): void;
  commandOptions: WizardCommandOptions;
  onCommandOptionsChange(options: WizardCommandOptions): void;
  disabled: boolean;
  onRun(): void;
}

export function CommandFamilyInput({
  command,
  onCommandChange,
  commandOptions,
  onCommandOptionsChange,
  disabled,
  onRun,
}: CommandFamilyInputProps): React.JSX.Element {
  const state = React.useMemo(() => parseCommand(command), [command]);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // env 图标 Tooltip：hover/focus 即时显示，click 额外「钉住」。
  const [envHovered, setEnvHovered] = React.useState(false);
  const [envFocused, setEnvFocused] = React.useState(false);
  const [envPinned, setEnvPinned] = React.useState(false);

  // 与服务端同判：预设生效 = 解析命中预设 && 未整体关闭 && 用户未显式同名配置。
  const activePresets = envPresetsFor(state).filter(
    (preset) =>
      !commandOptions.envPresetDisabled &&
      !commandOptions.env.some((entry) => entry.key.trim() === preset.key),
  );

  const switchFamily = (family: Family): void => {
    // 系列选择只作用于 string 模式（D8）；argv 模式/编辑流保持现状。
    const nextState: WizardCommandOptions = {
      ...commandOptions,
      ...(commandOptions.argsMode === "array" ? { argsMode: "string" as const } : {}),
    };
    onCommandOptionsChange(nextState);
    onCommandChange(
      buildCommand({
        ...EMPTY_FAMILY_STATE,
        family,
        runner: family === "python" ? "uvx" : family === "npm" ? "npx" : "",
      }),
    );
  };

  const FamilyIcon = FAMILY_ICON[state.family];
  const isCustom = state.family === "custom";

  return (
    <>
      <div className="flex h-8 w-full min-w-0 items-stretch rounded-lg border border-input bg-transparent transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 disabled:opacity-50 dark:bg-input/30">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            className="flex w-9 items-center justify-center rounded-l-lg border-r border-input transition-colors outline-none hover:bg-accent focus-visible:z-10 focus-visible:border-ring"
            aria-label={`命令系列：${FAMILY_LABEL[state.family]}，点击切换`}
            title={`命令系列：${FAMILY_LABEL[state.family]}`}
          >
            <FamilyIcon className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36">
            {FAMILY_ORDER.map((family) => {
              const ItemIcon = FAMILY_ICON[family];
              return (
                <DropdownMenuItem
                  key={family}
                  onClick={() => switchFamily(family)}
                  className={family === state.family ? "bg-accent/60" : undefined}
                >
                  <ItemIcon className="text-muted-foreground" />
                  {FAMILY_LABEL[family]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {isCustom ? (
          <input
            className="h-full w-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            placeholder="npx somecommand start --xx"
            disabled={disabled}
            value={command}
            onChange={(event) => onCommandChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !disabled) onRun();
            }}
          />
        ) : (
          <button
            type="button"
            className="h-full min-w-0 flex-1 cursor-pointer truncate px-2.5 text-left font-mono text-sm outline-none select-none disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            title={command.length > 0 ? command : `点击配置 ${FAMILY_LABEL[state.family]} 系列命令`}
            aria-label={`配置 ${FAMILY_LABEL[state.family]} 系列命令`}
            onClick={() => setDialogOpen(true)}
          >
            {command.length > 0 ? (
              command
            ) : (
              <span className="text-muted-foreground">
                点击配置 {FAMILY_LABEL[state.family]} 系列命令…
              </span>
            )}
          </button>
        )}

        {activePresets.length > 0 ? (
          <Tooltip
            open={envHovered || envFocused || envPinned}
            onOpenChange={(next: boolean) => {
              if (!next) {
                setEnvPinned(false);
              }
            }}
          >
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="mr-1 flex size-6 shrink-0 self-center cursor-help items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={`已注入 ${activePresets.length} 个环境变量预设，悬停或点击查看`}
                  onPointerEnter={() => setEnvHovered(true)}
                  onPointerLeave={() => setEnvHovered(false)}
                  onFocus={() => setEnvFocused(true)}
                  onBlur={() => setEnvFocused(false)}
                  onClick={() => setEnvPinned((pinned) => !pinned)}
                />
              }
            >
              <Terminal className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="space-y-1 text-left">
                <p className="text-[11px] opacity-70">环境变量预设</p>
                {activePresets.map((preset) => (
                  <div key={preset.key}>
                    <p className="font-mono text-xs">
                      {preset.key}={preset.value}
                    </p>
                    <p className="text-[11px] opacity-70">{preset.note}</p>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <FamilyFormDialog
        open={dialogOpen}
        initial={state}
        initialEnvPresetDisabled={commandOptions.envPresetDisabled}
        onOpenChange={setDialogOpen}
        onApply={(next, envPresetDisabled) => {
          onCommandChange(buildCommand(next));
          if (envPresetDisabled !== commandOptions.envPresetDisabled) {
            onCommandOptionsChange({ ...commandOptions, envPresetDisabled });
          }
          setDialogOpen(false);
        }}
      />
    </>
  );
}
