#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

type Command =
  | "new"
  | "status"
  | "instructions"
  | "validate"
  | "commit-check"
  | "handoff"
  | "rename"
  | "backup-plan"
  | "review-state"
  | "check";

type CommitPhase = "research-plan" | "apply" | "self-review" | "archive";

interface ReviewState {
  change: string;
  iteration: number;
  maxIterations: number;
  recurringIssues: Record<string, number>;
  exitCondition?: string;
  updatedAt: string;
}

const projectRoot = process.cwd();
const visionSchema = "vision-driven";

const usage = (): string =>
  [
    "Usage:",
    "  bun run scripts/openspec/vision-driven.ts new <change>",
    "  bun run scripts/openspec/vision-driven.ts status <change>",
    "  bun run scripts/openspec/vision-driven.ts instructions <artifact> <change>",
    "  bun run scripts/openspec/vision-driven.ts validate <change>",
    "  bun run scripts/openspec/vision-driven.ts commit-check <change> --phase <research-plan|apply|self-review|archive>",
    "  bun run scripts/openspec/vision-driven.ts handoff <change>",
    "  bun run scripts/openspec/vision-driven.ts rename <old-change> <new-change>",
    "  bun run scripts/openspec/vision-driven.ts backup-plan <change>",
    "  bun run scripts/openspec/vision-driven.ts review-state <change> [--issue <id>] [--max <n>] [--exit-condition <text>]",
    "  bun run scripts/openspec/vision-driven.ts check <change>",
  ].join("\n");

const getArgValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args.at(index + 1);
};

const requireChange = (value: string | undefined): string => {
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing change name.\n${usage()}`);
  }
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Invalid change name: ${value}`);
  }
  return value;
};

const requireArtifact = (value: string | undefined): string => {
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing artifact id.\n${usage()}`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error(`Invalid artifact id: ${value}`);
  }
  return value;
};

const requireCommitPhase = (value: string | undefined): CommitPhase => {
  if (
    value === "research-plan" ||
    value === "apply" ||
    value === "self-review" ||
    value === "archive"
  ) {
    return value;
  }
  throw new Error(`Invalid or missing --phase value: ${value ?? ""}`);
};

const changeDirOf = (change: string): string => join(projectRoot, "openspec", "changes", change);
const planPathOf = (change: string): string => join(changeDirOf(change), "plans", "plan.md");
const reviewMarkdownPathOf = (change: string): string => join(changeDirOf(change), "review", "self-review.md");
const reviewHtmlPathOf = (change: string): string => join(changeDirOf(change), "review", "self-review.html");
const reviewStatePathOf = (change: string): string => join(changeDirOf(change), "review", "state.json");
const handoffPathOf = (change: string): string => join(changeDirOf(change), "HANDOFF.md");

const runOpenspec = async (args: string[]): Promise<boolean> => {
  const proc = Bun.spawn({
    cmd: ["openspec", ...args],
    cwd: projectRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return false;
  }
  return true;
};

const runCapture = async (cmd: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const proc = Bun.spawn({
    cmd,
    cwd: projectRoot,
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

const readInlineDocument = async (): Promise<string | null> => {
  if (process.stdin.isTTY) {
    return null;
  }
  const content = await new Response(Bun.stdin.stream()).text();
  return content.length > 0 ? content : null;
};

const writeVersionedDocument = async (
  targetPath: string,
  content: string,
  nextBackupPath: () => string,
): Promise<void> => {
  if (existsSync(targetPath)) {
    await rename(targetPath, nextBackupPath());
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
};

const assertChangeExists = (change: string): string => {
  const changeDir = changeDirOf(change);
  if (!existsSync(changeDir)) {
    throw new Error(`OpenSpec change not found: ${changeDir}`);
  }
  return changeDir;
};

const nextPlanBackupPath = (change: string): string => {
  const plansDir = join(changeDirOf(change), "plans");
  for (let index = 1; index < 1000; index += 1) {
    const backupPath = join(plansDir, `plan-v${index}.md`);
    if (!existsSync(backupPath)) {
      return backupPath;
    }
  }
  throw new Error("Too many plan revisions.");
};

const backupPlan = async (change: string): Promise<void> => {
  assertChangeExists(change);
  const currentPlanPath = planPathOf(change);
  if (!existsSync(currentPlanPath)) {
    console.log(`No current plan found at ${currentPlanPath}; nothing to back up.`);
    return;
  }
  const backupPath = nextPlanBackupPath(change);
  await mkdir(dirname(backupPath), { recursive: true });
  await copyFile(currentPlanPath, backupPath);
  console.log(`Backed up ${currentPlanPath} -> ${backupPath}`);
};

const readReviewState = async (change: string): Promise<ReviewState | null> => {
  const statePath = reviewStatePathOf(change);
  if (!existsSync(statePath)) {
    return null;
  }
  return (await Bun.file(statePath).json()) as ReviewState;
};

const writeReviewState = async (state: ReviewState): Promise<void> => {
  const statePath = reviewStatePathOf(state.change);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
};

const nextHandoffBackupPath = (change: string): string => {
  const changeDir = changeDirOf(change);
  for (let index = 1; index < 1000; index += 1) {
    const backupPath = join(changeDir, `v${index}.HANDOFF.md`);
    if (!existsSync(backupPath)) {
      return backupPath;
    }
  }
  throw new Error("Too many handoff revisions.");
};

const parseReviewState = (raw: string): ReviewState | null => {
  const parsed = JSON.parse(raw) as Partial<ReviewState>;
  if (
    typeof parsed.change !== "string" ||
    !Number.isInteger(parsed.iteration) ||
    !Number.isInteger(parsed.maxIterations) ||
    typeof parsed.updatedAt !== "string" ||
    typeof parsed.recurringIssues !== "object" ||
    parsed.recurringIssues === null ||
    Array.isArray(parsed.recurringIssues)
  ) {
    return null;
  }
  return {
    change: parsed.change,
    iteration: parsed.iteration,
    maxIterations: parsed.maxIterations,
    recurringIssues: parsed.recurringIssues,
    exitCondition: typeof parsed.exitCondition === "string" ? parsed.exitCondition : undefined,
    updatedAt: parsed.updatedAt,
  };
};

const updateReviewState = async (change: string, args: string[]): Promise<void> => {
  assertChangeExists(change);
  const previous = await readReviewState(change);
  const maxIterationsValue = getArgValue(args, "--max");
  const issue = getArgValue(args, "--issue");
  const exitCondition = getArgValue(args, "--exit-condition") ?? previous?.exitCondition;
  const maxIterations = maxIterationsValue ? Number.parseInt(maxIterationsValue, 10) : (previous?.maxIterations ?? 5);
  if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
    throw new Error(`Invalid --max value: ${maxIterationsValue}`);
  }

  const recurringIssues = { ...(previous?.recurringIssues ?? {}) };
  if (issue) {
    recurringIssues[issue] = (recurringIssues[issue] ?? 0) + 1;
  }

  const stateBase = {
    change,
    iteration: (previous?.iteration ?? 0) + 1,
    maxIterations,
    recurringIssues,
    updatedAt: new Date().toISOString(),
  };
  const state: ReviewState = exitCondition ? { ...stateBase, exitCondition } : stateBase;
  await writeReviewState(state);

  const repeatedIssues = Object.entries(recurringIssues)
    .filter(([, count]) => count >= 2)
    .map(([id]) => id);
  const exhausted = state.iteration >= state.maxIterations;
  console.log(JSON.stringify({ state, repeatedIssues, exhausted }, null, 2));
  if (repeatedIssues.length > 0 || exhausted) {
    process.exitCode = 2;
  }
};

const checkChange = async (change: string): Promise<void> => {
  const changeDir = assertChangeExists(change);
  const metadataPath = join(changeDir, ".openspec.yaml");
  const planPath = planPathOf(change);
  const tasksPath = join(changeDir, "tasks.md");
  const reviewMarkdownPath = reviewMarkdownPathOf(change);
  const reviewHtmlPath = reviewHtmlPathOf(change);
  const reviewStatePath = reviewStatePathOf(change);

  const metadata = existsSync(metadataPath) ? await readFile(metadataPath, "utf-8") : "";
  const issues: string[] = [];
  if (!metadata.includes("schema: vision-driven")) {
    issues.push(`${basename(metadataPath)} must declare schema: vision-driven`);
  }
  if (!existsSync(planPath)) {
    issues.push("plans/plan.md is missing");
  }
  if (!existsSync(tasksPath)) {
    issues.push("tasks.md is missing");
  }
  if (existsSync(tasksPath)) {
    const tasks = await readFile(tasksPath, "utf-8");
    if (!/^[-*]\s+\[[ xX]\]\s+/m.test(tasks)) {
      issues.push("tasks.md has no trackable checkboxes");
    }
  }
  if (!existsSync(reviewMarkdownPath)) {
    issues.push("review/self-review.md is missing");
  } else {
    const reviewMarkdown = await readFile(reviewMarkdownPath, "utf-8");
    if (reviewMarkdown.trim().length === 0) {
      issues.push("review/self-review.md is empty");
    }
  }
  if (!existsSync(reviewHtmlPath)) {
    issues.push("review/self-review.html is missing");
  } else {
    const reviewHtml = await readFile(reviewHtmlPath, "utf-8");
    if (reviewHtml.trim().length === 0) {
      issues.push("review/self-review.html is empty");
    }
  }
  if (existsSync(reviewStatePath)) {
    try {
      const parsedState = parseReviewState(await readFile(reviewStatePath, "utf-8"));
      if (!parsedState) {
        issues.push("review/state.json is invalid");
      } else if (parsedState.change !== change) {
        issues.push(`review/state.json change mismatch: expected ${change}, got ${parsedState.change}`);
      }
    } catch {
      issues.push("review/state.json is invalid");
    }
  }

  if (issues.length > 0) {
    console.error(JSON.stringify({ ok: false, change, issues }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, change }, null, 2));
};

const commitMessageFor = (change: string, phase: CommitPhase): string => {
  if (phase === "research-plan") {
    return `docs(spec): prepare ${change} for apply`;
  }
  if (phase === "apply") {
    return `feat: implement ${change} task batch`;
  }
  if (phase === "self-review") {
    return `docs(spec): record ${change} self-review`;
  }
  return `docs(spec): archive ${change}`;
};

const checkCommitEvidence = async (change: string, args: string[]): Promise<void> => {
  assertChangeExists(change);
  const phase = requireCommitPhase(getArgValue(args, "--phase"));
  const status = await runCapture(["git", "status", "--short", "--untracked-files=all"]);
  const head = await runCapture(["git", "log", "-1", "--oneline"]);
  const changePrefix = `openspec/changes/${change}/`;
  const statusLines = status.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  const changePaths = statusLines.filter((line) => line.includes(changePrefix));
  const otherPaths = statusLines.filter((line) => !line.includes(changePrefix));
  const suggestedMessage = commitMessageFor(change, phase);

  // The user intent is evidence retention, not automated commits. This command inspects and guides,
  // leaving file selection explicit so unrelated dirty work cannot be accidentally committed.
  console.log(
    JSON.stringify(
      {
        ok: true,
        change,
        phase,
        latestCommit: head.exitCode === 0 ? head.stdout.trim() : null,
        changePaths,
        otherPaths,
        suggestedCommands: [
          `git add openspec/changes/${change}`,
          `git commit -m "${suggestedMessage}"`,
        ],
      },
      null,
      2,
    ),
  );
};

const readOptionalFile = async (path: string): Promise<string | null> => {
  if (!existsSync(path)) {
    return null;
  }
  return readFile(path, "utf-8");
};

const summarizeFile = (content: string | null, fallback: string): string => {
  if (!content) {
    return fallback;
  }
  const firstMeaningfulLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("|") && !line.startsWith("- ["));
  return firstMeaningfulLine ?? fallback;
};

const writeHandoff = async (change: string): Promise<void> => {
  const changeDir = assertChangeExists(change);
  const handoffPath = handoffPathOf(change);
  const inlineDocument = await readInlineDocument();
  if (inlineDocument !== null) {
    // Here Document input is an operator-supplied source of truth; write it exactly while
    // preserving prior handoff evidence with the same versioning rule as generated handoffs.
    await writeVersionedDocument(handoffPath, inlineDocument, () => nextHandoffBackupPath(change));
    console.log(JSON.stringify({ ok: true, change, handoffPath, source: "stdin" }, null, 2));
    return;
  }

  const metadata = await readOptionalFile(join(changeDir, ".openspec.yaml"));
  const schemaName = metadata?.match(/^schema:\s*(\S+)/m)?.[1] ?? visionSchema;
  const schema = await readOptionalFile(join(projectRoot, "openspec", "schemas", schemaName, "schema.yaml"));
  const plan = await readOptionalFile(planPathOf(change));
  const tasks = await readOptionalFile(join(changeDir, "tasks.md"));
  const reviewMarkdown = await readOptionalFile(reviewMarkdownPathOf(change));
  const reviewHtml = await readOptionalFile(reviewHtmlPathOf(change));
  const status = await runCapture(["openspec", "status", "--change", change, "--schema", schemaName]);
  const gitStatus = await runCapture(["git", "status", "--short", "--branch"]);
  const latestCommit = await runCapture(["git", "log", "-1", "--oneline"]);

  const uncheckedTasks =
    tasks
      ?.split("\n")
      .filter((line) => /^[-*]\s+\[ \]\s+/.test(line))
      .join("\n") || "No unchecked tasks found in tasks.md.";

  // Handoff is generated from repo evidence so a fresh agent can continue after context loss.
  const handoff = [
    `# Handoff: ${change}`,
    "",
    "## Goal",
    "",
    summarizeFile(plan, "Goal not found; read the change artifacts before continuing."),
    "",
    "## Current Progress",
    "",
    `- Change: \`${change}\``,
    `- Schema: \`${schemaName}\``,
    `- Latest commit: ${latestCommit.exitCode === 0 ? latestCommit.stdout.trim() : "unknown"}`,
    "- OpenSpec status:",
    "```text",
    status.exitCode === 0 ? status.stdout.trim() : status.stderr.trim(),
    "```",
    "- Git status:",
    "```text",
    gitStatus.exitCode === 0 ? gitStatus.stdout.trim() : gitStatus.stderr.trim(),
    "```",
    "",
    "## What Worked",
    "",
    `- Schema definition was ${schema ? "found" : "not found"} for \`${schemaName}\`.`,
    `- Intent document was ${plan ? "found" : "not found"}.`,
    `- Tasks file was ${tasks ? "found" : "not found"}.`,
    `- Self-review Markdown was ${reviewMarkdown ? "found" : "not found"}.`,
    `- Self-review HTML report was ${reviewHtml ? "found" : "not found"}.`,
    "",
    "## What Didn't Work",
    "",
    "- This handoff was generated because the workflow could not exit normally or needs a fresh-context continuation.",
    "- Rebuild confidence from the evidence above before checking off any further tasks.",
    "",
    "## Next Steps",
    "",
    "```text",
    uncheckedTasks,
    "```",
    "",
  ].join("\n");

  await writeVersionedDocument(handoffPath, handoff, () => nextHandoffBackupPath(change));
  console.log(JSON.stringify({ ok: true, change, handoffPath, source: "generated" }, null, 2));
};

const renameChange = async (oldChange: string, newChange: string): Promise<void> => {
  const oldDir = assertChangeExists(oldChange);
  const newDir = changeDirOf(newChange);
  if (existsSync(newDir)) {
    throw new Error(`Target OpenSpec change already exists: ${newDir}`);
  }

  await rename(oldDir, newDir);
  const statePath = reviewStatePathOf(newChange);
  if (existsSync(statePath)) {
    const parsedState = parseReviewState(await readFile(statePath, "utf-8"));
    if (parsedState) {
      await writeReviewState({ ...parsedState, change: newChange, updatedAt: new Date().toISOString() });
    }
  }
  console.log(JSON.stringify({ ok: true, from: oldChange, to: newChange, path: newDir }, null, 2));
};

const createChange = async (change: string): Promise<void> => {
  if (!(await runOpenspec(["new", "change", change, "--schema", visionSchema]))) {
    return;
  }
  if (!(await runOpenspec(["status", "--change", change, "--schema", visionSchema]))) {
    return;
  }
  await runOpenspec(["instructions", "research-plan", "--change", change, "--schema", visionSchema]);
};

const showStatus = async (change: string): Promise<void> => {
  await runOpenspec(["status", "--change", change, "--schema", visionSchema]);
};

const showInstructions = async (artifact: string, change: string): Promise<void> => {
  await runOpenspec(["instructions", artifact, "--change", change, "--schema", visionSchema]);
};

const validateChange = async (change: string): Promise<void> => {
  await runOpenspec(["validate", change, "--type", "change", "--strict"]);
};

const main = async (): Promise<void> => {
  const [commandValue, firstValue, ...rest] = Bun.argv.slice(2);
  const command = commandValue as Command | undefined;
  if (command === "instructions") {
    const artifact = requireArtifact(firstValue);
    const change = requireChange(rest[0]);
    await showInstructions(artifact, change);
    return;
  }
  if (command === "rename") {
    const oldChange = requireChange(firstValue);
    const newChange = requireChange(rest[0]);
    await renameChange(oldChange, newChange);
    return;
  }

  const change = requireChange(firstValue);
  if (command === "new") {
    await createChange(change);
    return;
  }
  if (command === "status") {
    await showStatus(change);
    return;
  }
  if (command === "validate") {
    await validateChange(change);
    return;
  }
  if (command === "commit-check") {
    await checkCommitEvidence(change, rest);
    return;
  }
  if (command === "handoff") {
    await writeHandoff(change);
    return;
  }
  if (command === "backup-plan") {
    await backupPlan(change);
    return;
  }
  if (command === "review-state") {
    await updateReviewState(change, rest);
    return;
  }
  if (command === "check") {
    await checkChange(change);
    return;
  }
  throw new Error(`Unknown command: ${commandValue ?? ""}\n${usage()}`);
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
