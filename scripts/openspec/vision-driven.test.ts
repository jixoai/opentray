import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const readRepoFile = (relativePath: string): string => readFileSync(join(repoRoot, relativePath), "utf8");
const validReviewMarkdown = `# Self Review

## Review State

- Change: demo-change

## Deviations From Intent

1. None.
`;
const validReviewHtml = `<!doctype html>
<html lang="en">
  <body>
    <section><h2>Free-form review</h2><p>Deviation list, questions, and evidence live here.</p></section>
  </body>
</html>
`;
const validReviewState = `${JSON.stringify(
  {
    change: "demo-change",
    iteration: 1,
    maxIterations: 5,
    recurringIssues: {},
    updatedAt: "2026-05-29T00:00:00.000Z",
  },
  null,
  2,
)}\n`;

const copyVisionSchema = async (projectRoot: string): Promise<void> => {
  await mkdir(join(projectRoot, "openspec", "schemas"), { recursive: true });
  await cp(
    join(repoRoot, "openspec", "schemas", "vision-driven"),
    join(projectRoot, "openspec", "schemas", "vision-driven"),
    {
      recursive: true,
    },
  );
};

const runBun = async (
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  stdin?: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const proc =
    stdin === undefined
      ? Bun.spawn({
          cmd: ["bun", ...args],
          cwd,
          env,
          stdout: "pipe",
          stderr: "pipe",
        })
      : Bun.spawn({
          cmd: ["bun", ...args],
          cwd,
          env,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });
  if (stdin !== undefined) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

const runCommand = async (cmd: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
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
  writeFileSync(join(binDir, "openspec.cmd"), ['@echo off', 'node "%~dp0openspec-fake.cjs" %*', ""].join("\r\n"));
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

describe("Feature: vision-driven OpenSpec workflow contract", () => {
  test("Scenario: Given the project schema is loaded When inspecting the schema Then intent, specs, tasks, and self-review form the enforced workflow", () => {
    const schema = readRepoFile("openspec/schemas/vision-driven/schema.yaml");
    const config = readRepoFile("openspec/config.yaml");
    const researchPlanTemplate = readRepoFile("openspec/schemas/vision-driven/templates/research-plan.md");
    const selfReviewTemplate = readRepoFile("openspec/schemas/vision-driven/templates/self-review.md");
    const tasksTemplate = readRepoFile("openspec/schemas/vision-driven/templates/tasks.md");

    expect(config).toMatch(/^schema: vision-driven$/m);
    expect(schema).toContain("name: vision-driven");
    expect(schema).toContain("id: research-plan");
    expect(schema).toContain("generates: plans/plan.md");
    expect(schema).toContain("change-local demo/spike code under `demos/`");
    expect(schema).toContain("id: specs");
    expect(schema).toContain("requires:\n      - research-plan");
    expect(schema).toContain("id: tasks");
    expect(schema).toContain("requires:\n      - specs");
    expect(schema).toContain("id: self-review");
    expect(schema).toContain("generates: review/self-review.md");
    expect(schema).toContain("review/self-review.html");
    expect(schema).toContain("review/review-intent-and-tasks.md");
    expect(schema).toContain("bun run openspec:vision -- status <change>");
    expect(schema).toContain("bun run openspec:vision -- instructions <artifact> <change>");
    expect(schema).toContain("bun run openspec:vision -- validate <change>");
    expect(schema).toContain("bun run openspec:vision -- commit-check <change> --phase <phase>");
    expect(schema).toContain("bun run openspec:vision -- handoff <change>");
    expect(schema).toContain("bun run openspec:vision -- rename <old-change> <new-change>");
    expect(schema).toContain("tracks: tasks.md");
    expect(schema).toContain("Investigate the relevant code before locking the plan.");
    expect(schema).toContain("Investigate the relevant existing OpenSpec changes/specs before locking the plan.");
    expect(schema).toContain("Make architecture design and data-structure design explicit");
    expect(schema).toContain("only task checkboxes completed and verified in the current working context");
    expect(schema).toContain("intent comments at critical effect points");
    expect(researchPlanTemplate).toContain("## Workflow Command Surface");
    expect(researchPlanTemplate).toContain("bun run openspec:vision -- new <change>");
    expect(researchPlanTemplate).toContain("bun run openspec:vision -- commit-check <change> --phase <phase>");
    expect(researchPlanTemplate).toContain("bun run openspec:vision -- check <change>");
    expect(researchPlanTemplate).not.toContain("openspec validate <change> --type change --strict");
    expect(researchPlanTemplate).toContain("### Git Evidence");
    expect(selfReviewTemplate).toContain("# Vision-Driven Self Review");
    expect(selfReviewTemplate).toContain("## HTML Review Report");
    expect(selfReviewTemplate).toContain("review/self-review.html");
    expect(tasksTemplate).toContain("bun run openspec:vision -- validate <change>");
    expect(tasksTemplate).toContain("only current-context completed task checkboxes");
    expect(tasksTemplate).toContain("## 1. Alignment / Investigation");
    expect(tasksTemplate).toContain("review/self-review.md");
    expect(tasksTemplate).toContain("review/self-review.html");
  });

  test("Scenario: Given a new vision-driven change When the controller creates it Then creation, status, and first instructions stay schema-scoped", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      const { env, logPath } = await createFakeOpenspec(tmpRoot);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "new", "demo-change"],
        tmpRoot,
        env,
      );

      expect(result.exitCode).toBe(0);
      expect(readLoggedCommands(logPath)).toEqual([
        "new change demo-change --schema vision-driven",
        "status --change demo-change --schema vision-driven",
        "instructions research-plan --change demo-change --schema vision-driven",
      ]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a vision-driven change When helper commands are used Then schema and validation arguments are explicit", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      const { env, logPath } = await createFakeOpenspec(tmpRoot);

      const statusResult = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "status", "demo-change"],
        tmpRoot,
        env,
      );
      const instructionsResult = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "instructions", "research-plan", "demo-change"],
        tmpRoot,
        env,
      );
      const validateResult = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "validate", "demo-change"],
        tmpRoot,
        env,
      );

      expect(statusResult.exitCode).toBe(0);
      expect(instructionsResult.exitCode).toBe(0);
      expect(validateResult.exitCode).toBe(0);
      expect(readLoggedCommands(logPath)).toEqual([
        "status --change demo-change --schema vision-driven",
        "instructions research-plan --change demo-change --schema vision-driven",
        "validate demo-change --type change --strict",
      ]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }, 10_000);

  test("Scenario: Given a dirty change When commit-check runs Then it reports evidence guidance without committing", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      await runCommand(["git", "init"], tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-29\n");
      writeFileSync(join(changeDir, "plans", "plan.md"), "# Intent\n");

      const result = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision-driven.ts"),
          "commit-check",
          "demo-change",
          "--phase",
          "research-plan",
        ],
        tmpRoot,
      );
      const parsed = JSON.parse(result.stdout) as {
        phase: string;
        changePaths: string[];
        suggestedCommands: string[];
      };

      expect(result.exitCode).toBe(0);
      expect(parsed.phase).toBe("research-plan");
      expect(parsed.changePaths.join("\n")).toContain("openspec/changes/demo-change/");
      expect(parsed.suggestedCommands.join("\n")).toContain('git commit -m "docs(spec): prepare demo-change for apply"');
      expect(existsSync(join(tmpRoot, ".git"))).toBe(true);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a plan already exists When backup-plan runs Then the previous SSOT is versioned instead of overwritten", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      await writeFile(join(changeDir, "plans", "plan.md"), "current plan\n");

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "backup-plan", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(changeDir, "plans", "plan-v1.md"), "utf8")).toBe("current plan\n");
      expect(result.stdout).toContain("plan-v1.md");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given abnormal exit needs handoff When handoff runs twice Then the previous handoff is versioned", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      await runCommand(["git", "init"], tmpRoot);
      await copyVisionSchema(tmpRoot);
      const { env } = await createFakeOpenspec(tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-29\n");
      writeFileSync(join(changeDir, "plans", "plan.md"), "# Intent\n\nBuild the thing.\n");
      writeFileSync(join(changeDir, "tasks.md"), "- [ ] 1.1 Continue the thing\n");

      const first = await runBun([join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "handoff", "demo-change"], tmpRoot, env);
      const second = await runBun([join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "handoff", "demo-change"], tmpRoot, env);
      const handoff = readFileSync(join(changeDir, "HANDOFF.md"), "utf8");

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(existsSync(join(changeDir, "v1.HANDOFF.md"))).toBe(true);
      expect(handoff).toContain("## Goal");
      expect(handoff).toContain("## Current Progress");
      expect(handoff).toContain("## What Worked");
      expect(handoff).toContain("## What Didn't Work");
      expect(handoff).toContain("## Next Steps");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given handoff receives Here Document stdin When handoff runs Then it writes the inline content exactly", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(changeDir, { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-29\n");
      writeFileSync(join(changeDir, "HANDOFF.md"), "previous handoff\n");

      const scriptPath = join(repoRoot, "scripts", "openspec", "vision-driven.ts");
      const result = await runBun(
        [scriptPath, "handoff", "demo-change"],
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
  }, 10_000);

  test("Scenario: Given handoff files are workflow evidence When Git ignore rules are checked Then change-local handoffs stay commit-ready", async () => {
    const currentHandoff = await runCommand(["git", "check-ignore", "openspec/changes/demo-change/HANDOFF.md"], repoRoot);
    const versionedHandoff = await runCommand(["git", "check-ignore", "openspec/changes/demo-change/v1.HANDOFF.md"], repoRoot);

    expect(currentHandoff.exitCode).toBe(1);
    expect(versionedHandoff.exitCode).toBe(1);
  });

  test("Scenario: Given intent realignment renames a change When rename runs Then review state follows the new name", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      const oldDir = join(tmpRoot, "openspec", "changes", "old-change");
      await mkdir(join(oldDir, "review"), { recursive: true });
      writeFileSync(join(oldDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-29\n");
      writeFileSync(
        join(oldDir, "review", "state.json"),
        `${JSON.stringify(
          {
            change: "old-change",
            iteration: 1,
            maxIterations: 5,
            recurringIssues: {},
            updatedAt: "2026-05-29T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
      );

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "rename", "old-change", "new-change"],
        tmpRoot,
      );
      const state = JSON.parse(readFileSync(join(tmpRoot, "openspec", "changes", "new-change", "review", "state.json"), "utf8")) as {
        change: string;
      };

      expect(result.exitCode).toBe(0);
      expect(existsSync(oldDir)).toBe(false);
      expect(existsSync(join(tmpRoot, "openspec", "changes", "new-change"))).toBe(true);
      expect(state.change).toBe("new-change");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given review finds a recurring issue When review-state records the second occurrence Then the controller exits with loop-back signal", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(changeDir, { recursive: true });

      const first = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision-driven.ts"),
          "review-state",
          "demo-change",
          "--issue",
          "unclear-exit",
        ],
        tmpRoot,
      );
      const second = await runBun(
        [
          join(repoRoot, "scripts", "openspec", "vision-driven.ts"),
          "review-state",
          "demo-change",
          "--issue",
          "unclear-exit",
        ],
        tmpRoot,
      );

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(2);
      expect(second.stdout).toContain('"repeatedIssues"');
      expect(second.stdout).toContain("unclear-exit");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a vision-driven change is missing review proof When check runs Then it reports the missing workflow artifact", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      await copyVisionSchema(tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-28\n");
      writeFileSync(join(changeDir, "plans", "plan.md"), "# Intent\n");
      writeFileSync(join(changeDir, "tasks.md"), "- [ ] 1.1 Do the thing\n");

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("review/self-review.md is missing");
      expect(result.stderr).toContain("review/self-review.html is missing");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given self-review Markdown exists without HTML evidence When check runs Then the workflow gate rejects the missing presentation report", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      await copyVisionSchema(tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      await mkdir(join(changeDir, "review"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-28\n");
      writeFileSync(join(changeDir, "plans", "plan.md"), "# Intent\n");
      writeFileSync(join(changeDir, "tasks.md"), "- [x] 1.1 Do the thing\n");
      writeFileSync(join(changeDir, "review", "self-review.md"), validReviewMarkdown);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("review/self-review.html is missing");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given self-review Markdown and a free-form HTML report When check runs Then the workflow gate accepts both layers without rigid section policing", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      await copyVisionSchema(tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      await mkdir(join(changeDir, "review"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-28\n");
      writeFileSync(join(changeDir, "plans", "plan.md"), "# Intent\n");
      writeFileSync(join(changeDir, "tasks.md"), "- [x] 1.1 Do the thing\n");
      writeFileSync(join(changeDir, "review", "self-review.md"), validReviewMarkdown);
      writeFileSync(join(changeDir, "review", "self-review.html"), validReviewHtml);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"ok": true');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given an invalid optional review state file When check runs Then the workflow gate rejects the malformed state", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      await copyVisionSchema(tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      await mkdir(join(changeDir, "review"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-28\n");
      writeFileSync(join(changeDir, "plans", "plan.md"), "# Intent\n");
      writeFileSync(join(changeDir, "tasks.md"), "- [x] 1.1 Do the thing\n");
      writeFileSync(join(changeDir, "review", "self-review.md"), validReviewMarkdown);
      writeFileSync(join(changeDir, "review", "self-review.html"), validReviewHtml);
      writeFileSync(join(changeDir, "review", "state.json"), "{\n");

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("review/state.json is invalid");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a complete vision-driven change When check runs Then the workflow gate passes", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      await copyVisionSchema(tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      await mkdir(join(changeDir, "review"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-28\n");
      writeFileSync(join(changeDir, "plans", "plan.md"), "# Intent\n");
      writeFileSync(join(changeDir, "tasks.md"), "- [x] 1.1 Do the thing\n");
      writeFileSync(join(changeDir, "review", "self-review.md"), validReviewMarkdown);
      writeFileSync(join(changeDir, "review", "self-review.html"), validReviewHtml);
      writeFileSync(join(changeDir, "review", "state.json"), validReviewState);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"ok": true');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("Scenario: Given a vision-driven change is already archived When check runs Then the workflow gate resolves the archived change", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "vision-driven-"));
    try {
      await copyVisionSchema(tmpRoot);
      const changeDir = join(tmpRoot, "openspec", "changes", "archive", "2026-06-03-demo-change");
      await mkdir(join(changeDir, "plans"), { recursive: true });
      await mkdir(join(changeDir, "review"), { recursive: true });
      writeFileSync(join(changeDir, ".openspec.yaml"), "schema: vision-driven\ncreated: 2026-05-28\n");
      writeFileSync(join(changeDir, "plans", "plan.md"), "# Plan\n");
      writeFileSync(join(changeDir, "tasks.md"), "- [x] archive complete\n");
      writeFileSync(join(changeDir, "review", "self-review.md"), validReviewMarkdown);
      writeFileSync(join(changeDir, "review", "self-review.html"), validReviewHtml);

      const result = await runBun(
        [join(repoRoot, "scripts", "openspec", "vision-driven.ts"), "check", "demo-change"],
        tmpRoot,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('"ok": true');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
