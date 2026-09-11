// Orthogonal intents (maintained 2026-08-19; original user request: create a
// locally hosted app from the frozen wizard form; 2026-08-19 the terminal
// window became a first-class abnormal-exit surface in EVERY generated app —
// decisions D2/D4 in
// openspec/changes/create-no-first-launch-force-terminal/plans/plan.md):
// 1. Write a self-contained consumer project that depends only on published packages.
// 2. Persist the frozen identity, command vector, and service port as app config.
// 3. Generate an entry that supervises the command and owns tray+window lifetime.
// 4. Unconditionally scaffold the shell host (terminal window + toolbar page
//    assets) and the native PTY dependency — `shell` options only tune
//    initial terminal visibility; the toolbar is a `window.toolbar` fact.

import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { LaunchVector } from "./launch-vector";
import { createEntrySource } from "./entry-template";
import { createUrlEntrySource } from "./url-entry-template";
import { shellServerSource } from "./shell-server-template";

export { createEntrySource };
export { createUrlEntrySource };
import { toProjectDirectoryName } from "./app-id";

export interface ScaffoldAppConfig {
  readonly schemaVersion: 1;
  readonly appId: string;
  readonly appName: string;
  /** Command source; exactly one of command/url is present (v1 XOR). */
  readonly command?: LaunchVector;
  /** URL source: the address the generated window opens directly. */
  readonly url?: string;
  readonly service: { readonly port: number };
  readonly window: {
    readonly width: number;
    readonly height: number;
    /**
     * Host the native navigation-toolbar carrier (add-webview-orchestration
     * D12/D13): one toolbar webview above one content webview per generated
     * window, for BOTH URL and command applications. This is the one
     * canonical toolbar field — the legacy shell `showAddressBar` input is
     * retired (stale frozen occurrences are ignored by loose parsing).
     */
    readonly toolbar?: boolean;
    readonly titleFollowsDocument: boolean;
    readonly iconFollowsDocument: boolean;
  };
  /** Tray icon asset (written by materialize); omitted → text-only tray. */
  readonly trayIcon?: { readonly path: string; readonly template: boolean };
  /** Generated-app shell options (startup terminal visibility only). */
  readonly shell?: {
    readonly showTerminal: boolean;
  };
  /** v1 developerMode: only WebView DevTools admission; default false. */
  readonly developerMode?: boolean;
}

export interface ScaffoldOptions {
  readonly config: ScaffoldAppConfig;
  readonly targetDir: string;
  /** opentray/@opentray/ext-webview version range written into package.json. */
  readonly dependencyRange: string;
  /** Whether install will be skipped; only affects README guidance text. */
  readonly skipInstall?: boolean;
  /** Directory holding the prebuilt shell UI (copied to app-shell/).
   * Defaults to the adapter-staged assets resolved from the running package
   * layout (published create-opentray/dist/shell, or the workspace build). */
  readonly shellAssetsDir?: string;
}

export interface ScaffoldResult {
  readonly projectDir: string;
  readonly entryPath: string;
  readonly configPath: string;
  readonly appIconDir: string;
  readonly writtenFiles: readonly string[];
}

/** Filenames that identify a directory as a create-opentray project. */
export const SCAFFOLD_MARKER_FILES = [
  "opentray.app.json",
  "main.mjs",
] as const;

export const writeScaffold = async (options: ScaffoldOptions): Promise<ScaffoldResult> => {
  const projectDir = resolve(options.targetDir);
  const isUrlApp = options.config.url !== undefined;
  // D12/D13: a URL app hosts shell assets ONLY in toolbar mode (the toolbar
  // page); command apps always do (terminal = abnormal-exit surface, and the
  // toolbar service window needs the toolbar page too).
  const hostShell = !isUrlApp || options.config.window.toolbar === true;
  await mkdir(join(projectDir, "app-icon"), { recursive: true });

  const writtenFiles: string[] = [];
  const write = async (relative: string, content: string): Promise<void> => {
    const path = join(projectDir, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
    writtenFiles.push(relative);
  };

  await write("package.json", createPackageJson(options));
  await write("opentray.app.json", `${JSON.stringify(options.config, null, 2)}\n`);
  await write("main.mjs", isUrlApp ? createUrlEntrySource(options.config) : createEntrySource(options.config));
  if (hostShell) {
    await write("app-shell-server.mjs", createShellServerSource(options.config));
    const shellAssetsDir = options.shellAssetsDir ?? (await resolveBundledShellAssetsDir());
    if (shellAssetsDir !== undefined) {
      await cp(shellAssetsDir, join(projectDir, "app-shell"), { recursive: true });
      writtenFiles.push("app-shell/");
    }
  }
  await write("README.md", createReadme(options));
  await write(".gitignore", ["node_modules/\n", "app.log\n", "dist/\n"].join(""));

  return {
    projectDir,
    entryPath: join(projectDir, "main.mjs"),
    configPath: join(projectDir, "opentray.app.json"),
    appIconDir: join(projectDir, "app-icon"),
    writtenFiles,
  };
};

/**
 * Locate the adapter-staged shell UI (terminal.html/toolbar.html + assets).
 * Layouts, in order:
 * - published create-opentray: `dist/shell` beside the package root (resolved
 *   through the package self-reference; core is bundled into that dist);
 * - source checkout: `<create root>/dist/shell` (built) or the create-webui
 *   vite output one workspace up.
 * Undefined means "no staged assets found" — the entry still runs; only the
 * optional terminal/toolbar pages would 404.
 */
const resolveBundledShellAssetsDir = async (): Promise<string | undefined> => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = new Set<string>([
    join(moduleDir, "shell"),
    join(moduleDir, "..", "dist", "shell"),
    join(moduleDir, "..", "..", "..", "dist", "shell"),
    join(moduleDir, "..", "..", "..", "create-webui", "dist"),
  ]);
  try {
    const require = createRequire(import.meta.url);
    const createPkg = require.resolve("create-opentray/package.json");
    candidates.add(join(dirname(createPkg), "dist", "shell"));
  } catch {
    // create-opentray is not resolvable from here (dev layouts rely on the
    // relative candidates above).
  }
  for (const candidate of candidates) {
    if (await access(join(candidate, "index.html")).then(() => true, () => false)) {
      return candidate;
    }
  }
  return undefined;
};

const createPackageJson = (options: ScaffoldOptions): string => {
  const dependencies: Record<string, string> = {
    opentray: options.dependencyRange,
    "@opentray/ext-webview": options.dependencyRange,
  };
  if (options.config.url === undefined) {
    // D4: the command ALWAYS runs through a PTY (preview-parity TTY
    // environment); the optional startup-terminal window is only one consumer.
    // URL apps supervise nothing — no PTY dependency (D3 of add-create-url-apps).
    dependencies["@lydell/node-pty"] = "^1.1.0";
  }
  return `${JSON.stringify(
    {
      name: toProjectDirectoryName(options.config.appId),
      version: "0.1.0",
      private: true,
      type: "module",
      description: `${options.config.appName} — OpenTray-hosted app generated by create-opentray`,
      scripts: {
        start: "node main.mjs",
      },
      dependencies,
    },
    null,
    2,
  )}\n`;
};

const createReadme = (options: ScaffoldOptions): string => {
  if (options.config.url !== undefined) {
    return `# ${options.config.appName}

Generated by \`create-opentray\`. This app hosts the recorded URL in an
OpenTray tray + application window and can be pinned to the taskbar
(Windows) or Dock (macOS).

## Run

${options.skipInstall === true ? "Install dependencies first, then:" : ""}
\`\`\`bash
npm run start
\`\`\`

- Address: ${options.config.url}
- Logs: \`app.log\`

## Files

- \`opentray.app.json\` — frozen identity and address
- \`app-icon/\` — generated platform icon catalog (ICNS/ICO/PNG)
- \`main.mjs\` — app entry: owns the tray session and the direct window
`;
  }
  return `# ${options.config.appName}

Generated by \`create-opentray\`. This app supervises the recorded start
command, hosts it in an OpenTray tray + application window, and can be pinned
to the taskbar (Windows) or Dock (macOS).

## Run

${options.skipInstall === true ? "Install dependencies first, then:" : ""}
\`\`\`bash
npm run start
\`\`\`

- Service: ${options.config.service.port > 0 ? `http://127.0.0.1:${options.config.service.port} (preview hint; re-sniffed at runtime)` : "sniffed at runtime from the command's owned listening ports"}
- Command: \`${options.config.command?.command ?? ""} ${options.config.command?.args.join(" ") ?? ""}\`
- Logs: \`app.log\`

## Files

- \`opentray.app.json\` — frozen identity and launch vector
- \`app-icon/\` — generated platform icon catalog (ICNS/ICO/PNG)
- \`main.mjs\` — app entry: supervises the command and owns the tray session
`;
};

/** Shell server entry source: static UI + PTY stream + port state (round 9). */
export const createShellServerSource = (config: ScaffoldAppConfig): string =>
  shellServerSource({
    commandDisplay: `${config.command?.command ?? ""} ${config.command?.args.join(" ") ?? ""}`.trim(),
  });
