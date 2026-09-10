// Orthogonal intents (maintained 2026-08-19; original user requests:
// 2026-08-19 「其它模式，主体部分是一个 ReadonlyInput，点击不能输入但是会弹出
// 一个 formDialog…在 Dialog 里面进行详细的操作」；同日 R5 拍板 env「以外面
// 用户自己配置的 env 信息为唯一可信源…改动本质上就是投影到外面」):
// 1. 系列结构化字段表单（runner/包名/版本/参数；Rust 二进制 + 安装行展示）。
// 2. Dialog 内系列切换（「暂存并切换」，custom 不参与）与取消/确定会话语义。
// 3. env 预设行：用户 env 配置行的双向投影（三态，即时生效，不属会话草稿）。
// 4. 轻量 appId 预览。
// 妥协声明：表单字段渲染与会话回调集中在受控组件（父组件持有会话状态），
// 未再拆分——字段集按系列差异大且组件树浅，拆分收益低于引入的间接层；
// 正交意图清单如上持续维护。生产不含预设命令（用户明确：预设仅测试用）。
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
  FAMILY_ORDER,
  NPM_RUNNERS,
  PYTHON_RUNNERS,
  toProjectDirectoryName,
  type Family,
  type FamilyFormState,
} from "@/lib/command-family";
import { familyLabel } from "@/lib/family-label";
import { fmt } from "@/i18n";
import { usePreferences } from "@/preferences";
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

/** env 预设在外层 env 配置行上的投影状态（D4 R10：env 行是唯一可信源，
 *  无隐形注入——有条目 = 启用并显示用户值；无条目 = 未启用（+ 启用入口）。 */
export interface EnvPresetProjection {
  readonly key: string;
  readonly defaultNote: string;
  /** explicit = env 行已有同名条目（value 为生效值，last-wins）。 */
  readonly state: "explicit" | "off";
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
  const { messages } = usePreferences();
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
                aria-label={messages.family.switchAria}
                title={messages.family.switchAria}
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
                      {familyLabel(family, messages)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {fmt(messages.family.dialogTitle, { name: familyLabel(draft.family, messages) })}
          </DialogTitle>
          <DialogDescription>{messages.family.dialogDescription}</DialogDescription>
        </DialogHeader>

        <div key={draft.family} className="space-y-4">
          {draft.family === "npm" ? (
            <>
              <div>
                <Label>{messages.family.runner}</Label>
                <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                  {messages.family.runnerHint}
                </p>
                {runnerChips(NPM_RUNNERS, draft.runner, (runner) =>
                  patch({ runner }),
                )}
              </div>
              {draft.runnerFlags.length > 0 || draft.runner === "deno run" ? (
                <div>
                  <Label>{messages.family.runnerFlags}</Label>
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
                  <Label>{messages.family.pkg}</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    {messages.family.pkgHint}
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="@deepseek-ai/dsh"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>{messages.family.version}</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    {messages.family.versionLatest}
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
                <Label>{messages.family.args}</Label>
                <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                  {messages.family.argsHint}
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
                  <Label>{messages.family.modulePath}</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    {messages.family.modulePathHint}
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="rsc.io/fortune"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>{messages.family.version}</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    {messages.family.versionLocal}
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
                <Label>{messages.family.args}</Label>
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
                  <Label>{messages.family.crate}</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    {messages.family.crateHint}
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="ripgrep"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>{messages.family.binary}</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    {messages.family.binaryHint}
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder={
                      draft.pkg.trim().length > 0 ? draft.pkg.trim() : messages.family.binaryPlaceholder
                    }
                    value={draft.binary}
                    onChange={(event) => patch({ binary: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>{messages.family.args}</Label>
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
                <Label>{messages.family.runner}</Label>
                {runnerChips(PYTHON_RUNNERS, draft.runner, (runner) =>
                  patch({ runner }),
                )}
              </div>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div>
                  <Label>{messages.family.pkg}</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    {messages.family.pkgPythonHint}
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="ruff"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>{messages.family.version}</Label>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="latest"
                    value={draft.version}
                    onChange={(event) => patch({ version: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>{messages.family.args}</Label>
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
                  <Label>{messages.family.toolId}</Label>
                  <p className="mt-0.5 mb-1.5 text-[11px] text-muted-foreground">
                    {messages.family.toolIdHint}
                  </p>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="dotnet-format"
                    value={draft.pkg}
                    onChange={(event) => patch({ pkg: event.target.value })}
                  />
                </div>
                <div>
                  <Label>{messages.family.version}</Label>
                  <Input
                    className="mt-0 font-mono text-xs"
                    placeholder="latest"
                    value={draft.version}
                    onChange={(event) => patch({ version: event.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label>{messages.family.args}</Label>
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
              <span className="text-muted-foreground">
                {messages.family.commandPreviewEmpty}
              </span>
            )}
          </code>
        </div>

        {envPreset !== null ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              {messages.family.envPresetTitle}
            </span>
            {envPreset.state === "off" ? (
              <button
                type="button"
                className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:bg-accent hover:text-foreground hover:underline"
                title={envPreset.defaultNote}
                onClick={() => onEnvPresetChange("enable")}
              >
                {fmt(messages.family.presetEnable, { key: envPreset.key })}
              </button>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 py-0.5 pr-1 pl-1.5 font-mono text-[11px]"
                title={messages.family.envPresetSourceDialog}
              >
                {envPreset.key}={envPreset.explicitValue ?? ""}
                <span className="font-sans text-[10px] text-muted-foreground">
                  {messages.family.presetConfigured}
                </span>
                <button
                  type="button"
                  aria-label={messages.family.presetRemove}
                  title={envPreset.defaultNote}
                  className="rounded px-1 text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onEnvPresetChange("disable")}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">{messages.family.presetNone}</p>
        )}

        <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-[11px] text-muted-foreground">{messages.family.appIdPreview}</p>
          <code className="font-mono text-sm font-medium break-all">
            {preview.appId}
          </code>
          <p className="text-[11px] text-muted-foreground">
            {fmt(messages.family.namePreview, {
              name: preview.appName,
              dir: toProjectDirectoryName(preview.appId),
            })}
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{messages.common.cancel}</DialogClose>
          <Button
            onClick={() => {
              onApply(draft);
            }}
          >
            <Check />
            {messages.family.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
