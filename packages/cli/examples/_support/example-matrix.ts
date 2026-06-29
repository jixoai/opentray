import { existsSync } from "node:fs";
import { join } from "node:path";

export type ExampleMatrixCoverage =
  | "protocol"
  | "default-runtime"
  | "extension-debug-runtime";

export interface ExampleCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface ExampleMatrixRow {
  readonly id: string;
  readonly coverage: ExampleMatrixCoverage;
  readonly description: string;
  readonly command: ExampleCommand;
  readonly preflight?: readonly ExampleCommand[];
  readonly platforms?: readonly NodeJS.Platform[];
  readonly requiredPaths?: readonly string[];
}

export interface PlannedExampleMatrixRow extends ExampleMatrixRow {
  readonly skipped: boolean;
  readonly skipReason?: string;
}

export interface CreateExampleMatrixOptions {
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly workspaceRoot: string;
}

const WEBVIEW_PLATFORMS: readonly NodeJS.Platform[] = ["darwin", "win32"];
const LYNX_PLATFORMS: readonly NodeJS.Platform[] = ["darwin"];

export const createExampleMatrix = ({
  platform = process.platform,
  arch = process.arch,
  workspaceRoot,
}: CreateExampleMatrixOptions): PlannedExampleMatrixRow[] => {
  const lynxSource = lynxExtensionSourcePath(platform, workspaceRoot);
  const rows = createRows({
    platform,
    arch,
    lynxSource,
  });
  return rows.map((row) => planRow(row, platform, workspaceRoot));
};

const createRows = ({
  platform,
  arch,
  lynxSource,
}: {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly lynxSource: string | undefined;
}): ExampleMatrixRow[] => [
  {
    id: "basic",
    coverage: "protocol",
    description: "protocol-only tray/client example",
    command: pnpmExample("example:basic"),
  },
  {
    id: "first-app",
    coverage: "default-runtime",
    description: "direct createTray quickstart through the default local broker",
    platforms: WEBVIEW_PLATFORMS,
    preflight: [command("cargo", ["build", "-p", "opentray-bin"])],
    command: pnpmExample("example:first-app"),
  },
  {
    id: "webview-control",
    coverage: "extension-debug-runtime",
    description: "ext-webview control window through debug runtime",
    platforms: WEBVIEW_PLATFORMS,
    command: pnpmExample("example:webview-control", {
      OPENTRAY_EXAMPLE_EXIT_AFTER_MS: "1200",
    }),
  },
  {
    id: "debug-runtime-tray",
    coverage: "extension-debug-runtime",
    description: "single-primary tray event routed to ext-webview",
    platforms: WEBVIEW_PLATFORMS,
    command: pnpmExample("example:debug-runtime-tray", {
      OPENTRAY_EXAMPLE_WEBVIEW_SMOKE: "1",
    }),
  },
  {
    id: "tray-panel",
    coverage: "extension-debug-runtime",
    description: "tray-anchored ext-webview panel",
    platforms: WEBVIEW_PLATFORMS,
    command: pnpmExample("example:tray-panel", {
      OPENTRAY_EXAMPLE_WEBVIEW_SMOKE: "1",
    }),
  },
  {
    id: "placement",
    coverage: "extension-debug-runtime",
    description: "ext-webview placement kit panel",
    platforms: WEBVIEW_PLATFORMS,
    command: pnpmExample("example:placement", {
      OPENTRAY_EXAMPLE_WEBVIEW_SMOKE: "1",
    }),
  },
  {
    id: "media-query",
    coverage: "extension-debug-runtime",
    description: "ext-webview media query kit panel",
    platforms: WEBVIEW_PLATFORMS,
    command: pnpmExample("example:mediaQuery", {
      OPENTRAY_EXAMPLE_WEBVIEW_SMOKE: "1",
    }),
  },
  {
    id: "badge",
    coverage: "extension-debug-runtime",
    description: "ext-badge debug panel projected through ext-webview IPC",
    platforms: WEBVIEW_PLATFORMS,
    command: pnpmExample("example:badge", {
      OPENTRAY_EXAMPLE_WEBVIEW_SMOKE: "1",
    }),
  },
  {
    id: "lynx",
    coverage: "extension-debug-runtime",
    description: "ext-lynx debug runtime smoke with packaged review bundle",
    platforms: LYNX_PLATFORMS,
    ...preflight(
      lynxSource === undefined
        ? undefined
        : [
            command("cargo", ["build", "-p", "opentray-ext-lynx"]),
            command("bun", [
              "run",
              "scripts/binaries/stage-local.ts",
              "--kind",
              "lynx",
              "--source",
              lynxSource,
            ]),
          ],
    ),
    ...requiredPaths(lynxRequiredCarrierPaths(platform, arch)),
    command: {
      ...pnpmExample("example:debug-runtime-lynx", {
        OPENTRAY_EXAMPLE_EXIT_AFTER_MS: "1200",
      }),
      args: [
        "--filter",
        "opentray",
        "example:debug-runtime-lynx",
        "--",
        "--bundle",
        "packages/cli/assets/lynx-review/main.lynx.bundle",
      ],
    },
  },
];

const planRow = (
  row: ExampleMatrixRow,
  platform: NodeJS.Platform,
  workspaceRoot: string,
): PlannedExampleMatrixRow => {
  if (row.platforms !== undefined && !row.platforms.includes(platform)) {
    return {
      ...row,
      skipped: true,
      skipReason: `unsupported platform: ${platform}`,
    };
  }
  const missingPath = row.requiredPaths?.find(
    (path) => !existsSync(join(workspaceRoot, path)),
  );
  if (missingPath !== undefined) {
    return {
      ...row,
      skipped: true,
      skipReason: `missing artifact: ${missingPath}`,
    };
  }
  return { ...row, skipped: false };
};

const pnpmExample = (
  script: string,
  env?: Readonly<Record<string, string>>,
): ExampleCommand => pnpm("pnpm", ["--filter", "opentray", script], env);

const pnpm = (
  executable: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): ExampleCommand => command(executable, args, env);

const command = (
  executable: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
): ExampleCommand => ({
  command: executable,
  args,
  ...(env === undefined ? {} : { env }),
});

const preflight = (
  commands: readonly ExampleCommand[] | undefined,
): Pick<ExampleMatrixRow, "preflight"> =>
  commands === undefined ? {} : { preflight: commands };

const requiredPaths = (
  paths: readonly string[] | undefined,
): Pick<ExampleMatrixRow, "requiredPaths"> =>
  paths === undefined ? {} : { requiredPaths: paths };

export const lynxExtensionSourcePath = (
  platform: NodeJS.Platform,
  workspaceRoot: string,
): string | undefined => {
  if (platform === "darwin") {
    return join(workspaceRoot, "target/debug/libopentray_ext_lynx.dylib");
  }
  return undefined;
};

const lynxRequiredCarrierPaths = (
  platform: NodeJS.Platform,
  arch: string,
): readonly string[] | undefined => {
  if (platform !== "darwin") {
    return undefined;
  }
  const packageArch = arch === "x64" ? "x64" : "arm64";
  return [
    `packages/ext-lynx-darwin-${packageArch}/runtime/OpenTrayLynxRuntime.app.zip`,
    "packages/cli/assets/lynx-review/main.lynx.bundle",
  ];
};
