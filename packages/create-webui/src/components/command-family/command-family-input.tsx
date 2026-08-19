// Orthogonal intents (maintained 2026-08-19; original user requests:
// 2026-08-19 「做成一个 inputgroup…start 部分是一个选择器，可以选择域，
// 这里都使用图标…自定义模式的图标就是一个 edit-icon…主体部分是一个
// ReadonlyInput…点击弹出一个 formDialog」；同日 R5 拍板「表单独立缓存在
// 前端，切回来表单还存在」；R8 复核要求会话生命周期显式建模):
// 1. 系列选择器/输入行渲染（含 env 预设指示图标与 Tooltip）。
// 2. DialogSession 会话生命周期：打开快照、会话内跨系列暂存、取消整体丢弃、
//    确定仅提交当前系列（f2e4f01，codex max 实现）。
// 3. 服务端作者投影（commandOptions.family）的缓存刷新与 SSE 合流（D11a）。
// 4. 命令串序列化回写与作者投影上传。
// 妥协声明：会话 reducer 与 projectionCache 尚未拆分为独立 controller hook
// （Codex R8-B2 建议的进一步拆分）——刚经历 max 实现与多轮复核，为控制回归
// 面推迟到本变更归档后的重构轮；正交意图清单如上持续维护。
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

type StructuredFamily = Exclude<Family, "custom">;

interface DialogSession {
  /** 打开时固定的取消锚点；后续 SSE 不得改写它。 */
  readonly snapshot: {
    readonly family: StructuredFamily;
    readonly state: FamilyFormState;
  };
  readonly currentFamily: StructuredFamily;
  /** 同一会话内各系列的草稿；只有确定才会进入投影缓存。 */
  readonly drafts: Readonly<Partial<Record<StructuredFamily, FamilyFormState>>>;
  /** 每个会话草稿的最后一个权威基线，用于判定是否已有本地编辑。 */
  readonly bases: Readonly<Partial<Record<StructuredFamily, FamilyFormState>>>;
}

const isStructuredFamily = (family: Family): family is StructuredFamily =>
  family !== "custom";

const sameFamilyState = (left: FamilyFormState, right: FamilyFormState): boolean =>
  left.family === right.family &&
  left.runner === right.runner &&
  left.runnerFlags === right.runnerFlags &&
  left.pkg === right.pkg &&
  left.version === right.version &&
  left.args === right.args &&
  left.binary === right.binary &&
  left.raw === right.raw;

export function CommandFamilyInput({
  command,
  onCommandChange,
  commandOptions,
  onCommandOptionsChange,
  disabled,
  onRun,
}: CommandFamilyInputProps): React.JSX.Element {
  const parsed = React.useMemo(() => parseCommand(command), [command]);
  const serverFamily = commandOptions.family;

  // 已确定状态或 SSE 作者投影的缓存。未确认 Dialog 草稿只存在于 dialogSession，
  // 所以新投影永远可以刷新这里，且不会在稍后的切换中被陈旧草稿反向上传。
  const projectionCacheRef = React.useRef<Partial<Record<Family, FamilyFormState>>>({});
  const [dialogSession, setDialogSession] = React.useState<DialogSession | null>(null);

  // 显式选择（Codex B4 + R2-B1）：初值与外部注入（快照/草稿恢复/SSE）都来自
  // 服务端作者状态投影；一旦用户在本地选择即保持用户意图，custom 自由输入
  // runner 头不会翻转 UI，同系列重复点击为 no-op。
  const [selection, setSelection] = React.useState<Family | null>(
    serverFamily?.family ?? null,
  );
  React.useEffect(() => {
    if (serverFamily === null) {
      return;
    }

    projectionCacheRef.current[serverFamily.family] = serverFamily;
    if (dialogSession === null) {
      setSelection((current) =>
        current === serverFamily.family ? current : serverFamily.family,
      );
      return;
    }

    // 合流规则（D11a）：当前 Dialog 系列尚未编辑才随新投影刷新；已经编辑的
    // 草稿留在会话中，只有用户明确确定才会写回。取消则丢弃它并采用此缓存投影。
    if (
      !isStructuredFamily(serverFamily.family) ||
      dialogSession.currentFamily !== serverFamily.family
    ) {
      return;
    }
    setDialogSession((current) => {
      if (
        current === null ||
        current.currentFamily !== serverFamily.family
      ) {
        return current;
      }
      const draft = current.drafts[serverFamily.family];
      const base = current.bases[serverFamily.family];
      if (
        draft === undefined ||
        base === undefined ||
        !sameFamilyState(draft, base)
      ) {
        return current;
      }
      return {
        ...current,
        drafts: { ...current.drafts, [serverFamily.family]: serverFamily },
        bases: { ...current.bases, [serverFamily.family]: serverFamily },
      };
    });
  }, [serverFamily, dialogSession === null]);
  const family = selection ?? parsed.family;

  const stateForFamily = (next: Family): FamilyFormState => {
    if (serverFamily !== null && serverFamily.family === next) {
      return serverFamily;
    }
    const cached = projectionCacheRef.current[next];
    if (cached !== undefined) {
      return cached;
    }
    return parsed.family === next ? parsed : familyTemplate(next);
  };

  // env 图标 Tooltip：hover/focus 即时显示，click 额外「钉住」。
  const [envHovered, setEnvHovered] = React.useState(false);
  const [envFocused, setEnvFocused] = React.useState(false);
  const [envPinned, setEnvPinned] = React.useState(false);

  // env 预设投影（D4 R5）：env 配置行是唯一可信源，预设是它的双向投影。
  // 图标 = 「该命令将携带 npm_config_yes」：显式条目（用户值任意）或默认
  // 注入均点亮；Tooltip 区分来源。重复键取最后一项（与服务端 last-wins 一致）。
  const dialogDraft =
    dialogSession === null
      ? undefined
      : dialogSession.drafts[dialogSession.currentFamily];
  const famState = dialogDraft ?? commandOptions.family ?? parsed;
  const presetDefinition = envPresetsFor(famState)[0];
  const explicitValue =
    presetDefinition === undefined
      ? undefined
      : explicitEnvValue(commandOptions.env, presetDefinition.key);
  // R10：env 行完全唯一——有条目 = 启用（显用户值），无条目 = 未启用（+ 启用）。
  const presetProjection: EnvPresetProjection | null =
    presetDefinition === undefined
      ? null
      : {
          key: presetDefinition.key,
          defaultNote: presetDefinition.note,
          state: explicitValue !== undefined ? "explicit" : "off",
          ...(explicitValue !== undefined ? { explicitValue } : {}),
        };
  const carriesPreset = explicitValue !== undefined;

  /** 启用 = 在 env 行写入条目（投影到唯一可信源）；移除 = 删条目。 */
  const applyEnvPresetChange = (action: "enable" | "disable"): void => {
    const key = presetDefinition?.key ?? "npm_config_yes";
    const env =
      action === "enable"
        ? [
            ...commandOptions.env.filter((entry) => entry.key.trim() !== key),
            { key, value: "true" },
          ]
        : commandOptions.env.filter((entry) => entry.key.trim() !== key);
    onCommandOptionsChange({ ...commandOptions, env });
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
    // 服务端投影优先；没有投影时才用已确定缓存、命令解析或空模板。这里绝不
    // 读取 Dialog 未确认草稿，避免切换操作把它静默上传覆盖 SSE 的新投影。
    const state = stateForFamily(next);
    if (projectionCacheRef.current[next] === undefined) {
      projectionCacheRef.current[next] = state;
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
    if (!isStructuredFamily(family)) {
      return;
    }
    const initial = stateForFamily(family);
    setDialogSession({
      snapshot: { family, state: initial },
      currentFamily: family,
      drafts: { [family]: initial },
      bases: { [family]: initial },
    });
  };

  const updateDialogDraft = (draft: FamilyFormState): void => {
    setDialogSession((current) => {
      if (current === null || current.currentFamily !== draft.family) {
        return current;
      }
      return {
        ...current,
        drafts: { ...current.drafts, [draft.family]: draft },
      };
    });
  };

  const switchDialogFamily = (next: StructuredFamily): void => {
    setDialogSession((current) => {
      if (current === null || current.currentFamily === next) {
        return current;
      }
      const previousDraft = current.drafts[next];
      const previousBase = current.bases[next];
      const authoritative = stateForFamily(next);
      // 离开后没有字段编辑的系列仍是 clean：返回时必须采用期间的新 SSE
      // 投影。只有 draft 相对 base 已变时，才保留用户明确尚未确定的编辑。
      const isDirty =
        previousDraft !== undefined &&
        previousBase !== undefined &&
        !sameFamilyState(previousDraft, previousBase);
      const nextState = isDirty ? previousDraft : authoritative;
      return {
        ...current,
        currentFamily: next,
        drafts: { ...current.drafts, [next]: nextState },
        bases: { ...current.bases, [next]: isDirty ? previousBase : authoritative },
      };
    });
  };

  const cancelDialog = (): void => {
    setDialogSession((current) => {
      if (current === null) {
        return current;
      }
      // 取消只能回滚打开时的快照，绝不捕获当前渲染系列或后续 initial。若同
      // 系列已有更新的服务端投影，缓存已被 SSE 刷新且仍应保持权威；快照只用
      // 于丢弃本次未确认草稿，不会反向覆盖那个更新。
      const cached = projectionCacheRef.current[current.snapshot.family];
      if (cached === undefined || sameFamilyState(cached, current.snapshot.state)) {
        projectionCacheRef.current[current.snapshot.family] = current.snapshot.state;
      }
      return null;
    });
  };

  const applyDialog = (next: FamilyFormState): void => {
    projectionCacheRef.current[next.family] = next;
    setSelection(next.family);
    onCommandChange(buildCommand(next));
    // 作者状态投影上传（B1）；env 预设已即时投影到 env 行，不走确定。
    onCommandOptionsChange({
      ...commandOptions,
      ...(commandOptions.argsMode === "array" ? { argsMode: "string" as const } : {}),
      family: next,
    });
    setDialogSession(null);
  };

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
                  {presetDefinition.key}={explicitValue}
                </p>
                <p className="text-[11px] opacity-70">
                  来自「命令选项 → 环境变量」配置（唯一可信源，两侧同步）
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <FamilyFormDialog
        open={dialogSession !== null}
        draft={dialogDraft ?? familyTemplate(family)}
        envPreset={presetProjection}
        onEnvPresetChange={applyEnvPresetChange}
        onDraftChange={updateDialogDraft}
        onFamilyChange={switchDialogFamily}
        onCancel={cancelDialog}
        onApply={applyDialog}
      />
    </>
  );
}
