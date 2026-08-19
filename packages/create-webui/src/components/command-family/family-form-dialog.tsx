/**
 * 系列表单 Dialog（add-create-command-family D1/D7）：结构化字段（runner/包名/
 * 版本/参数；Rust 二进制 + 安装行展示）+ env 预设行 + 轻量 appId 预览。
 * 草稿语义：字段编辑只影响受控 Dialog 会话预览；会话内可暂存并切换系列，
 * 确定才回写命令串，取消丢弃整个会话（B2，2026-08-19）。
 * 生产不含预设命令（用户明确：预设仅测试用）。
 */
import { Check, ChevronDown } from "lucide-react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  buildCommand,
  buildRustCommands,
  deriveFamily,
  FAMILY_LABEL,
  FAMILY_ORDER,
  NPM_RUNNERS,
  PYTHON_RUNNERS,
  toProjectDirectoryName,
  type Family,
  type FamilyFormState,
} from "@/lib/command-family";
import { FAMILY_ICON } from "./brand-icons";

type StructuredFamily = Exclude<Family, "custom">;

const STRUCTURED_FAMILY_ORDER: readonly StructuredFamily[] = FAMILY_ORDER.filter(
  (family): family is StructuredFamily => family !== "custom",
);

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

/** env 预设在外层 env 配置行上的投影状态（D4 R5：env 行是唯一可信源）。 */
export interface EnvPresetProjection {
  readonly key: string;
  readonly defaultNote: string;
  /** explicit = env 行已有用户/投影写入的同名条目（value 为用户值）。 */
  readonly state: "explicit" | "default" | "off";
  readonly explicitValue?: string;
}

export interface FamilyFormDialogProps {
  open: boolean;
  /** 父组件会话状态的当前草稿；SSE 初值变化不能重置已编辑的会话。 */
  draft: FamilyFormState;
  /** env 预设投影（null = 此系列/runner 无预设）；即时生效，不属 Dialog 草稿。 */
  envPreset: EnvPresetProjection | null;
  onEnvPresetChange(action: "enable" | "disable"): void;
  /** 草稿每次字段变化回写当前 Dialog 会话。 */
  onDraftChange(state: FamilyFormState): void;
  /** 显式暂存当前草稿并在同一 Dialog 会话中切换系列。 */
  onFamilyChange(family: StructuredFamily): void;
  /** 取消/关闭（非确定）：丢弃本次 Dialog 会话。 */
  onCancel(): void;
  /** 确定：回写命令串。 */
  onApply(state: FamilyFormState): void;
}

export function FamilyFormDialog({
  open,
  draft,
  envPreset,
  onEnvPresetChange,
  onDraftChange,
  onFamilyChange,
  onCancel,
  onApply,
}: FamilyFormDialogProps): React.JSX.Element {
  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      onCancel();
    }
  };

  const patch = (part: Partial<FamilyFormState>): void =>
    onDraftChange({ ...draft, ...part });

  const preview = deriveFamily(draft);
  const command = buildCommand(draft);
  const rust = draft.family === "rust" ? buildRustCommands(draft) : null;
  const FamilyIcon = FAMILY_ICON[draft.family];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="切换命令系列"
                title="切换命令系列"
              >
                <FamilyIcon className="size-4" />
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-36">
                {STRUCTURED_FAMILY_ORDER.map((family) => {
                  const ItemIcon = FAMILY_ICON[family];
                  return (
                    <DropdownMenuItem
                      key={family}
                      onClick={() => onFamilyChange(family)}
                      className={family === draft.family ? "bg-accent/60" : undefined}
                    >
                      <ItemIcon className="text-muted-foreground" />
                      {FAMILY_LABEL[family]}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            配置 {FAMILY_LABEL[draft.family]} 系列命令
          </DialogTitle>
          <DialogDescription>
            修改字段实时预览命令与默认应用标识；确定后写回命令行。
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
              {/* 安装行仅为展示/复制参考（D7）：向导不代执行 cargo install。 */}
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

        {envPreset !== null ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">环境变量预设</span>
            {envPreset.state === "off" ? (
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:bg-accent hover:text-foreground hover:underline"
                title="在环境变量配置中写入该条目"
                onClick={() => onEnvPresetChange("enable")}
              >
                + {envPreset.key}=true（启用）
              </button>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 py-0.5 pr-1 pl-1.5 font-mono text-[11px]"
                title={
                  envPreset.state === "explicit"
                    ? "来自下方「环境变量」配置（唯一可信源），两侧同步"
                    : envPreset.defaultNote
                }
              >
                {envPreset.key}=
                {envPreset.state === "explicit"
                  ? (envPreset.explicitValue ?? "")
                  : "true"}
                {envPreset.state === "explicit" ? (
                  <span className="font-sans text-[10px] text-muted-foreground">env 已配置</span>
                ) : null}
                <button
                  type="button"
                  aria-label="移除环境变量预设"
                  title="从环境变量配置中移除该条目，并关闭默认注入"
                  className="rounded px-1 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onEnvPresetChange("disable")}
                >
                  ×
                </button>
              </span>
            )}
            {envPreset.state === "default" ? (
              <span className="text-[11px] text-muted-foreground" title={envPreset.defaultNote}>
                {envPreset.defaultNote}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            此系列/runner 无需注入环境变量。
          </p>
        )}

        <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-[11px] text-muted-foreground">
            默认应用标识（由命令推导，可在下方应用配置中覆盖）
          </p>
          <code className="font-mono text-sm font-medium break-all">
            {preview.appId}
          </code>
          <p className="text-[11px] text-muted-foreground">
            名称 {preview.appName} · ~/.opentray/create/
            {toProjectDirectoryName(preview.appId)}/
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
          <Button
            onClick={() => {
              onApply(draft);
            }}
          >
            <Check />
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
