/**
 * 「分域表单」精化 — 用户选定的方向（2026-08-19）：命令配置收敛为单行
 * InputGroup，页面高度与原向导一致。
 * - 前缀：域选择器（图标 + DropdownMenu；自定义模式 = 铅笔图标）。
 * - 自定义模式：主体为普通 Input，自由输入。
 * - 其它模式：主体为 ReadOnlyInput（点击弹表单 Dialog，Dialog 内详细配置：
 *   预设、系列字段、env 预设、appId 新旧对照；确定提交草稿，取消丢弃）。
 * - `?dialog=1` 深链直接打开 Dialog（演示与验证用）。
 */
import { Check, ChevronDown, Pencil, Terminal } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  buildCommand,
  buildRustCommands,
  derivePreview,
  EMPTY_FAMILY_STATE,
  envPresetsFor,
  FAMILY_LABEL,
  FAMILY_ORDER,
  NPM_RUNNERS,
  PYTHON_RUNNERS,
  type Family,
  type FamilyFormState,
} from "./derive";
import dotnetSvg from "./icons/dotnet.svg?raw";
import goSvg from "./icons/go.svg?raw";
import npmSvg from "./icons/npm.svg?raw";
import pythonSvg from "./icons/python.svg?raw";
import rustSvg from "./icons/rust.svg?raw";
import { PRESETS, presetById } from "./presets";
import {
  AppIdentityCard,
  CopyButton,
  DemoRunButton,
  DerivationStrip,
  EnvPresetRow,
  PresetChipRow,
  WizardScaffold,
} from "./shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * simple-icons 官方品牌标（单色 path）内联渲染，去 title、跟随 currentColor。
 * 自定义模式无官方品牌，保持 edit 图标（lucide Pencil）。
 */
const brandIcon = (svg: string): React.ComponentType<{ className?: string }> => {
  const markup = svg.replace(/<title>[\s\S]*?<\/title>/g, "");
  const Icon = ({ className }: { className?: string }): React.JSX.Element => (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 [&_svg]:size-full [&_svg]:fill-current",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
  return Icon;
};

const FAMILY_ICON: Record<Family, React.ComponentType<{ className?: string }>> = {
  npm: brandIcon(npmSvg),
  go: brandIcon(goSvg),
  rust: brandIcon(rustSvg),
  python: brandIcon(pythonSvg),
  dotnet: brandIcon(dotnetSvg),
  custom: Pencil,
};

const runnerChips = (
  runners: readonly string[],
  value: string,
  onPick: (runner: string) => void,
): React.JSX.Element => (
  <ToggleGroup
    variant="outline"
    size="sm"
    className="flex max-w-full flex-wrap"
    value={[value]}
    onValueChange={(group: string[]) => {
      const next = group[0];
      if (next !== undefined && runners.includes(next)) {
        onPick(next);
      }
    }}
  >
    {runners.map((runner) => (
      <ToggleGroupItem key={runner} value={runner} className="px-2.5 text-xs">
        {runner}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);

const familyPresetChips = (family: Family): readonly {
  id: string;
  title: string;
  command: string;
}[] => PRESETS.filter((preset) => preset.family === family);

/** Dialog 内的详细表单：草稿态，确定才提交。 */
function FamilyFormDialog({
  open,
  initial,
  initialEnvRemoved,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  initial: FamilyFormState;
  initialEnvRemoved: boolean;
  onOpenChange(open: boolean): void;
  onApply(state: FamilyFormState, envRemoved: boolean): void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(initial);
  const [envRemoved, setEnvRemoved] = React.useState(initialEnvRemoved);

  // 草稿只在打开瞬间从已提交状态重建（initial 仅作初值，不追踪后续变化）。
  React.useEffect(() => {
    if (open) {
      setDraft(initial);
      setEnvRemoved(initialEnvRemoved);
    }
  }, [open, initial, initialEnvRemoved]);

  const patch = (part: Partial<FamilyFormState>): void =>
    setDraft((prev) => ({ ...prev, ...part }));

  const preview = derivePreview(draft);
  const envPresets = envPresetsFor(draft);
  const command = buildCommand(draft);
  const rust = draft.family === "rust" ? buildRustCommands(draft) : null;
  const FamilyIcon = FAMILY_ICON[draft.family];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FamilyIcon className="size-4 text-muted-foreground" />
            配置 {FAMILY_LABEL[draft.family]} 系列命令
          </DialogTitle>
          <DialogDescription>
            修改字段实时预览命令与默认应用标识；确定后写回命令行。常用命令可用输入框下方的预设一键填充。
          </DialogDescription>
        </DialogHeader>

        <div key={draft.family} className="space-y-4">
          {draft.family === "npm" ? (
            <>
              <div>
                <Label>Runner</Label>
                <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                  同一包换 runner 推导结果不变；deno run 自动补 npm: 前缀。
                </p>
                {runnerChips(NPM_RUNNERS, draft.runner, (runner) =>
                  patch({ runner }),
                )}
              </div>
              {draft.runnerFlags.length > 0 || draft.runner === "deno run" ? (
                <div>
                  <Label>Runner 参数</Label>
                  <Input
                    className="mt-1.5 font-mono text-xs"
                    placeholder="-A"
                    value={draft.runnerFlags}
                    onChange={(event) => patch({ runnerFlags: event.target.value })}
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div>
                  <Label>包名</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    支持 @scope/name 与 npm: 前缀。
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="@deepseek-ai/dsh"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>版本</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    留空 = latest。
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="latest"
                    value={draft.version}
                    onChange={(event) => patch({ version: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>运行参数</Label>
                <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                  追加在包名之后；子命令参与 appId 推导。
                </p>
                <Input
                  className="mt-0 font-mono text-xs"
                  placeholder="web --port 3000"
                  value={draft.args}
                  onChange={(event) => patch({ args: event.target.value })}
                />
              </div>
            </>
          ) : null}

          {draft.family === "go" ? (
            <>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div>
                  <Label>Module 路径</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    取末段作为身份，如 rsc.io/fortune → fortune。
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="rsc.io/fortune"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>版本</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    留空 = 本地/默认。
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="latest"
                    value={draft.version}
                    onChange={(event) => patch({ version: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>运行参数</Label>
                <Input
                  className="mt-0 font-mono text-xs"
                  placeholder="serve --port 8080"
                  value={draft.args}
                  onChange={(event) => patch({ args: event.target.value })}
                />
              </div>
            </>
          ) : null}

          {draft.family === "rust" && rust !== null ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>安装 crate</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    cargo install 目标；Rust 不能直跑，需先安装。
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="ripgrep"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>运行二进制</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    留空默认与 crate 同名。
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder={draft.pkg.trim().length > 0 ? draft.pkg.trim() : "二进制名"}
                    value={draft.binary}
                    onChange={(event) => patch({ binary: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>运行参数</Label>
                <Input
                  className="mt-0 font-mono text-xs"
                  placeholder="--json ."
                  value={draft.args}
                  onChange={(event) => patch({ args: event.target.value })}
                />
              </div>
              <div className="space-y-1 rounded-lg bg-muted/60 p-2.5 font-mono text-xs">
                <p className="text-muted-foreground">
                  <span className="mr-1.5 select-none">$</span>
                  {rust.install}
                </p>
                <p>
                  <span className="mr-1.5 select-none text-muted-foreground">$</span>
                  {rust.run}
                </p>
              </div>
            </>
          ) : null}

          {draft.family === "python" ? (
            <>
              <div>
                <Label>Runner</Label>
                {runnerChips(PYTHON_RUNNERS, draft.runner, (runner) =>
                  patch({ runner }),
                )}
              </div>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div>
                  <Label>包名</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    包名中的 . _ 归一为 - 参与推导。
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="ruff"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>版本</Label>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="latest"
                    value={draft.version}
                    onChange={(event) => patch({ version: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>运行参数</Label>
                <Input
                  className="mt-0 font-mono text-xs"
                  placeholder="format --check ."
                  value={draft.args}
                  onChange={(event) => patch({ args: event.target.value })}
                />
              </div>
            </>
          ) : null}

          {draft.family === "dotnet" ? (
            <>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div>
                  <Label>工具 ID</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    .NET 10 dnx：NuGet 工具临时运行，无需安装。
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="dotnet-format"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>版本</Label>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="latest"
                    value={draft.version}
                    onChange={(event) => patch({ version: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>运行参数</Label>
                <Input
                  className="mt-0 font-mono text-xs"
                  placeholder="--verify-no-changes"
                  value={draft.args}
                  onChange={(event) => patch({ args: event.target.value })}
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2">
          <code className="min-w-0 flex-1 font-mono text-xs break-all">
            {command.length > 0 ? (
              command
            ) : (
              <span className="text-muted-foreground">填写后生成命令…</span>
            )}
          </code>
        </div>

        <EnvPresetRow
          presets={envPresets}
          removed={envRemoved}
          onRemovedChange={setEnvRemoved}
        />

        <DerivationStrip preview={preview} />

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button onClick={() => onApply(draft, envRemoved)}>
            <Check />
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FamilyCommandPage(): React.JSX.Element {
  const initial = presetById("dsh")?.state ?? EMPTY_FAMILY_STATE;
  const [state, setState] = React.useState<FamilyFormState>(initial);
  const [envPresetRemoved, setEnvPresetRemoved] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // `?dialog=1` 深链直接打开表单 Dialog（演示/验证用）。
  React.useEffect(() => {
    if (new URLSearchParams(location.search).get("dialog") === "1") {
      setDialogOpen(true);
    }
  }, []);

  const switchFamily = (family: Family): void => {
    setState({
      ...EMPTY_FAMILY_STATE,
      family,
      runner: family === "python" ? "uvx" : family === "npm" ? "npx" : "",
    });
    setEnvPresetRemoved(false);
  };

  const preview = derivePreview(state);
  const command = buildCommand(state);
  const activePresets = envPresetsFor(state).filter(
    () => !envPresetRemoved,
  );
  const presets = familyPresetChips(state.family);
  const FamilyIcon = FAMILY_ICON[state.family];
  const isCustom = state.family === "custom";

  // env 图标 Tooltip：hover/focus 即时显示，click 额外「钉住」，再点或 Esc/点外部解除。
  const [envHovered, setEnvHovered] = React.useState(false);
  const [envFocused, setEnvFocused] = React.useState(false);
  const [envPinned, setEnvPinned] = React.useState(false);
  const envOpen = envHovered || envFocused || envPinned;

  /** 预设挂在输入组外面：一键填充已提交状态，不经过 Dialog。 */
  const applyPreset = (id: string): void => {
    const preset = presetById(id);
    if (preset === undefined) {
      return;
    }
    setState(preset.state);
    setEnvPresetRemoved(false);
  };

  return (
    <WizardScaffold>
      <section className="rounded-xl border border-border bg-card p-4">
        {/* InputGroup + 附属预设条：输入行单高度，预设挂在输入组外面 */}
        <div className="w-full rounded-lg border border-input bg-transparent transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <div className="flex h-9 items-stretch">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex w-11 items-center justify-center gap-0.5 rounded-tl-lg border-r border-input transition-colors outline-none hover:bg-accent focus-visible:z-10 focus-visible:border-ring"
                aria-label={`命令系列：${FAMILY_LABEL[state.family]}，点击切换`}
                title={`命令系列：${FAMILY_LABEL[state.family]}`}
              >
                <FamilyIcon className="size-4 text-muted-foreground" />
                {/* 下拉箭头：明示此处可切换系列 */}
                <ChevronDown className="size-3 text-muted-foreground/70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-36">
                {FAMILY_ORDER.map((family) => {
                  const ItemIcon = FAMILY_ICON[family];
                  return (
                    <DropdownMenuItem
                      key={family}
                      onClick={() => switchFamily(family)}
                      className={
                        family === state.family ? "bg-accent/60" : undefined
                      }
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
                className="h-full w-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm outline-none placeholder:text-muted-foreground"
                placeholder="docker compose up -d"
                value={state.raw}
                onChange={(event) =>
                  setState((prev) => ({ ...prev, raw: event.target.value }))
                }
              />
            ) : (
              <button
                type="button"
                className="h-full min-w-0 flex-1 cursor-pointer truncate px-2.5 text-left font-mono text-sm outline-none select-none"
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
                open={envOpen}
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

            <div className="flex items-center gap-1 pr-1">
              <CopyButton text={command} />
              <DemoRunButton />
            </div>
          </div>

          {presets.length > 0 ? (
            <div className="border-t border-input px-2.5 py-1.5">
              <PresetChipRow presets={presets} onPick={applyPreset} />
            </div>
          ) : null}
        </div>

        <FamilyFormDialog
          open={dialogOpen}
          initial={state}
          initialEnvRemoved={envPresetRemoved}
          onOpenChange={setDialogOpen}
          onApply={(next, envRemoved) => {
            setState(next);
            setEnvPresetRemoved(envRemoved);
            setDialogOpen(false);
          }}
        />
      </section>

      <AppIdentityCard preview={preview} />
    </WizardScaffold>
  );
}
