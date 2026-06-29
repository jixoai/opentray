#!/usr/bin/env bun

/**
 * vision2 OpenSpec workflow controller.
 *
 * Default new-change workflow for this repo: the interview record is the
 * intent source of truth, specs/tasks drive implementation, issues/*.md
 * capture iteration findings, and toc.md closes the change with
 * Markdown-footnote references enforced by `check`.
 *
 * Generic mechanics (run/paths/versioned-doc/handoff/rename/commit-check) live
 * in ./utils and are shared with vision-driven.ts.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { assertChangeExists, changeDirOf, requireArtifact, requireChange } from "./utils/change-paths";
import { checkCommitEvidence } from "./utils/commit-check";
import { renameChange, writeHandoff } from "./utils/handoff";
import {
  ISSUE_FILE_RE,
  collectIssueIds,
  collectIssues,
  isIssueGroupBy,
  isIssuePriority,
  isIssueType,
  normalizeIssueReference,
  slugifyIssueTitle,
  validateIssueFile,
  validateIssues,
  type IssueGroupBy,
  type IssuePriority,
  type IssueRecord,
  type IssueType,
} from "./utils/issues";
import { runOpenspec } from "./utils/run";

type Command =
  | "new"
  | "status"
  | "instructions"
  | "validate"
  | "commit-check"
  | "handoff"
  | "rename"
  | "issues"
  | "check";

type CommitPhase = "interview" | "apply" | "close" | "archive";

const SCHEMA = "vision2";
const COMMIT_PHASES: CommitPhase[] = ["interview", "apply", "close", "archive"];

const projectRoot = process.cwd();

const usage = (): string =>
  [
    "Usage:",
    "  bun run openspec:vision2 -- new <change>",
    "  bun run openspec:vision2 -- status <change>",
    "  bun run openspec:vision2 -- instructions <artifact> <change>",
    "  bun run openspec:vision2 -- validate <change>",
    "  bun run openspec:vision2 -- issues <change> --archive",
    "  bun run openspec:vision2 -- issues <change> --new <bug|task|decision|risk|question> --title <title>",
    "  bun run openspec:vision2 -- commit-check <change> --phase <interview|apply|close|archive>",
    "  bun run openspec:vision2 -- handoff <change>",
    "  bun run openspec:vision2 -- rename <old-change> <new-change>",
    "  bun run openspec:vision2 -- issues <change> [--validate|--group-by <group|label|state|type>]",
    "  bun run openspec:vision2 -- check <change>",
  ].join("\n");

const interviewPlanPathOf = (change: string): string => join(changeDirOf(projectRoot, change), "interview_plan.md");
const tasksPathOf = (change: string): string => join(changeDirOf(projectRoot, change), "tasks.md");
const tocPathOf = (change: string): string => join(changeDirOf(projectRoot, change), "toc.md");
const handoffPathOf = (change: string): string => join(changeDirOf(projectRoot, change), "HANDOFF.md");

interface ArchivedIssueMove {
  from: string;
  to: string;
}

interface IssueCreateOptions {
  type: IssueType;
  title: string;
  group: string;
  labels: string[];
  dependsOn: string[];
  blocks: string[];
  priority: IssuePriority;
  owner: string | null;
  source: string;
}

interface IssueListEntry {
  relativePath: string;
  issueId: string;
  title: string;
  state: IssueRecord["state"];
  githubIssueStatus: IssueRecord["githubIssueStatus"];
  type: IssueRecord["type"];
  group: string;
  labels: string[];
  dependsOn: string[];
  blocks: string[];
  priority: IssueRecord["priority"];
  owner: string | null;
  source: string | null;
}

interface IssueListGroup {
  key: string;
  total: number;
  open: number;
  closed: number;
  issues: IssueListEntry[];
}

const isCrossDeviceRenameError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  typeof (error as { code?: unknown }).code === "string" &&
  (error as { code?: string }).code === "EXDEV";

const moveIssueFile = async (source: string, destination: string): Promise<void> => {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!isCrossDeviceRenameError(error)) {
      throw error;
    }
    await copyFile(source, destination);
    await unlink(source);
  }
};

const commitMessageFor = (change: string, phase: CommitPhase): string => {
  if (phase === "interview") {
    return `docs(spec): prepare ${change} for apply`;
  }
  if (phase === "apply") {
    return `feat: implement ${change} task batch`;
  }
  if (phase === "close") {
    return `docs(spec): close ${change} with toc`;
  }
  return `docs(spec): archive ${change}`;
};

const readOptionValue = (args: string[], name: string): string | null => {
  const index = args.indexOf(name);
  if (index < 0) {
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
};

const readOptionValues = (args: string[], name: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    values.push(value);
  }
  return values;
};

const readCommaOptionValues = (args: string[], name: string): string[] =>
  readOptionValues(args, name).flatMap((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const quoteYamlScalar = (value: string): string => JSON.stringify(value);

const renderYamlList = (values: string[]): string => {
  if (values.length === 0) {
    return " []";
  }
  return `\n${values.map((value) => `  - ${quoteYamlScalar(value)}`).join("\n")}`;
};

const issueListEntryOf = (record: IssueRecord): IssueListEntry => ({
  relativePath: record.relativePath,
  issueId: record.issueId,
  title: record.title,
  state: record.state,
  githubIssueStatus: record.githubIssueStatus,
  type: record.type,
  group: record.group,
  labels: record.labels,
  dependsOn: record.dependsOn,
  blocks: record.blocks,
  priority: record.priority,
  owner: record.owner,
  source: record.source,
});

const groupIssueRecords = (records: IssueRecord[], groupBy: IssueGroupBy): IssueListGroup[] => {
  const groups = new Map<string, IssueRecord[]>();
  const add = (key: string, record: IssueRecord): void => {
    const existing = groups.get(key) ?? [];
    existing.push(record);
    groups.set(key, existing);
  };

  for (const record of records) {
    if (groupBy === "group") {
      add(record.group, record);
      continue;
    }
    if (groupBy === "state") {
      add(record.state, record);
      continue;
    }
    if (groupBy === "type") {
      add(record.type ?? "(none)", record);
      continue;
    }
    const labels = record.labels.length > 0 ? record.labels : ["(none)"];
    for (const label of labels) {
      add(label, record);
    }
  }

  return [...groups.entries()]
    .map(([key, entries]) => {
      const issues = entries.map(issueListEntryOf);
      return {
        key,
        total: entries.length,
        open: entries.filter((entry) => entry.state === "open").length,
        closed: entries.filter((entry) => entry.state !== "open").length,
        issues,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
};

const normalizeCreateReferences = (
  fieldName: "depends_on" | "blocks",
  values: string[],
  knownIssueIds: Set<string>,
): string[] => {
  const references: string[] = [];
  for (const value of values) {
    const reference = normalizeIssueReference(value);
    if (!reference) {
      throw new Error(`${fieldName} contains invalid issue reference: ${value}`);
    }
    if (!knownIssueIds.has(reference)) {
      throw new Error(`${fieldName} references unknown issue: ${reference}`);
    }
    references.push(reference);
  }
  return [...new Set(references)];
};

const nextIssueFilename = async (changeDir: string, title: string): Promise<string> => {
  const ids = await collectIssueIds(changeDir, true);
  const max = [...ids].reduce((highest, issueId) => {
    const numericPrefix = Number.parseInt(issueId.split("-")[0] ?? "0", 10);
    return Number.isFinite(numericPrefix) && numericPrefix > highest ? numericPrefix : highest;
  }, 0);
  return `${String(max + 1).padStart(3, "0")}-${slugifyIssueTitle(title)}.md`;
};

const renderIssueTemplate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{([a-z_]+)\}\}/gu, (token, key: string) => values[key] ?? token);

const createIssueFromTemplate = async (change: string, changeDir: string, args: string[]): Promise<void> => {
  const typeValue = readOptionValue(args, "--new") ?? readOptionValue(args, "--template");
  if (!typeValue) {
    throw new Error("issue creation requires --new <bug|task|decision|risk|question>.");
  }
  if (!isIssueType(typeValue)) {
    throw new Error(`--new must be bug|task|decision|risk|question, got: ${typeValue}`);
  }

  const title = readOptionValue(args, "--title")?.trim();
  if (!title) {
    throw new Error("issue creation requires --title <title>.");
  }

  const priorityValue = readOptionValue(args, "--priority") ?? "medium";
  if (!isIssuePriority(priorityValue)) {
    throw new Error(`--priority must be low|medium|high|critical, got: ${priorityValue}`);
  }

  const knownIssueIds = await collectIssueIds(changeDir, true);
  const labels = [...readOptionValues(args, "--label"), ...readCommaOptionValues(args, "--labels"), typeValue].filter(
    (value) => value.length > 0,
  );
  const dependsOn = normalizeCreateReferences(
    "depends_on",
    [...readOptionValues(args, "--depends-on"), ...readOptionValues(args, "--depends_on")],
    knownIssueIds,
  );
  const blocks = normalizeCreateReferences("blocks", readOptionValues(args, "--blocks"), knownIssueIds);
  const group = readOptionValue(args, "--group") ?? "general";
  const owner = readOptionValue(args, "--owner");
  const source =
    readOptionValue(args, "--source") ?? `bun run openspec:vision2 -- ${["issues", change, ...args].join(" ")}`;

  const options: IssueCreateOptions = {
    type: typeValue,
    title,
    group,
    labels: [...new Set(labels)],
    dependsOn,
    blocks,
    priority: priorityValue,
    owner,
    source,
  };
  const templatePath = join(projectRoot, "openspec", "schemas", SCHEMA, "templates", "issues", `${options.type}.md`);
  if (!existsSync(templatePath)) {
    throw new Error(`missing issue template: ${relative(projectRoot, templatePath)}`);
  }

  const filename = await nextIssueFilename(changeDir, options.title);
  const issueId = filename.slice(0, -".md".length);
  const issuePath = join(changeDir, "issues", filename);
  await mkdir(join(changeDir, "issues"), { recursive: true });
  const template = await readFile(templatePath, "utf-8");
  const content = renderIssueTemplate(template, {
    title_yaml: quoteYamlScalar(options.title),
    type: options.type,
    group_yaml: quoteYamlScalar(options.group),
    labels_yaml: renderYamlList(options.labels),
    depends_on_yaml: renderYamlList(options.dependsOn),
    blocks_yaml: renderYamlList(options.blocks),
    priority: options.priority,
    owner_yaml: options.owner ? quoteYamlScalar(options.owner) : '""',
    source_yaml: quoteYamlScalar(options.source),
    summary: options.title,
  });
  const issueIdsWithNewIssue = new Set([...knownIssueIds, issueId]);
  const validation = validateIssueFile(content, filename, issueIdsWithNewIssue);
  if (validation.errors.length > 0) {
    throw new Error(`generated issue is invalid: ${validation.errors.join("; ")}`);
  }
  await writeFile(issuePath, content);
  console.log(
    JSON.stringify(
      {
        ok: true,
        change,
        created: {
          relativePath: relative(changeDir, issuePath),
          issueId,
          template: options.type,
          title: options.title,
          group: options.group,
          labels: options.labels,
          dependsOn: options.dependsOn,
          blocks: options.blocks,
          priority: options.priority,
          owner: options.owner,
        },
      },
      null,
      2,
    ),
  );
};

/**
 * Parse Markdown footnote references of the form `[^id]: <path>` from toc.md.
 * Returns the set of referenced relative paths. Footnote ids are arbitrary.
 * The first whitespace-delimited token after the colon is the path; any inline
 * comment text following the path is ignored so authors can annotate a citation.
 *
 * Example:   [^core]: specs/core/spec.md   ->  "specs/core/spec.md"
 *            [^core]: specs/core/spec.md primary contract
 */
const parseFootnoteRefs = (tocContent: string): Set<string> => {
  const refs = new Set<string>();
  // Footnote definition lines start with [^id]: at the beginning of a line.
  const re = /^\[\^[^\]]+\]:\s*(\S+)/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tocContent)) !== null) {
    refs.add(match[1]);
  }
  return refs;
};

/** Recursively list every `.md` file under `<changeDir>/specs/`, as change-relative paths. */
const listSpecFiles = async (changeDir: string): Promise<string[]> => {
  const specsDir = join(changeDir, "specs");
  if (!existsSync(specsDir)) {
    return [];
  }
  const files: string[] = [];
  for await (const file of new Bun.Glob("**/*.md").scan({ cwd: specsDir, absolute: true })) {
    files.push(relative(changeDir, file));
  }
  return files.sort();
};

/**
 * Drop the first artifact's template skeleton into the change dir as a starting
 * point. Only specs/ (multi-file, capability-named) and later artifacts are
 * left for the agent to author against the template reference, because
 * scaffolding them prematurely would either require guessing paths or produce
 * dangling footnotes. Idempotent: never overwrites an existing file.
 */
const scaffoldFirstArtifact = async (change: string): Promise<void> => {
  const interviewPath = interviewPlanPathOf(change);
  if (existsSync(interviewPath)) {
    return;
  }
  const templatePath = join(projectRoot, "openspec", "schemas", SCHEMA, "templates", "interview_plan.md");
  if (!existsSync(templatePath)) {
    return;
  }
  await copyFile(templatePath, interviewPath);
};

const createChange = async (change: string): Promise<void> => {
  if (!(await runOpenspec(["new", "change", change, "--schema", SCHEMA], { cwd: projectRoot }))) {
    return;
  }
  // Scaffold the interview skeleton so an agent with no prior context can fill
  // it in place instead of hand-copying the template. This happens before
  // status/instructions so the first artifact exists when the agent starts.
  await scaffoldFirstArtifact(change);
  if (!(await runOpenspec(["status", "--change", change, "--schema", SCHEMA], { cwd: projectRoot }))) {
    return;
  }
  await runOpenspec(["instructions", "interview", "--change", change, "--schema", SCHEMA], { cwd: projectRoot });
};

const showStatus = async (change: string): Promise<void> => {
  await runOpenspec(["status", "--change", change, "--schema", SCHEMA], { cwd: projectRoot });
};

const showInstructions = async (artifact: string, change: string): Promise<void> => {
  await runOpenspec(["instructions", artifact, "--change", change, "--schema", SCHEMA], { cwd: projectRoot });
};

const validateChange = async (change: string): Promise<void> => {
  await runOpenspec(["validate", change, "--type", "change", "--strict"], { cwd: projectRoot });
};

const listOrValidateIssues = async (change: string, args: string[]): Promise<void> => {
  const changeDir = assertChangeExists(projectRoot, change);
  const validateOnly = args.includes("--validate");
  const archiveOnly = args.includes("--archive");
  const createIssue = args.includes("--new") || args.includes("--template");
  const requestedModes = [validateOnly, archiveOnly, createIssue].filter(Boolean).length;
  if (requestedModes > 1) {
    throw new Error("Use only one of --new, --validate, or --archive.");
  }
  if (createIssue) {
    await createIssueFromTemplate(change, changeDir, args);
    return;
  }
  if (archiveOnly) {
    const issuesDir = join(changeDir, "issues");
    const archiveDir = join(issuesDir, "closed");
    const archived: ArchivedIssueMove[] = [];
    const validationErrors: Array<{ relativePath: string; errors: string[] }> = [];

    if (!existsSync(issuesDir)) {
      console.log(JSON.stringify({ ok: true, change, archived: [], note: "nothing to archive" }, null, 2));
      return;
    }

    const entries = await readdir(issuesDir, { withFileTypes: true });
    const issueFiles = entries
      .filter((entry) => entry.isFile() && ISSUE_FILE_RE.test(entry.name))
      .map((entry) => join(issuesDir, entry.name))
      .sort((a, b) => a.localeCompare(b));

    const eligible: Array<{ path: string; state: "open" | "resolved" | "closed" }> = [];
    for (const file of issueFiles) {
      const text = await readFile(file, "utf-8");
      const validation = validateIssueFile(text, basename(file));
      if (validation.errors.length > 0 || !validation.record) {
        validationErrors.push({
          relativePath: relative(changeDir, file),
          errors: validation.errors,
        });
        continue;
      }
      if (validation.record.state !== "open") {
        eligible.push({ path: file, state: validation.record.state });
      }
    }

    if (validationErrors.length > 0) {
      console.error(JSON.stringify({ ok: false, change, invalidIssueFiles: validationErrors }, null, 2));
      process.exitCode = 1;
      return;
    }

    if (eligible.length === 0) {
      console.log(JSON.stringify({ ok: true, change, archived: [], note: "nothing to archive" }, null, 2));
      return;
    }

    await mkdir(archiveDir, { recursive: true });
    for (const entry of eligible) {
      const source = entry.path;
      const target = join(archiveDir, basename(source));
      await moveIssueFile(source, target);
      archived.push({
        from: relative(changeDir, source),
        to: relative(changeDir, target),
      });
    }

    console.log(JSON.stringify({ ok: true, change, archived }, null, 2));
    return;
  }
  if (validateOnly) {
    const results = await validateIssues(changeDir);
    if (results.length === 0) {
      console.log(JSON.stringify({ ok: true, change, issues: [], note: "no issue files" }, null, 2));
      return;
    }
    const invalid = results.filter((r) => r.errors.length > 0);
    console.log(
      JSON.stringify(
        {
          ok: invalid.length === 0,
          change,
          checked: results.length,
          invalid: invalid.map((r) => ({ relativePath: r.relativePath, errors: r.errors })),
        },
        null,
        2,
      ),
    );
    if (invalid.length > 0) {
      process.exitCode = 1;
    }
    return;
  }
  const records = await collectIssues(changeDir);
  const open = records.filter((r) => r.state === "open");
  const closed = records.filter((r) => r.state !== "open");
  const groupByValue = readOptionValue(args, "--group-by");
  if (groupByValue && !isIssueGroupBy(groupByValue)) {
    throw new Error(`--group-by must be group|label|state|type, got: ${groupByValue}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        change,
        groupBy: groupByValue,
        total: records.length,
        open: open.length,
        closed: closed.length,
        issues: records.map(issueListEntryOf),
        groups: groupByValue ? groupIssueRecords(records, groupByValue) : undefined,
      },
      null,
      2,
    ),
  );
};

interface CheckResult {
  issues: string[];
  openIssues: number;
  closedUnarchived: number;
  orphanSpecs: string[];
  danglingFootnotes: string[];
  invalidIssueFiles: Array<{ relativePath: string; errors: string[] }>;
}

/**
 * Final proof gate. Validates artifact presence, toc footnote coverage of every
 * spec file, footnote target existence, issue file structure, and open-issue
 * convergence. Exits 0 only when every check passes; exit 2 signals an open
 * issue keeps the workflow in the iteration loop.
 */
const checkChange = async (change: string): Promise<void> => {
  const changeDir = assertChangeExists(projectRoot, change);
  const metadataPath = join(changeDir, ".openspec.yaml");
  const interviewPlanPath = interviewPlanPathOf(change);
  const tasksPath = tasksPathOf(change);
  const tocPath = tocPathOf(change);

  const result: CheckResult = {
    issues: [],
    openIssues: 0,
    closedUnarchived: 0,
    orphanSpecs: [],
    danglingFootnotes: [],
    invalidIssueFiles: [],
  };

  // 1. schema metadata
  const metadata = existsSync(metadataPath) ? await readFile(metadataPath, "utf-8") : "";
  if (!metadata.includes(`schema: ${SCHEMA}`)) {
    result.issues.push(`${basename(metadataPath)} must declare schema: ${SCHEMA}`);
  }

  // 2. interview_plan.md
  if (!existsSync(interviewPlanPath)) {
    result.issues.push("interview_plan.md is missing");
  } else {
    const content = await readFile(interviewPlanPath, "utf-8");
    if (content.trim().length === 0) {
      result.issues.push("interview_plan.md is empty");
    }
  }

  // 3. tasks.md with trackable checkboxes
  if (!existsSync(tasksPath)) {
    result.issues.push("tasks.md is missing");
  } else {
    const tasks = await readFile(tasksPath, "utf-8");
    if (!/^[-*]\s+\[[ xX]\]\s+/m.test(tasks)) {
      result.issues.push("tasks.md has no trackable checkboxes");
    }
  }

  // 4-6. toc.md presence + footnote coverage + footnote targets
  const specFiles = await listSpecFiles(changeDir);
  if (!existsSync(tocPath)) {
    result.issues.push("toc.md is missing");
  } else {
    const tocContent = await readFile(tocPath, "utf-8");
    if (tocContent.trim().length === 0) {
      result.issues.push("toc.md is empty");
    } else {
      // Footnote coverage: every spec file must be cited by at least one footnote.
      const refs = parseFootnoteRefs(tocContent);
      const orphanSpecs = specFiles.filter((spec) => !refs.has(spec));
      if (orphanSpecs.length > 0) {
        result.orphanSpecs = orphanSpecs;
        result.issues.push(`toc.md does not cite ${orphanSpecs.length} spec file(s): ${orphanSpecs.join(", ")}`);
      }
      // Footnote targets: every cited path must exist.
      const danglingFootnotes = [...refs].filter((ref) => !existsSync(join(changeDir, ref)));
      if (danglingFootnotes.length > 0) {
        result.danglingFootnotes = danglingFootnotes;
        result.issues.push(
          `toc.md has ${danglingFootnotes.length} dangling footnote(s): ${danglingFootnotes.join(", ")}`,
        );
      }
    }
  }

  // 7-8. issues validation + open-issue convergence
  const issueValidations = await validateIssues(changeDir);
  const invalid = issueValidations.filter((r) => r.errors.length > 0);
  if (invalid.length > 0) {
    result.invalidIssueFiles = invalid;
    for (const entry of invalid) {
      result.issues.push(`issue file ${entry.relativePath} is invalid: ${entry.errors.join("; ")}`);
    }
  }
  const activeIssues = await collectIssues(changeDir);
  result.openIssues = activeIssues.filter((r) => r.state === "open").length;
  result.closedUnarchived = activeIssues.filter((r) => r.state !== "open").length;

  // Exit decision.
  const hasBlockingIssues = result.issues.length > 0;
  if (hasBlockingIssues) {
    console.error(JSON.stringify({ ok: false, change, ...result }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (result.openIssues > 0) {
    // Structural checks passed, but open issues keep the workflow iterating.
    console.log(
      JSON.stringify(
        { ok: true, change, openIssues: result.openIssues, closedUnarchived: result.closedUnarchived, loop: true },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }
  console.log(
    JSON.stringify(
      { ok: true, change, openIssues: 0, closedUnarchived: result.closedUnarchived, loop: false },
      null,
      2,
    ),
  );
};

const handoffPaths = {
  goalPath: (_root: string, change: string) => interviewPlanPathOf(change),
  progressFiles: [{ label: "TOC overview", path: (_root: string, change: string) => tocPathOf(change) }],
  tasksPath: (_root: string, change: string) => tasksPathOf(change),
  handoffPath: (_root: string, change: string) => handoffPathOf(change),
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
    await renameChange(projectRoot, oldChange, newChange);
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
    await checkCommitEvidence(projectRoot, change, rest, {
      phases: COMMIT_PHASES,
      commitMessageFor: (c, p) => commitMessageFor(c, p as CommitPhase),
    });
    return;
  }
  if (command === "handoff") {
    await writeHandoff(projectRoot, change, SCHEMA, handoffPaths);
    return;
  }
  if (command === "issues") {
    await listOrValidateIssues(change, rest);
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
