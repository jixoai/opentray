/**
 * Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
 * Asia/Shanghai: 所有站点需要至少提供中英两种语言的支持——/zh/ 中文镜像页;
 * extended 2026-09-06: 官网文案要升级——子代理深入理解项目目的与初衷):
 * 1. Single source of the home-page copy per locale, purpose-led (2026-09-06
 *    release-automation-and-copy change): every claim is traceable to the
 *    repo's intent sources — README.md / README-zh.md, AGENTS.md Vision,
 *    SPEC.md — and the hero states the problem before any capability. The
 *    two dictionaries stay structurally identical so the page renders
 *    isomorphically per locale.
 * 2. Code samples and identifiers stay verbatim across locales (they are
 *    API truth, not prose); only human prose is translated.
 * 3. Locale surface facts (labels, aria strings) live here too so routes
 *    stay thin renderers.
 */

export type Locale = import('./locale').Locale;

export interface HomeContent {
  meta: { title: string; description: string };
  hero: {
    eyebrow: string;
    /** title splits around the one emphasized word (the <em> rung) */
    titlePre: string;
    titleEm: string;
    titlePost: string;
    summary: string;
    badges: string[];
    copyLabel: string;
    terminal: { barTitle: string; command: string; outputs: string[] };
    secondaryLabel: string;
  };
  quickStart: {
    eyebrow: string;
    title: string;
    summary: string;
    notePre: string;
    noteLink: string;
    notePost: string;
  };
  featuresHeading: string;
  features: { id: string; eyebrow: string; title: string; body: string; detail: string }[];
  workspace: {
    eyebrow: string;
    title: string;
    summary: string;
    headers: [string, string, string];
    rows: { dir: string; pkg: string; purpose: string }[];
  };
  ecosystem: {
    eyebrow: string;
    title: string;
    summary: string;
    links: { label: string; note: string }[];
  };
  /** chrome strings owned by the shared page shell */
  chrome: { switcherAriaLabel: string; overviewLabel: string };
}

/** The README first-app sample, verbatim in behavior (import path, icon,
 * menu shape, runtime identity options) — locale-invariant API truth. */
const QUICK_START_CODE = String.raw`import {
  createTray,
  type CreateTrayHandle,
  type CreateTrayOptions,
  type TrayIcon,
} from "opentray";

const icon: TrayIcon = { "text-only": "OT" };
let tray: CreateTrayHandle;
const options: CreateTrayOptions = {
  id: "com.example.first-app",
  icon,
  menu: {
    items: [
      {
        title: "Quit",
        primaryEvent: true,
        onMenuClick: () => void tray.destroy(),
      },
    ],
  },
};

tray = await createTray(options, {
  appId: "com.example.first-app",
  appName: "First App",
});`;

const en: HomeContent = {
  meta: {
    title: 'OpenTray · tray-first desktop status runtime',
    description:
      'OpenTray gives Node/Deno/Bun CLI tools and AI skills a resident desktop status surface: one createTray() call, a Rust broker behind a public tray/session protocol, no Electron weight.',
  },
  hero: {
    eyebrow: 'OpenTray · desktop status runtime',
    titlePre: 'A desktop home for your CLI and AI skills — ',
    titleEm: 'without',
    titlePost: ' the weight of an app framework.',
    summary:
      'CLI tools and AI skills do long, quiet work — builds, agents, watchers — and finish in a terminal nobody keeps open. OpenTray is a desktop status runtime for Node, Deno, and Bun: one createTray() call starts the local broker automatically and puts a resident status atom in the tray — Rust core, public tray/session protocol, no Node addon, no app framework.',
    badges: ['Node · Deno · Bun', 'Rust core · no addon', 'one call: createTray()', 'MIT'],
    copyLabel: 'copy',
    terminal: {
      barTitle: 'opentray — first-app',
      command: 'node first-app.mjs',
      outputs: [
        'broker: started automatically — Rust core',
        'tray: com.example.first-app · icon "OT" resident',
        'menu: Quit (primaryEvent)',
        'session: live — events streaming',
      ],
    },
    secondaryLabel: 'GitHub ↗',
  },
  quickStart: {
    eyebrow: 'Quick start',
    title: 'One install, one createTray()',
    summary:
      'The packaged runtime starts the local broker on first use — visible tray text is icon projection, runtime identity (appId/appName) is separate, and primaryEvent is a role on a normal menu item that emits the usual menuClick.',
    notePre: 'Already have a command that serves HTTP locally?',
    noteLink: 'npx create-opentray',
    notePost: ' wraps it into an OpenTray-hosted app.',
  },
  featuresHeading: 'What&rsquo;s inside',
  features: [
    {
      id: 'why',
      eyebrow: 'Why it exists',
      title: 'Not a tray icon — an entry point',
      body: 'The goal was never "show a tray icon": lightweight tools deserve a system-level entry point without being forced into Electron or a full desktop app framework. The model stays four atoms: App is the caller-owned runtime identity and isolation boundary, Tray is one desktop status atom, Session is the live source of authority for tray events and mutations, Extension is the optional native capability atom.',
      detail: 'App · Tray · Session · Extension',
    },
    {
      id: 'create-tray',
      eyebrow: 'SDK',
      title: 'One call owns its lifetime',
      body: 'You should not bootstrap an app shell to show status. Application code calls createTray() directly and owns foreground/background lifetime itself. Top-level createTray(...) and its returned setMenu(...) accept app-facing menu shorthand; lower-level createClient(...) stays protocol-only for tools that need exact wire shapes.',
      detail: 'opentray · menu shorthand · typed handles',
    },
    {
      id: 'broker',
      eyebrow: 'Rust core',
      title: 'A broker, not an addon',
      body: 'Why trust a tray that arrives over npm? The native side is a Rust core delivered as a packaged executable: the default createTray() transport targets the local runtime host and starts it on first use when needed, and ordinary app code talks to it through the public tray/session protocol. No Node addon, no worker split for tray work.',
      detail: 'tray/session protocol · auto-started Rust host',
    },
    {
      id: 'create-opentray',
      eyebrow: 'Onboarding',
      title: 'Bring your own command',
      body: 'You should not rewrite a working tool to give it a tray. Already have a command that serves HTTP locally? npx create-opentray wraps it into an OpenTray-hosted app — interactively through the browser wizard (create-opentray web), fully non-interactively (create-opentray create --app-id … --app-name … --exec …), or by handing the built-in AI skill to your agent (npx create-opentray skill).',
      detail: 'npx create-opentray · web · create · skill',
    },
    {
      id: 'extensions',
      eyebrow: 'Extension family',
      title: 'Native capability, opt-in atoms',
      body: 'When a status atom needs more than a menu, extensions add native capability without changing the model: @opentray/ext-webview is the rich popup facade — its windows are tray-owned utilities by default, and style.appMode: true makes one behave as an ordinary desktop window (taskbar/Alt-Tab, Dock/Command-Tab). @opentray/ext-badge adds badge/progress/overlay APIs; @opentray/ext-island is the roadmap dynamic island extension.',
      detail: 'ext-webview · ext-badge · ext-island',
    },
    {
      id: 'packaging',
      eyebrow: 'Packaging layer',
      title: 'Bundler-neutral, four adapters',
      body: 'Shipping should not depend on your bundler. @opentray/packaging stages runtime executables, native sidecars, and companion assets into app-id-derived output paths and writes an opentray-app-manifest.json manifest; adapters ship for Vite, tsdown, esbuild, and webpack, and all four write the same manifest shape.',
      detail: 'opentray-app-manifest.json · 4 adapters',
    },
    {
      id: 'binaries',
      eyebrow: 'Platform runtimes',
      title: 'Six platforms, plain binaries',
      body: 'The runtime arrives the boring way: platform packages such as @opentray/darwin-arm64 carry bin/opentray or bin/opentray.exe for three OSes × two architectures (darwin, linux, windows × arm64, x64). Packaging stays a build-layer concern — it stages artifacts and emits manifest truth; tray lifecycle, session authority, and extension dispatch stay with the runtime.',
      detail: '@opentray/<os>-<arch> · bin/opentray',
    },
    {
      id: 'dist-tags',
      eyebrow: 'Releases',
      title: 'Protocol-line dist-tags',
      body: 'Mixed package sets should not drift apart. When an app uses official extensions, lock the same OpenTray protocol-line tag across the package set: pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B. alpha-A-B carries alpha packages on the same protocol line; the tags are published by @opentray/spec.',
      detail: 'stable-A-B · alpha-A-B',
    },
  ],
  workspace: {
    eyebrow: 'Workspace',
    title: 'One repository, one package family',
    summary:
      'The npm surface mirrors the repository layout. The Lynx extension is maintained in the independent jixoai/opentray-ext-lynx repository; OpenTray core does not build, stage, or publish Lynx artifacts.',
    headers: ['Directory', 'npm package', 'Purpose'],
    rows: [
      { dir: 'packages/cli', pkg: 'opentray', purpose: 'Developer-facing tray-first SDK and CLI package.' },
      { dir: 'packages/spec', pkg: '@opentray/spec', purpose: 'TypeScript protocol and shared contract package.' },
      { dir: 'packages/packaging', pkg: '@opentray/packaging', purpose: 'Bundler-neutral runtime artifact staging contract.' },
      { dir: 'packages/vite-plugin', pkg: '@opentray/vite-plugin', purpose: 'First Vite adapter over the packaging contract.' },
      { dir: 'packages/ext-webview', pkg: '@opentray/ext-webview', purpose: 'Rich popup extension facade.' },
      { dir: 'packages/ext-webview-*', pkg: '@opentray/ext-webview-*', purpose: 'Platform WebView dynamic library packages.' },
      { dir: 'packages/ext-badge', pkg: '@opentray/ext-badge', purpose: 'Platform badge/progress/overlay API extension.' },
      { dir: 'packages/ext-island', pkg: '@opentray/ext-island', purpose: 'Roadmap dynamic island / live activity extension.' },
      { dir: 'packages/<os>-<arch>', pkg: '@opentray/<os>-<arch>', purpose: 'Platform runtime artifact packages.' },
    ],
  },
  ecosystem: {
    eyebrow: 'Ecosystem',
    title: 'Where things live',
    summary: 'Source, packages, and the public guides — the same links the README carries.',
    links: [
      { label: 'GitHub · jixoai/opentray', note: 'Source, issues, and release history.' },
      { label: 'npm · opentray', note: 'The developer-facing tray-first SDK and CLI package.' },
      { label: 'create-app guide', note: 'Wrapping an HTTP-serving command with npx create-opentray.' },
      { label: 'app-mode decision guide', note: 'Normal apps, tray utilities, and mixed-window products on @opentray/ext-webview.' },
      { label: 'opentray-ext-lynx', note: 'The Lynx extension, maintained in its own repository.' },
    ],
  },
  chrome: { switcherAriaLabel: 'Language', overviewLabel: 'Overview' },
};

const zh: HomeContent = {
  meta: {
    title: 'OpenTray · 托盘优先的桌面状态运行时',
    description:
      'OpenTray 给 Node/Deno/Bun 的 CLI 工具与 AI 技能一个常驻的桌面状态面：一次 createTray()，公开托盘/会话协议之后的 Rust broker，没有 Electron 级的重量。',
  },
  hero: {
    eyebrow: 'OpenTray · 桌面状态运行时',
    titlePre: '给 CLI 与 AI 技能一个桌面上的家——',
    titleEm: '不必',
    titlePost: '背上应用框架的重量。',
    summary:
      'CLI 工具与 AI 技能做着漫长而安静的工作——构建、agent、监听器——却在没人盯着的终端里结束。OpenTray 是面向 Node、Deno 与 Bun 的桌面状态运行时：一次 createTray() 自动启动本地 broker，把一个常驻的状态原子放上托盘——Rust 内核、公开的托盘/会话协议、没有 Node addon、没有应用框架。',
    badges: ['Node · Deno · Bun', 'Rust 内核 · 无 addon', '一次 createTray()', 'MIT'],
    copyLabel: '复制',
    terminal: {
      barTitle: 'opentray — first-app',
      command: 'node first-app.mjs',
      outputs: [
        'broker: 已自动启动——Rust 内核',
        '托盘: com.example.first-app · 图标 "OT" 已常驻',
        '菜单: Quit (primaryEvent)',
        '会话: 活跃——事件正在流入',
      ],
    },
    secondaryLabel: 'GitHub ↗',
  },
  quickStart: {
    eyebrow: '快速开始',
    title: '一次安装，一次 createTray()',
    summary:
      '打包好的运行时在首次使用时自动启动本地 broker——可见托盘文本属于图标投影，运行时身份（appId/appName）与之分离，primaryEvent 是普通菜单项上的一个角色，触发的是通常的 menuClick。',
    notePre: '已经有一个在本地提供 HTTP 服务的命令？',
    noteLink: 'npx create-opentray',
    notePost: ' 可以把它包装成一个 OpenTray 托管的应用。',
  },
  featuresHeading: '内置能力',
  features: [
    {
      id: 'why',
      eyebrow: '存在的原因',
      title: '不是托盘图标，是入口',
      body: '目标从来不是「显示一个托盘图标」：轻量工具值得一个系统级入口，而不必被迫背上 Electron 或整套桌面应用框架。模型只有四个原子：App 是调用方持有的运行时身份与隔离边界，Tray 是单个桌面状态原子，Session 是托盘事件与变更的实时权威来源，Extension 是可选的原生能力原子。',
      detail: 'App · Tray · Session · Extension',
    },
    {
      id: 'create-tray',
      eyebrow: 'SDK',
      title: '一次调用，自持生命周期',
      body: '不该为了显示状态去引导一个应用外壳。应用代码直接调用 createTray()，并自行持有前台/后台生命周期。顶层 createTray(...) 与其返回的 setMenu(...) 接受面向应用的菜单简写；更底层的 createClient(...) 保持仅协议形态，供需要精确线上报文结构的工具使用。',
      detail: 'opentray · 菜单简写 · 类型化句柄',
    },
    {
      id: 'broker',
      eyebrow: 'Rust 内核',
      title: '是 broker，不是 addon',
      body: '为什么敢用 npm 装来的托盘？原生侧是一个以独立可执行文件交付的 Rust 内核：默认的 createTray() 传输面向本地运行时宿主，并在首次使用需要时自动启动它；普通应用代码通过公开的托盘/会话协议与它通信。没有 Node addon，托盘工作不需要拆 worker。',
      detail: '托盘/会话协议 · 自动启动的 Rust 宿主',
    },
    {
      id: 'create-opentray',
      eyebrow: '上手',
      title: '带上你自己的命令',
      body: '不该为了一个托盘重写一个能用的工具。已经有一个在本地提供 HTTP 服务的命令？npx create-opentray 把它包装成一个 OpenTray 托管的应用——通过浏览器向导交互式完成（create-opentray web）、完全非交互式完成（create-opentray create --app-id … --app-name … --exec …），或把内置 AI 技能交给你的 agent（npx create-opentray skill）。',
      detail: 'npx create-opentray · web · create · skill',
    },
    {
      id: 'extensions',
      eyebrow: '扩展家族',
      title: '原生能力，按需原子',
      body: '当一个状态原子需要的比菜单更多时，扩展在不改变模型的前提下补充原生能力：@opentray/ext-webview 是富弹出层门面——它的窗口默认是托盘持有的工具窗口，style.appMode: true 让其中一个表现得像普通桌面窗口（任务栏/Alt-Tab、Dock/Command-Tab）。@opentray/ext-badge 增加徽标/进度/覆盖层 API；@opentray/ext-island 是路线图上的灵动岛扩展。',
      detail: 'ext-webview · ext-badge · ext-island',
    },
    {
      id: 'packaging',
      eyebrow: '打包层',
      title: '与打包器无关，四个适配器',
      body: '交付不应被打包器绑死。@opentray/packaging 将运行时可执行文件、原生 sidecar 与伴随资产装配到按 app-id 推导的输出路径，并写入 opentray-app-manifest.json 清单；Vite、tsdown、esbuild 与 webpack 的适配器均已发布，四者写入相同的清单结构。',
      detail: 'opentray-app-manifest.json · 4 个适配器',
    },
    {
      id: 'binaries',
      eyebrow: '平台运行时',
      title: '六个平台，朴素二进制',
      body: '运行时以最朴素的方式到达：@opentray/darwin-arm64 这类平台包为三个系统 × 两种架构（darwin、linux、windows × arm64、x64）携带 bin/opentray 或 bin/opentray.exe。打包始终是构建层的关注点——它装配工件并产出清单事实；托盘生命周期、会话权威与扩展分发留在运行时。',
      detail: '@opentray/<os>-<arch> · bin/opentray',
    },
    {
      id: 'dist-tags',
      eyebrow: '发布',
      title: '协议线 dist-tags',
      body: '混装的包集不该彼此漂移。当应用使用官方扩展时，请在这组包上锁定同一个 OpenTray 协议线标签：pnpm add opentray@stable-A-B @opentray/ext-webview@stable-A-B。alpha-A-B 承载同一协议线上的 alpha 包；标签由 @opentray/spec 发布。',
      detail: 'stable-A-B · alpha-A-B',
    },
  ],
  workspace: {
    eyebrow: '工作区',
    title: '一个仓库，一个包家族',
    summary:
      'npm 表面与仓库布局互为镜像。Lynx 扩展维护在独立的 jixoai/opentray-ext-lynx 仓库中；OpenTray 核心不构建、不装配、也不发布 Lynx 工件。',
    headers: ['目录', 'npm 包', '用途'],
    rows: [
      { dir: 'packages/cli', pkg: 'opentray', purpose: '面向开发者的托盘优先 SDK 与 CLI 包。' },
      { dir: 'packages/spec', pkg: '@opentray/spec', purpose: 'TypeScript 协议与共享契约包。' },
      { dir: 'packages/packaging', pkg: '@opentray/packaging', purpose: '与打包器无关的运行时工件装配（staging）契约。' },
      { dir: 'packages/vite-plugin', pkg: '@opentray/vite-plugin', purpose: '构建在 packaging 契约之上的第一个 Vite 适配器。' },
      { dir: 'packages/ext-webview', pkg: '@opentray/ext-webview', purpose: '富弹出层扩展门面。' },
      { dir: 'packages/ext-webview-*', pkg: '@opentray/ext-webview-*', purpose: '平台 WebView 动态库包。' },
      { dir: 'packages/ext-badge', pkg: '@opentray/ext-badge', purpose: '平台徽标/进度/覆盖层 API 扩展。' },
      { dir: 'packages/ext-island', pkg: '@opentray/ext-island', purpose: '路线图上的灵动岛/实时活动扩展。' },
      { dir: 'packages/<os>-<arch>', pkg: '@opentray/<os>-<arch>', purpose: '平台运行时工件包。' },
    ],
  },
  ecosystem: {
    eyebrow: '生态',
    title: '一切所在',
    summary: '源码、包与公开指南——与 README 相同的一组链接。',
    links: [
      { label: 'GitHub · jixoai/opentray', note: '源码、issue 与发布历史。' },
      { label: 'npm · opentray', note: '面向开发者的托盘优先 SDK 与 CLI 包。' },
      { label: 'create-app 指南', note: '用 npx create-opentray 包装一条提供 HTTP 服务的命令。' },
      { label: 'app-mode 决策指南', note: '@opentray/ext-webview 上的普通应用、托盘工具与混合窗口产品。' },
      { label: 'opentray-ext-lynx', note: 'Lynx 扩展，维护在独立仓库中。' },
    ],
  },
  chrome: { switcherAriaLabel: '切换语言', overviewLabel: '总览' },
};

export const homeContent: Record<Locale, HomeContent> = { en, zh };

/** The locale-invariant first-app sample (see QUICK_START_CODE above). */
export const quickStartCode = QUICK_START_CODE;

/** Locale segment used by the /zh/ mirror and the llms.txt locale split. */
export const ZH_SEGMENT = 'zh';
