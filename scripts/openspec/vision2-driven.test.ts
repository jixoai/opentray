import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const readRepoFile = (relativePath: string): string =>
  readFileSync(join(repoRoot, relativePath), "utf8");

const issueFixture = (title: string, state: "open" | "resolved" | "closed"): string => {
  const githubIssueStatus = state === "open" ? "open" : "closed";
  const closingSection = state === "open" ? "## Recommendation" : "## Resolution";
  const closingText =
    state === "open" ? "Add the spec or remove the footnote." : "Archived as requested.";
  return `---
title: ${title}
state: ${state}
github_issue_status: ${githubIssueStatus}
---

## Summary
${title}

## Impact
${title}

## Evidence
${title}

${closingSection}
${closingText}
`;
};

const validIssue = issueFixture("Broken footnote link", "open");

const richIssueFixture = (
  title: string,
  state: "open" | "resolved" | "closed",
  options: {
    type?: "bug" | "task" | "decision" | "risk" | "question";
    group?: string;
    labels?: string[];
    dependsOn?: string[];
  } = {},
): string => {
  const githubIssueStatus = state === "open" ? "open" : "closed";
  const closingSection = state === "open" ? "## Recommendation" : "## Resolution";
  const labels = options.labels ?? [];
  const dependsOn = options.dependsOn ?? [];
  return `---
title: ${title}
state: ${state}
github_issue_status: ${githubIssueStatus}
type: ${options.type ?? "task"}
group: ${options.group ?? "general"}
labels:${labels.length === 0 ? " []" : `\n${labels.map((label) => `  - ${label}`).join("\n")}`}
depends_on:${dependsOn.length === 0 ? " []" : `\n${dependsOn.map((issueId) => `  - ${issueId}`).join("\n")}`}
blocks: []
priority: medium
---

## Summary
${title}

## Impact
${title}

## Evidence
${title}

${closingSection}
${state === "open" ? "Act on it." : "Resolved."}
`;
};

const runBun = async (
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  stdin?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const pathEnvKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const spawnEnv: Record<string, string> = {};
  for (const key of [
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "USER",
    "SHELL",
    "SYSTEMROOT",
    "SystemRoot",
    "ComSpec",
  ]) {
    const value = env[key];
    if (value !== undefined) {
      spawnEnv[key] = value;
    }
  }
  spawnEnv[pathEnvKey] = env[pathEnvKey] ?? process.env[pathEnvKey] ?? "";
  if (env.VISION_TEST_LOG !== undefined) {
    spawnEnv.VISION_TEST_LOG = env.VISION_TEST_LOG;
  }

  const captureDir = mkdtempSync(join(tmpdir(), "vision2-stdio-"));
  const stdoutPath = join(captureDir, "stdout.log");
  const stderrPath = join(captureDir, "stderr.log");
  const stdinPath = join(captureDir, "stdin.txt");
  if (stdin !== undefined) {
    writeFileSync(stdinPath, stdin);
  }
  try {
    // Bun 1.3 can silently drop nested child streams when numeric fds or pipes are used.
    const child = Bun.spawn({
      cmd: [process.execPath, ...args],
      cwd,
      env: spawnEnv,
      stdin: stdin === undefined ? "ignore" : Bun.file(stdinPath),
      stdout: Bun.file(stdoutPath),
      stderr: Bun.file(stderrPath),
    });
    const exitCode = await child.exited;
    const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf8") : "";
    const stderr = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8") : "";
    return { exitCode, stdout, stderr };
  } finally {
    rmSync(captureDir, { recursive: true, force: true });
  }
};

const runCommand = async (
  cmd: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

const copyVision2Schema = async (projectRoot: string): Promise<void> => {
  await mkdir(join(projectRoot, "openspec", "schemas"), { recursive: true });
  await cp(
    join(repoRoot, "openspec", "schemas", "vision2"),
    join(projectRoot, "openspec", "schemas", "vision2"),
    {
      recursive: true,
    },
  );
};

const createFakeOpenspec = async (
  tmpRoot: string,
): Promise<{ env: Record<string, string | undefined>; logPath: string }> => {
  const binDir = join(tmpRoot, "bin");
  const logPath = join(tmpRoot, "openspec.log");
  await mkdir(binDir, { recursive: true });
  const fakeScriptPath = join(binDir, "openspec-fake.cjs");
  writeFileSync(
    fakeScriptPath,
    [
      'const { appendFileSync } = require("node:fs");',
      "const logPath = process.env.VISION_TEST_LOG;",
      "if (!logPath) {",
      '  console.error("VISION_TEST_LOG is required");',
      "  process.exit(1);",
      "}",
      'appendFileSync(logPath, `${process.argv.slice(2).join(" ")}\\n`);',
      "",
    ].join("\n"),
  );
  const scriptPath = join(binDir, "openspec");
  writeFileSync(
    scriptPath,
    [
      "#!/bin/sh",
      'script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      'node "$script_dir/openspec-fake.cjs" "$@"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(binDir, "openspec.cmd"),
    ["@echo off", 'node "%~dp0openspec-fake.cjs" %*', ""].join("\r\n"),
  );
  chmodSync(scriptPath, 0o755);
  const pathEnvKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  return {
    env: {
      ...process.env,
      [pathEnvKey]: `${binDir}${delimiter}${process.env[pathEnvKey] ?? ""}`,
      VISION_TEST_LOG: logPath,
    },
    logPath,
  };
};

const readLoggedCommands = (logPath: string): string[] =>
  readFileSync(logPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const writeIssueFile = (
  changeDir: string,
  filename: string,
  title: string,
  state: "open" | "resolved" | "closed",
): void => {
  writeFileSync(join(changeDir, "issues", filename), issueFixture(title, state));
};

/** Minimal valid vision2 change fixture, with toc footnotes covering one spec. */
const seedChange = async (tmpRoot: string, change = "demo-change"): Promise<string> => {
  const changeDir = join(tmpRoot, "openspec", "changes", change);
  await mkdir(join(changeDir, "specs", "core"), { recursive: true });
  await mkdir(join(changeDir, "issues"), { recursive: true });
  writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision2\ncreated: 2026-06-26\n");
  await writeFile(join(changeDir, "interview_plan.md"), "# Interview\n\nBuild the thing.\n");
  await writeFile(join(changeDir, "tasks.md"), "- [x] 1.1 Do the thing\n");
  await writeFile(join(changeDir, "specs", "core", "spec.md"), "## ADDED Requirements\n");
  await writeFile(
    join(changeDir, "toc.md"),
    [
      "# TOC",
      "",
      "[^interview]: interview_plan.md",
      "[^tasks]: tasks.md",
      "[^core]: specs/core/spec.md",
      "",
    ].join("\n"),
  );
  return changeDir;
};

describe("Feature: vision2 OpenSpec workflow contract", () => {
  test("Scenario: Given the project schema files When inspecting them Then interview, specs, tasks, close form the enforced workflow", () => {
    const schema = readRepoFile("openspec/schemas/vision2/schema.yaml");
    const config = readRepoFile("openspec/config.yaml");
    const interviewTemplate = readRepoFile("openspec/schemas/vision2/templates/interview_plan.md");
    const tasksTemplate = readRepoFile("openspec/schemas/vision2/templates/tasks.md");
    const tocTemplate = readRepoFile("openspec/schemas/vision2/templates/toc.md");

    expect(config).toMatch(/^schema: vision2$/m);
    expect(schema).toContain("name: vision2");
    expect(schema).toContain("id: interview");
    expect(schema).toContain("generates: interview_plan.md");
    expect(schema).toContain("Pre-interview orientation");
    expect(schema).toContain("confirm the interview topic");
    expect(schema).toContain("confirm the interview mother tongue");
    expect(schema).toContain("switch the interview thinking language");
    expect(schema).toContain("Do not merely translate English reasoning");
    expect(schema).toContain("ONE AT A TIME");
    expect(schema).toContain("give your recommended answer");
    expect(schema).toContain("If a question can be answered by exploring the codebase");
    expect(schema).toContain("id: specs");
    expect(schema).toContain("requires:\n      - interview");
    expect(schema).toContain("id: tasks");
    expect(schema).toContain("requires:\n      - specs");
    expect(schema).toContain("id: close");
    expect(schema).toContain("generates: toc.md");
    expect(schema).toContain("requires:\n      - tasks");
    expect(schema).toContain("issues/NNN-slug.md");
    expect(schema).toContain("tracks: tasks.md");
    expect(schema).not.toContain("plans/plan.md");
    expect(schema).not.toContain("review/self-review.md");
    expect(interviewTemplate).toContain("## Q&A Ledger");
    expect(interviewTemplate).toContain("## Original User Input");
    expect(interviewTemplate).toContain("## Pre-Interview Orientation");
    expect(interviewTemplate).toContain("Interview mother tongue");
    expect(interviewTemplate).toContain("Thinking language for this interview");
    expect(tasksTemplate).toContain("bun run openspec:vision2 -- validate <change>");
    expect(tasksTemplate).toContain("--new <bug|task|decision|risk|question>");
    expect(tasksTemplate).toContain("bun run openspec:vision2 -- check <change>");
    expect(tocTemplate).toContain("[^capability]: specs/capability/spec.md");
    expect(tocTemplate).toContain("## Footnote References");
    expect(schema).toContain("templates/issues/*.md");
    expect(schema).toContain("--new <bug|task|decision|risk|question>");
    expect(schema).toContain("depends_on");
    expect(readRepoFile("openspec/schemas/vision2/templates/issues/bug.md")).toContain("type: bug");
    expect(readRepoFile("openspec/schemas/vision2/templates/issues/decision.md")).toContain(
      "type: decision",
    );
    expect(readRepoFile("openspec/schemas/vision2/templates/issues/question.md")).toContain(
      "type: question",
    );
    expect(readRepoFile("openspec/schemas/vision2/templates/issues/risk.md")).toContain(
      "type: risk",
    );
    expect(readRepoFile("openspec/schemas/vision2/templates/issues/task.md")).toContain(
      "type: task",
    );
    // Offline self-interview mode (added after dogfooding).
    expect(schema).toContain("Interactive vs. offline mode");
    expect(schema).toContain("ASSUMPTION");
    // Check exit-code semantics documented in the close instruction.
    expect(schema).toContain("Check exit codes");
    expect(schema).toContain("Exit 0");
    expect(schema).toContain("Exit 1");
    expect(schema).toContain("Exit 2");
    expect(schema).toContain("iteration-loop signal");
  });

  test("Scenario: Given a new vision2 change When the controller creates it Then creation, status, and first instructions stay schema-scoped", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const { env, logPath } = await createFakeOpenspec(tmpRoot);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "new", "demo-change"],
        tmpRoot,
        env,
      );

      expect(result.exitCode).toBe(0);
      expect(readLoggedCommands(logPath)).toEqual([
        "new change demo-change --schema vision2",
        "status --change demo-change --schema vision2",
        "instructions interview --change demo-change --schema vision2",
      ]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given the schema templates exist When new runs Then the interview_plan.md skeleton is scaffolded into the change dir", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      // The fake openspec only logs args; it does not create the change dir or
      // copy templates, so pre-seed the change dir + schema so the controller's
      // scaffoldFirstArtifact can resolve the interview template path.
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(changeDir, { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision2\ncreated: 2026-06-27\n");
      await copyVision2Schema(tmpRoot);
      const { env } = await createFakeOpenspec(tmpRoot);
      const interviewPath = join(changeDir, "interview_plan.md");

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "new", "demo-change"],
        tmpRoot,
        env,
      );

      expect(result.exitCode).toBe(0);
      expect(existsSync(interviewPath)).toBe(true);
      const scaffolded = readFileSync(interviewPath, "utf8");
      const template = readRepoFile("openspec/schemas/vision2/templates/interview_plan.md");
      expect(scaffolded).toBe(template);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given interview_plan.md already exists When new runs Then the scaffold step does not overwrite it", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(changeDir, { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision2\ncreated: 2026-06-27\n");
      // Pre-existing, agent-authored content must be preserved.
      writeFileSync(join(changeDir, "interview_plan.md"), "# My Interview\n\nhand-written\n");
      await copyVision2Schema(tmpRoot);
      const { env } = await createFakeOpenspec(tmpRoot);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "new", "demo-change"],
        tmpRoot,
        env,
      );

      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(changeDir, "interview_plan.md"), "utf8")).toBe(
        "# My Interview\n\nhand-written\n",
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a vision2 change When helper commands are used Then schema and validation arguments are explicit", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const { env, logPath } = await createFakeOpenspec(tmpRoot);

      const statusResult = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "status", "demo-change"],
        tmpRoot,
        env,
      );
      const instructionsResult = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "instructions",
          "interview",
          "demo-change",
        ],
        tmpRoot,
        env,
      );
      const validateResult = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "validate", "demo-change"],
        tmpRoot,
        env,
      );

      expect(statusResult.exitCode).toBe(0);
      expect(instructionsResult.exitCode).toBe(0);
      expect(validateResult.exitCode).toBe(0);
      expect(readLoggedCommands(logPath)).toEqual([
        "status --change demo-change --schema vision2",
        "instructions interview --change demo-change --schema vision2",
        "validate demo-change --type change --strict",
      ]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a dirty change When commit-check runs with the close phase Then it reports evidence guidance with the close commit message", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      await runCommand(["git", "init"], tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(changeDir, { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision2\ncreated: 2026-06-26\n");
      writeFileSync(join(changeDir, "interview_plan.md"), "# Intent\n");

      const result = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "commit-check",
          "demo-change",
          "--phase",
          "close",
        ],
        tmpRoot,
      );
      const parsed = JSON.parse(result.stdout) as { phase: string; suggestedCommands: string[] };

      expect(result.exitCode).toBe(0);
      expect(parsed.phase).toBe("close");
      expect(parsed.suggestedCommands.join("\n")).toContain(
        'git commit -m "docs(spec): close demo-change with toc"',
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a complete vision2 change with no open issues When check runs Then the proof gate passes", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      await copyVision2Schema(tmpRoot);
      await seedChange(tmpRoot);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"ok": true');
      expect(result.stdout).toContain('"openIssues": 0');
      expect(result.stdout).toContain('"closedUnarchived": 0');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a closed issue remains in the active folder When check runs Then it reports a closed-but-unarchived advisory count", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = await seedChange(tmpRoot);
      writeIssueFile(changeDir, "001-closed.md", "Closed issue", "closed");

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"openIssues": 0');
      expect(result.stdout).toContain('"closedUnarchived": 1');
      expect(result.stdout).toContain('"loop": false');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a spec file not cited in toc When check runs Then the orphan spec is reported", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      await copyVision2Schema(tmpRoot);
      const changeDir = await seedChange(tmpRoot);
      // Add a second spec that toc does not reference.
      await mkdir(join(changeDir, "specs", "extra"), { recursive: true });
      await writeFile(join(changeDir, "specs", "extra", "spec.md"), "## ADDED Requirements\n");

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("specs/extra/spec.md");
      expect(result.stderr).toContain("orphan");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given toc cites a non-existent spec When check runs Then the dangling footnote is reported", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      await copyVision2Schema(tmpRoot);
      const tmpRootLocal = tmpRoot;
      const changeDir = join(tmpRootLocal, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "specs", "core"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision2\ncreated: 2026-06-26\n");
      await writeFile(join(changeDir, "interview_plan.md"), "# Interview\n");
      await writeFile(join(changeDir, "tasks.md"), "- [x] 1.1 Do the thing\n");
      await writeFile(join(changeDir, "specs", "core", "spec.md"), "## ADDED Requirements\n");
      // toc cites specs/core/spec.md AND a dangling specs/ghost/spec.md
      await writeFile(
        join(changeDir, "toc.md"),
        ["# TOC", "", "[^core]: specs/core/spec.md", "[^ghost]: specs/ghost/spec.md", ""].join(
          "\n",
        ),
      );

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "check", "demo-change"],
        tmpRootLocal,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("specs/ghost/spec.md");
      expect(result.stderr).toContain("dangling");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given an open issue exists When check runs Then the workflow signals the iteration loop with exit code 2", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      await copyVision2Schema(tmpRoot);
      const changeDir = await seedChange(tmpRoot);
      await writeFile(join(changeDir, "issues", "001-broken-footnote.md"), validIssue);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain('"openIssues": 1');
      expect(result.stdout).toContain('"closedUnarchived": 0');
      expect(result.stdout).toContain('"loop": true');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a malformed issue file When issues --validate runs Then it reports the structural errors", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = await seedChange(tmpRoot);
      await writeFile(
        join(changeDir, "issues", "002-bad.md"),
        "---\ntitle: Bad\nstate: open\n---\n\nNo required sections.\n",
      );

      const result = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--validate",
        ],
        tmpRoot,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("issues/002-bad.md");
      expect(result.stdout).toContain("github_issue_status");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given an existing issue When issues --new creates a bug Then the issue is rendered from the typed template", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      await copyVision2Schema(tmpRoot);
      const changeDir = await seedChange(tmpRoot);
      writeFileSync(join(changeDir, "issues", "001-base.md"), issueFixture("Base issue", "open"));

      const result = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--new",
          "bug",
          "--title",
          "Broken terminal focus",
          "--group",
          "runtime",
          "--label",
          "attention",
          "--depends-on",
          "001-base",
          "--priority",
          "high",
          "--owner",
          "platform",
        ],
        tmpRoot,
      );
      const parsed = JSON.parse(result.stdout) as {
        created: { relativePath: string; issueId: string; labels: string[]; dependsOn: string[] };
      };
      const issuePath = join(changeDir, "issues", "002-broken-terminal-focus.md");
      const issue = readFileSync(issuePath, "utf8");

      expect(result.exitCode).toBe(0);
      expect(parsed.created.relativePath).toBe("issues/002-broken-terminal-focus.md");
      expect(parsed.created.issueId).toBe("002-broken-terminal-focus");
      expect(parsed.created.labels).toEqual(["attention", "bug"]);
      expect(parsed.created.dependsOn).toEqual(["001-base"]);
      expect(issue).toContain("type: bug");
      expect(issue).toContain('group: "runtime"');
      expect(issue).toContain('  - "attention"');
      expect(issue).toContain('  - "bug"');
      expect(issue).toContain('  - "001-base"');
      expect(issue).toContain("priority: high");
      expect(issue).toContain('owner: "platform"');

      const validateResult = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--validate",
        ],
        tmpRoot,
      );
      expect(validateResult.exitCode).toBe(0);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given typed issues When issues groups by label Then one issue can appear in multiple label groups", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = await seedChange(tmpRoot);
      await writeFile(
        join(changeDir, "issues", "001-runtime-bug.md"),
        richIssueFixture("Runtime bug", "open", {
          type: "bug",
          group: "runtime",
          labels: ["attention", "regression"],
        }),
      );

      const result = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--group-by",
          "label",
        ],
        tmpRoot,
      );
      const parsed = JSON.parse(result.stdout) as {
        groups: Array<{ key: string; issues: Array<{ issueId: string }> }>;
      };
      const labels = parsed.groups.map((group) => group.key);

      expect(result.exitCode).toBe(0);
      expect(labels).toContain("attention");
      expect(labels).toContain("regression");
      expect(parsed.groups.find((group) => group.key === "attention")?.issues).toEqual([
        expect.objectContaining({ issueId: "001-runtime-bug" }),
      ]);
      expect(parsed.groups.find((group) => group.key === "regression")?.issues).toEqual([
        expect.objectContaining({ issueId: "001-runtime-bug" }),
      ]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given an issue references a missing dependency When issues validates Then the missing dependency is reported", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = await seedChange(tmpRoot);
      await writeFile(
        join(changeDir, "issues", "001-missing-dependency.md"),
        richIssueFixture("Missing dependency", "open", { dependsOn: ["999-missing"] }),
      );

      const result = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--validate",
        ],
        tmpRoot,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("depends_on references unknown issue: 999-missing");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given active issues form a dependency cycle When issues validates Then the cycle is rejected", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = await seedChange(tmpRoot);
      await writeFile(
        join(changeDir, "issues", "001-first.md"),
        richIssueFixture("First", "open", { dependsOn: ["002-second"] }),
      );
      await writeFile(
        join(changeDir, "issues", "002-second.md"),
        richIssueFixture("Second", "open", { dependsOn: ["001-first"] }),
      );

      const result = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--validate",
        ],
        tmpRoot,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("dependency cycle detected");
      expect(result.stdout).toContain("001-first -> 002-second -> 001-first");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given closed and resolved issues When issues --archive runs Then they move to issues/closed/ and open issues stay active", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = await seedChange(tmpRoot);
      writeIssueFile(changeDir, "001-closed.md", "Closed issue", "closed");
      writeIssueFile(changeDir, "002-resolved.md", "Resolved issue", "resolved");
      writeIssueFile(changeDir, "003-open.md", "Open issue", "open");

      const result = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--archive",
        ],
        tmpRoot,
      );
      const parsed = JSON.parse(result.stdout) as {
        ok: boolean;
        archived: Array<{ from: string; to: string }>;
      };

      expect(result.exitCode).toBe(0);
      expect(parsed.ok).toBe(true);
      expect(parsed.archived).toEqual([
        { from: "issues/001-closed.md", to: "issues/closed/001-closed.md" },
        { from: "issues/002-resolved.md", to: "issues/closed/002-resolved.md" },
      ]);
      expect(existsSync(join(changeDir, "issues", "closed", "001-closed.md"))).toBe(true);
      expect(existsSync(join(changeDir, "issues", "closed", "002-resolved.md"))).toBe(true);
      expect(existsSync(join(changeDir, "issues", "001-closed.md"))).toBe(false);
      expect(existsSync(join(changeDir, "issues", "002-resolved.md"))).toBe(false);
      expect(existsSync(join(changeDir, "issues", "003-open.md"))).toBe(true);
      expect(readFileSync(join(changeDir, "issues", "closed", "001-closed.md"), "utf8")).toBe(
        issueFixture("Closed issue", "closed"),
      );
      expect(readFileSync(join(changeDir, "issues", "closed", "002-resolved.md"), "utf8")).toBe(
        issueFixture("Resolved issue", "resolved"),
      );
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given no archive-eligible issues When issues --archive runs Then it is idempotent and reports nothing to archive", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = await seedChange(tmpRoot);
      writeIssueFile(changeDir, "001-open.md", "Open issue", "open");

      const first = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--archive",
        ],
        tmpRoot,
      );
      const second = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
          "issues",
          "demo-change",
          "--archive",
        ],
        tmpRoot,
      );
      const firstParsed = JSON.parse(first.stdout) as {
        ok: boolean;
        archived: unknown[];
        note?: string;
      };
      const secondParsed = JSON.parse(second.stdout) as {
        ok: boolean;
        archived: unknown[];
        note?: string;
      };

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(firstParsed.ok).toBe(true);
      expect(secondParsed.ok).toBe(true);
      expect(firstParsed.archived).toEqual([]);
      expect(secondParsed.archived).toEqual([]);
      expect(firstParsed.note).toBe("nothing to archive");
      expect(secondParsed.note).toBe("nothing to archive");
      expect(existsSync(join(changeDir, "issues", "closed"))).toBe(false);
      expect(existsSync(join(changeDir, "issues", "001-open.md"))).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given the close phase When commit-check runs Then the four vision2 phases are all accepted", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      await runCommand(["git", "init"], tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(changeDir, { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision2\ncreated: 2026-06-26\n");

      for (const phase of ["interview", "apply", "close", "archive"]) {
        const result = await runBun(
          [
            join(repoRoot, "scripts", "openspec", "vision2-driven.ts"),
            "commit-check",
            "demo-change",
            "--phase",
            phase,
          ],
          tmpRoot,
        );
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain(`"phase": "${phase}"`);
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given abnormal exit needs handoff When handoff runs twice Then the previous handoff is versioned", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      await runCommand(["git", "init"], tmpRoot);
      await copyVision2Schema(tmpRoot);
      const { env } = await createFakeOpenspec(tmpRoot);
      const changeDir = await seedChange(tmpRoot);

      const first = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "handoff", "demo-change"],
        tmpRoot,
        env,
      );
      const second = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "handoff", "demo-change"],
        tmpRoot,
        env,
      );
      const handoff = readFileSync(join(changeDir, "HANDOFF.md"), "utf8");

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(existsSync(join(changeDir, "v1.HANDOFF.md"))).toBe(true);
      expect(handoff).toContain("## Goal");
      expect(handoff).toContain("## Next Steps");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given handoff receives Here Document stdin When handoff runs Then it writes the inline content exactly", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision2-"));
    try {
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(changeDir, { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision2\ncreated: 2026-06-26\n");
      writeFileSync(join(changeDir, "HANDOFF.md"), "previous handoff\n");

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision2-driven.ts"), "handoff", "demo-change"],
        tmpRoot,
        process.env,
        "# Manual Handoff\nExact operator content.\n",
      );
      const handoff = readFileSync(join(changeDir, "HANDOFF.md"), "utf8");

      expect(result.exitCode).toBe(0);
      expect(handoff).toBe("# Manual Handoff\nExact operator content.\n");
      expect(readFileSync(join(changeDir, "v1.HANDOFF.md"), "utf8")).toBe("previous handoff\n");
      expect(result.stdout).toContain('"source": "stdin"');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
