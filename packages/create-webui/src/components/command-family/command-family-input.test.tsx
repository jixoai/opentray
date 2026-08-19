// @vitest-environment jsdom
// 组件状态机交互测试（B2，2026-08-19）：真实 React state + rerender 模拟命令
// 回调和 SSE 投影，覆盖会话取消、投影刷新与 Dialog 内跨系列暂存（plan D11a）。
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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

const remoteNpmProjection: NonNullable<WizardCommandOptions["family"]> = {
  ...npmProjection,
  pkg: "figlet",
  args: "remote",
};

const goProjection: NonNullable<WizardCommandOptions["family"]> = {
  family: "go",
  runner: "",
  runnerFlags: "",
  pkg: "example.com/sse",
  version: "",
  args: "",
  binary: "",
  raw: "",
};

interface WizardSnapshot {
  readonly command: string;
  readonly options: WizardCommandOptions;
}

interface StatefulHarnessProps {
  readonly snapshot: WizardSnapshot;
}

/** 模拟 App 的 optimistic setState，以及下一条 SSE 快照替换。 */
function StatefulHarness({ snapshot }: StatefulHarnessProps): React.JSX.Element {
  const [command, setCommand] = React.useState(snapshot.command);
  const [commandOptions, setCommandOptions] = React.useState(snapshot.options);

  React.useEffect(() => {
    setCommand(snapshot.command);
    setCommandOptions(snapshot.options);
  }, [snapshot]);

  return (
    <CommandFamilyInput
      command={command}
      onCommandChange={setCommand}
      commandOptions={commandOptions}
      onCommandOptionsChange={setCommandOptions}
      disabled={false}
      onRun={() => {}}
    />
  );
}

const snapshotFor = (
  command: string,
  family: WizardCommandOptions["family"],
): WizardSnapshot => ({
  command,
  options: { ...DEFAULT_COMMAND_OPTIONS, family },
});

const renderHarness = (snapshot: WizardSnapshot): ReturnType<typeof render> =>
  render(<StatefulHarness snapshot={snapshot} />);

const rerenderSnapshot = (
  view: ReturnType<typeof render>,
  snapshot: WizardSnapshot,
): void => {
  view.rerender(<StatefulHarness snapshot={snapshot} />);
};

const inputFor = async (placeholder: string): Promise<HTMLInputElement> => {
  const element = await screen.findByPlaceholderText(placeholder);
  if (!(element instanceof HTMLInputElement)) {
    throw new TypeError(`Expected input for placeholder ${placeholder}`);
  }
  return element;
};

const openNpmDialog = (): void => {
  fireEvent.click(screen.getByRole("button", { name: "配置 npm 系列命令" }));
};

const switchOuterFamily = async (label: RegExp): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: /^命令系列/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name: label }));
};

const switchDialogFamily = async (label: RegExp): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: "切换命令系列" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: label }));
};

const cancellationPaths: readonly {
  readonly name: string;
  readonly close: () => void;
}[] = [
  {
    name: "取消按钮",
    close: () => fireEvent.click(screen.getByRole("button", { name: "取消" })),
  },
  {
    name: "右上关闭",
    close: () => fireEvent.click(screen.getByRole("button", { name: "Close" })),
  },
  {
    name: "遮罩",
    close: () => {
      const overlay = document.querySelector<HTMLElement>("[data-slot=dialog-overlay]");
      if (overlay === null) {
        throw new Error("Expected dialog overlay");
      }
      fireEvent.pointerDown(overlay);
      fireEvent.pointerUp(overlay);
      fireEvent.click(overlay);
    },
  },
  {
    name: "ESC",
    close: () => fireEvent.keyDown(document, { key: "Escape" }),
  },
];

describe("CommandFamilyInput 状态机", () => {
  it.each(cancellationPaths)(
    "编辑中 SSE 切换系列后经 $name 取消，只丢弃打开时 npm 会话草稿",
    async ({ close }) => {
      const view = renderHarness(snapshotFor("npx cowsay hello", npmProjection));
      openNpmDialog();
      const pkg = await inputFor("@deepseek-ai/dsh");
      fireEvent.change(pkg, { target: { value: "local-only" } });

      rerenderSnapshot(view, snapshotFor("go run example.com/sse", goProjection));
      await waitFor(() => {
        expect(pkg.value).toBe("local-only");
      });

      close();
      await waitFor(() => {
        expect(screen.queryByPlaceholderText("@deepseek-ai/dsh")).toBeNull();
        expect(
          screen.getByRole("button", { name: "命令系列：Go，点击切换" }),
        ).toBeTruthy();
      });

      await switchOuterFamily(/^npm$/u);
      openNpmDialog();
      expect((await inputFor("@deepseek-ai/dsh")).value).toBe("cowsay");
    },
  );

  it("编辑中同系列 SSE 不重置草稿；取消后采用最新服务端投影", async () => {
    const view = renderHarness(snapshotFor("npx cowsay hello", npmProjection));
    openNpmDialog();
    const pkg = await inputFor("@deepseek-ai/dsh");
    fireEvent.change(pkg, { target: { value: "local-only" } });

    rerenderSnapshot(view, snapshotFor("npx figlet remote", remoteNpmProjection));
    await waitFor(() => {
      expect(pkg.value).toBe("local-only");
    });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("@deepseek-ai/dsh")).toBeNull();
    });

    openNpmDialog();
    const reopened = await inputFor("@deepseek-ai/dsh");
    expect(reopened.value).toBe("figlet");
    expect((await inputFor("web --port 3000")).value).toBe("remote");
  });

  it("已播种系列收到新投影后 Go → npm，回到新投影而非旧缓存", async () => {
    const view = renderHarness(snapshotFor("npx cowsay hello", npmProjection));

    rerenderSnapshot(view, snapshotFor("npx figlet remote", remoteNpmProjection));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "命令系列：npm，点击切换" }),
      ).toBeTruthy();
    });

    await switchOuterFamily(/^Go$/u);
    await switchOuterFamily(/^npm$/u);
    openNpmDialog();
    expect((await inputFor("@deepseek-ai/dsh")).value).toBe("figlet");
    expect((await inputFor("web --port 3000")).value).toBe("remote");
  });

  it("Dialog 内显式 npm → Go → npm 切换保留未确定草稿", async () => {
    renderHarness(snapshotFor("npx cowsay hello", npmProjection));
    openNpmDialog();
    const npmPackage = await inputFor("@deepseek-ai/dsh");
    fireEvent.change(npmPackage, { target: { value: "draft-npm" } });

    await switchDialogFamily(/^Go$/u);
    const goModule = await inputFor("rsc.io/fortune");
    fireEvent.change(goModule, { target: { value: "example.com/draft-go" } });

    await switchDialogFamily(/^npm$/u);
    expect((await inputFor("@deepseek-ai/dsh")).value).toBe("draft-npm");

    await switchDialogFamily(/^Go$/u);
    expect((await inputFor("rsc.io/fortune")).value).toBe("example.com/draft-go");

    await switchDialogFamily(/^npm$/u);
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("@deepseek-ai/dsh")).toBeNull();
    });

    // 确定仅提交当前系列（npm）：命令串含 draft-npm，不含 Go 会话草稿。
    const readonly = screen.getByRole("button", { name: "配置 npm 系列命令" });
    expect(readonly.textContent).toContain("draft-npm");
    expect(readonly.textContent).not.toContain("example.com/draft-go");

    openNpmDialog();
    expect((await inputFor("@deepseek-ai/dsh")).value).toBe("draft-npm");
  });

  // Codex R8-B1：跨系列返回后的取消四路径——drafts/bases/currentFamily 均已
  // 变化的真实回退契约，此前两个用例分别覆盖取消与切换、未覆盖该组合。
  it.each(cancellationPaths)(
    "Dialog 内跨系列编辑返回后经 $name 取消：整次会话丢弃且不上传",
    async ({ close }) => {
      renderHarness(snapshotFor("npx cowsay hello", npmProjection));
      openNpmDialog();
      const npmPackage = await inputFor("@deepseek-ai/dsh");
      fireEvent.change(npmPackage, { target: { value: "draft-npm" } });

      await switchDialogFamily(/^Go$/u);
      const goModule = await inputFor("rsc.io/fortune");
      fireEvent.change(goModule, { target: { value: "example.com/draft-go" } });

      await switchDialogFamily(/^npm$/u);
      close();
      await waitFor(() => {
        expect(screen.queryByPlaceholderText("@deepseek-ai/dsh")).toBeNull();
      });

      // 编辑与取消都不上传：外层命令串仍是打开前状态。
      const readonly = screen.getByRole("button", { name: "配置 npm 系列命令" });
      expect(readonly.textContent).toContain("npx cowsay hello");
      expect(readonly.textContent).not.toContain("draft-npm");

      // npm 重开 = 打开快照；Go 会话草稿同样不可恢复（回落权威缓存/模板）。
      openNpmDialog();
      expect((await inputFor("@deepseek-ai/dsh")).value).toBe("cowsay");
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      await waitFor(() => {
        expect(screen.queryByPlaceholderText("@deepseek-ai/dsh")).toBeNull();
      });
      await switchOuterFamily(/^Go$/u);
      fireEvent.click(screen.getByRole("button", { name: "配置 Go 系列命令" }));
      expect((await inputFor("rsc.io/fortune")).value).not.toBe(
        "example.com/draft-go",
      );
    },
  );
});
