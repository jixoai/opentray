// @vitest-environment jsdom
// 组件状态机交互测试（Codex R6 点名）：覆盖「编辑→取消→重开丢弃」「服务端
// 投影播种后切走切回保留」「确定回写命令与作者投影」三条序列（plan D11 R5）。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import { DEFAULT_COMMAND_OPTIONS, type WizardCommandOptions } from "@/wizard-protocol";
import { CommandFamilyInput } from "./command-family-input";

afterEach(cleanup);

const npmProjection: NonNullable<WizardCommandOptions["family"]> = {
  family: "npm",
  runner: "npx",
  runnerFlags: "",
  pkg: "cowsay",
  version: "",
  args: "hello",
  binary: "",
  raw: "",
};

interface Harness {
  command: string;
  options: WizardCommandOptions;
  onCommandChange: Mock<(command: string) => void>;
  onCommandOptionsChange: Mock<(options: WizardCommandOptions) => void>;
}

const renderInput = (harness: Harness): ReturnType<typeof render> =>
  render(
    <CommandFamilyInput
      command={harness.command}
      onCommandChange={harness.onCommandChange}
      commandOptions={harness.options}
      onCommandOptionsChange={(next) => {
        harness.options = next;
        harness.onCommandOptionsChange(next);
      }}
      disabled={false}
      onRun={() => {}}
    />,
  );

const switchTo = async (container: HTMLElement, label: string): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: /^命令系列/ }));
  await waitFor(() => {
    expect(screen.getByRole("menuitem", { name: new RegExp(label) })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) }));
};

describe("CommandFamilyInput 状态机", () => {
  it("服务端投影播种：恢复 npm → 切 Go → 切回 npm 不退化为空模板", async () => {
    const harness: Harness = {
      command: "npx cowsay hello",
      options: { ...DEFAULT_COMMAND_OPTIONS, family: npmProjection },
      onCommandChange: vi.fn(),
      onCommandOptionsChange: vi.fn(),
    };
    const view = renderInput(harness);
    // 恢复态：npm 选择器 + 只读命令区。
    expect(
      screen.getByRole("button", { name: "命令系列：npm，点击切换" }),
    ).toBeTruthy();
    // 切到 Go：上传 Go 模板投影。
    await switchTo(view.container, "^Go$");
    const goPatch = harness.onCommandOptionsChange.mock.calls.at(-1)?.[0] as WizardCommandOptions;
    expect(goPatch.family?.family).toBe("go");
    // 切回 npm：播种缓存生效，投影恢复 cowsay 而非空模板。
    await switchTo(view.container, "^npm$");
    const backPatch = harness.onCommandOptionsChange.mock.calls.at(-1)?.[0] as WizardCommandOptions;
    expect(backPatch.family?.pkg).toBe("cowsay");
    expect(backPatch.family?.args).toBe("hello");
  });

  it("取消丢弃：Dialog 编辑 → 取消 → 重开回到打开时初值", async () => {
    const harness: Harness = {
      command: "npx cowsay hello",
      options: { ...DEFAULT_COMMAND_OPTIONS, family: npmProjection },
      onCommandChange: vi.fn(),
      onCommandOptionsChange: vi.fn(),
    };
    renderInput(harness);
    const openDialog = () =>
      fireEvent.click(screen.getByRole("button", { name: "配置 npm 系列命令" }));

    openDialog();
    const pkgBox = await screen.findByPlaceholderText("@deepseek-ai/dsh");
    expect((pkgBox as HTMLInputElement).value).toBe("cowsay");
    fireEvent.change(pkgBox, { target: { value: "edited-pkg" } });
    expect((pkgBox as HTMLInputElement).value).toBe("edited-pkg");
    // 取消：本次编辑不落地。
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("@deepseek-ai/dsh")).toBeNull();
    });
    // 重开：回到打开时初值（cowsay），已取消的 edited-pkg 不出现。
    openDialog();
    const reopened = await screen.findByPlaceholderText("@deepseek-ai/dsh");
    expect((reopened as HTMLInputElement).value).toBe("cowsay");
  });

  it("确定回写：命令串与作者投影一并上传", async () => {
    const harness: Harness = {
      command: "npx cowsay hello",
      options: { ...DEFAULT_COMMAND_OPTIONS, family: npmProjection },
      onCommandChange: vi.fn(),
      onCommandOptionsChange: vi.fn(),
    };
    renderInput(harness);
    fireEvent.click(screen.getByRole("button", { name: "配置 npm 系列命令" }));
    const pkgBox = await screen.findByPlaceholderText("@deepseek-ai/dsh");
    fireEvent.change(pkgBox, { target: { value: "ruff" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      expect(harness.onCommandChange).toHaveBeenCalledWith("npx ruff hello");
    });
    const patch = harness.onCommandOptionsChange.mock.calls.at(-1)?.[0] as WizardCommandOptions;
    expect(patch.family?.pkg).toBe("ruff");
  });
});
