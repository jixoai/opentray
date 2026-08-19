/**
 * 系列命令输入组（add-create-command-family D1/D4/D11 / Codex B1+B4）：
 * 单行 InputGroup —— 前缀域选择器（官方品牌图标；自定义 = edit 图标）+ 主体。
 * 选择器是显式状态源（不从命令串派生 UI 系列）：custom → 自由输入（现状
 * 行为，Enter 运行）；其它系列 → 只读命令区，点击弹 FamilyFormDialog。
 * Dialog 确定把「作者状态投影」上传服务端（family 字段，Rust 的 crate/binary
 * 无法从命令串恢复），命令串（运行行）仍是执行/持久化向量。npm 系列
 * （npx/pnpx）env 预设以行内 Terminal 图标披露（Tooltip：hover + click 钉住）。
 */
import { ChevronDown, Terminal } from "lucide-react";
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
  explicitEnvValue,
  FAMILY_LABEL,
  FAMILY_ORDER,
  parseCommand,
  type Family,
  type FamilyFormState,
} from "@/lib/command-family";
import type { WizardCommandOptions } from "@/wizard-protocol";
import { FAMILY_ICON } from "./brand-icons";
import { FamilyFormDialog, type EnvPresetProjection } from "./family-form-dialog";

export interface CommandFamilyInputProps {
  command: string;
  onCommandChange(command: string): void;
  commandOptions: WizardCommandOptions;
  onCommandOptionsChange(options: WizardCommandOptions): void;
  disabled: boolean;
  onRun(): void;
}

const familyTemplate = (family: Family): FamilyFormState => ({
  ...EMPTY_FAMILY_STATE,
  family,
  runner: family === "python" ? "uvx" : family === "npm" ? "npx" : "",
});

export function CommandFamilyInput({
  command,
  onCommandChange,
  commandOptions,
  onCommandOptionsChange,
  disabled,
  onRun,
}: CommandFamilyInputProps): React.JSX.Element {
  const parsed = React.useMemo(() => parseCommand(command), [command]);

  // 显式选择（Codex B4 + R2-B1）：初值与外部注入（快照/草稿恢复/SSE）都来自
  // 服务端作者状态投影；一旦用户在本地选择即保持用户意图，custom 自由输入
  // runner 头不会翻转 UI，同系列重复点击为 no-op。
  const serverFamily = commandOptions.family;
  const [selection, setSelection] = React.useState<Family | null>(
    serverFamily?.family ?? null,
  );
  React.useEffect(() => {
    if (serverFamily !== null) {
      setSelection((current) =>
        current === serverFamily.family ? current : serverFamily.family,
      );
    }
  }, [serverFamily?.family]);
  const family = selection ?? parsed.family;

  // 各系列最近一次作者草稿（Codex B1）：Rust 的 crate/binary 从命令串恢复
  // 不出来，Dialog 初值优先级 = 服务端投影 > 本地草稿 > 命令解析 > 空模板。
  const authoringRef = React.useRef<Partial<Record<Family, FamilyFormState>>>({});
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // env 图标 Tooltip：hover/focus 即时显示，click 额外「钉住」。
  const [envHovered, setEnvHovered] = React.useState(false);
  const [envFocused, setEnvFocused] = React.useState(false);
  const [envPinned, setEnvPinned] = React.useState(false);

  // env 预设投影（D4 R5）：env 配置行是唯一可信源，预设是它的双向投影。
  // 图标 = 「该命令将携带 npm_config_yes」：显式条目（用户值任意）或默认
  // 注入均点亮；Tooltip 区分来源。重复键取最后一项（与服务端 last-wins 一致）。
  const famState = commandOptions.family ?? parsed;
  const presetDefinition = envPresetsFor(famState)[0];
  const explicitValue =
    presetDefinition === undefined
      ? undefined
      : explicitEnvValue(commandOptions.env, presetDefinition.key);
  const presetProjection: EnvPresetProjection | null =
    presetDefinition === undefined
      ? null
      : {
          key: presetDefinition.key,
          defaultNote: presetDefinition.note,
          state:
            explicitValue !== undefined
              ? "explicit"
              : commandOptions.envPresetDisabled
                ? "off"
                : "default",
          ...(explicitValue !== undefined ? { explicitValue } : {}),
        };
  const carriesPreset =
    presetDefinition !== undefined &&
    (explicitValue !== undefined || !commandOptions.envPresetDisabled);

  /** 启用 = 在 env 行写入条目（投影到唯一可信源）；移除 = 删条目 + 关默认注入。 */
  const applyEnvPresetChange = (action: "enable" | "disable"): void => {
    const key = presetDefinition?.key ?? "npm_config_yes";
    const env =
      action === "enable"
        ? [
            ...commandOptions.env.filter((entry) => entry.key.trim() !== key),
            { key, value: "true" },
          ]
        : commandOptions.env.filter((entry) => entry.key.trim() !== key);
    onCommandOptionsChange({
      ...commandOptions,
      env,
      envPresetDisabled: action === "disable",
    });
  };

  const switchFamily = (next: Family): void => {
    if (next === family) {
      return; // 同系列重复点击 no-op（Codex B4：不再清空命令）
    }
    setSelection(next);
    // 系列选择只作用于 string 模式（D8）；argv 模式/编辑流保持现状。
    const options: WizardCommandOptions = {
      ...commandOptions,
      ...(commandOptions.argsMode === "array" ? { argsMode: "string" as const } : {}),
    };
    // 草稿保留（Codex R4-B2）：该系列已有前端缓存（含未确定的编辑）则直接
    // 恢复，只有首次进入才落空模板——切走再切回，表单不丢。
    const cached = authoringRef.current[next];
    const state = cached !== undefined ? cached : familyTemplate(next);
    if (cached === undefined) {
      authoringRef.current[next] = state;
    }
    // 非 custom 的作者状态上传（rust 空模板的命令行为空，只读区引导进入
    // Dialog；custom 不上传投影，保持按命令派生）。
    onCommandOptionsChange({
      ...options,
      family: next === "custom" ? null : state,
    });
    onCommandChange(buildCommand(state));
  };

  const openDialog = (): void => {
    setDialogOpen(true);
  };

  const dialogInitial: FamilyFormState =
    serverFamily !== null && serverFamily.family === family
      ? serverFamily
      : authoringRef.current[family] !== undefined
        ? (authoringRef.current[family] as FamilyFormState)
        : parsed.family === family
          ? parsed
          : familyTemplate(family);

  const FamilyIcon = FAMILY_ICON[family];
  const isCustom = family === "custom";

  return (
    <>
      <div className="flex h-8 w-full min-w-0 items-stretch rounded-lg border border-input bg-transparent transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 disabled:opacity-50 dark:bg-input/30">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            className="flex w-11 items-center justify-between gap-1 rounded-l-lg border-r border-input transition-colors outline-none hover:bg-accent focus-visible:z-10 focus-visible:border-ring"
            aria-label={`命令系列：${FAMILY_LABEL[family]}，点击切换`}
            title={`命令系列：${FAMILY_LABEL[family]}`}
          >
            <FamilyIcon className="size-4 text-muted-foreground ms-2" />
            {/* 下拉箭头：明示此处可切换系列，而非纯装饰图标 */}
            <ChevronDown className="size-3 text-muted-foreground/70 me-0.75" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36">
            {FAMILY_ORDER.map((item) => {
              const ItemIcon = FAMILY_ICON[item];
              return (
                <DropdownMenuItem
                  key={item}
                  onClick={() => switchFamily(item)}
                  className={item === family ? "bg-accent/60" : undefined}
                >
                  <ItemIcon className="text-muted-foreground" />
                  {FAMILY_LABEL[item]}
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
            title={command.length > 0 ? command : `点击配置 ${FAMILY_LABEL[family]} 系列命令`}
            aria-label={`配置 ${FAMILY_LABEL[family]} 系列命令`}
            onClick={openDialog}
          >
            {command.length > 0 ? (
              command
            ) : (
              <span className="text-muted-foreground">
                点击配置 {FAMILY_LABEL[family]} 系列命令…
              </span>
            )}
          </button>
        )}

        {carriesPreset && presetDefinition !== undefined ? (
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
                  aria-label="命令将携带 npm_config_yes 环境变量，悬停或点击查看"
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
                <p className="font-mono text-xs">
                  {presetDefinition.key}={explicitValue ?? "true"}
                </p>
                <p className="text-[11px] opacity-70">
                  {explicitValue !== undefined
                    ? "来自「命令选项 → 环境变量」配置（唯一可信源，两侧同步）"
                    : presetDefinition.note}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <FamilyFormDialog
        open={dialogOpen}
        initial={dialogInitial}
        envPreset={presetProjection}
        onEnvPresetChange={applyEnvPresetChange}
        onDraftChange={(draft) => {
          authoringRef.current[draft.family] = draft;
        }}
        onOpenChange={setDialogOpen}
        onApply={(next) => {
          authoringRef.current[next.family] = next;
          setSelection(next.family);
          onCommandChange(buildCommand(next));
          // 作者状态投影上传（B1）；env 预设已即时投影到 env 行，不走确定。
          onCommandOptionsChange({
            ...commandOptions,
            ...(commandOptions.argsMode === "array" ? { argsMode: "string" as const } : {}),
            family: next.family === "custom" ? null : next,
          });
          setDialogOpen(false);
        }}
      />
    </>
  );
}
