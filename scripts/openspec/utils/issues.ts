/**
 * GitHub-style issue discovery + validation, shared across schema controllers.
 *
 * One finding lives in one Markdown file under `issues/*.md` (excluding
 * `issues/closed/` for active issue convergence). Front matter is the issue
 * ontology; the Markdown body is human evidence.
 */

import { existsSync } from "node:fs";
import { join, relative } from "node:path";

export const ISSUE_FILE_RE = /^\d{3,}-[a-z0-9][a-z0-9-]*\.md$/;
export const ISSUE_ID_RE = /^\d{3,}-[a-z0-9][a-z0-9-]*$/;

export type IssueState = "open" | "resolved" | "closed";
export type GithubIssueStatus = "open" | "closed";
export type IssueType = "bug" | "task" | "decision" | "risk" | "question";
export type IssuePriority = "low" | "medium" | "high" | "critical";
export type IssueGroupBy = "group" | "label" | "state" | "type";

export const ISSUE_TEMPLATE_TYPES: IssueType[] = ["bug", "task", "decision", "risk", "question"];
export const ISSUE_PRIORITIES: IssuePriority[] = ["low", "medium", "high", "critical"];

export interface IssueRecord {
  /** Absolute path to the issue file. */
  path: string;
  /** Path relative to the change directory. */
  relativePath: string;
  /** Stable issue reference, derived from the filename without `.md`. */
  issueId: string;
  title: string;
  state: IssueState;
  githubIssueStatus: GithubIssueStatus;
  /** Optional issue kind. Legacy issue files may omit it. */
  type: IssueType | null;
  /** Logical grouping key. Legacy issue files default to `general`. */
  group: string;
  labels: string[];
  dependsOn: string[];
  blocks: string[];
  priority: IssuePriority | null;
  owner: string | null;
  source: string | null;
  sections: string[];
}

export interface IssueValidation {
  record: IssueRecord | null;
  /** Reasons the file failed validation (empty when valid). */
  errors: string[];
}

export interface IssueValidationResult {
  file: string;
  relativePath: string;
  issueId: string | null;
  errors: string[];
}

type FrontMatterValue = string | string[];
type FrontMatter = Record<string, FrontMatterValue>;

interface ParsedFrontMatter {
  values: FrontMatter;
  body: string;
  errors: string[];
}

interface IssueFileEntry {
  path: string;
  relativePath: string;
  issueId: string | null;
  filename: string;
}

const ALLOWED_FRONT_KEYS = new Set([
  "title",
  "state",
  "github_issue_status",
  "type",
  "group",
  "label",
  "labels",
  "milestone",
  "depends_on",
  "blocks",
  "priority",
  "owner",
  "source",
  "resolution",
]);
const REQUIRED_SECTIONS = ["## Summary", "## Impact", "## Evidence"];

const basename = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** Recursively walk a directory yielding absolute file paths. */
const walk = async function* (dir: string): AsyncGenerator<string> {
  for await (const entry of new Bun.Glob("**/*").scan({ cwd: dir, absolute: true })) {
    yield entry;
  }
};

export const issueIdFromFilename = (filename: string): string | null => {
  if (!ISSUE_FILE_RE.test(filename)) {
    return null;
  }
  return filename.slice(0, -".md".length);
};

export const normalizeIssueReference = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const filename = basename(trimmed).replace(/\.md$/u, "");
  return ISSUE_ID_RE.test(filename) ? filename : null;
};

export const slugifyIssueTitle = (title: string): string => {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "issue";
};

const isIssueState = (value: string): value is IssueState =>
  value === "open" || value === "resolved" || value === "closed";

const isGithubIssueStatus = (value: string): value is GithubIssueStatus => value === "open" || value === "closed";

export const isIssueType = (value: string): value is IssueType =>
  value === "bug" || value === "task" || value === "decision" || value === "risk" || value === "question";

export const isIssuePriority = (value: string): value is IssuePriority =>
  value === "low" || value === "medium" || value === "high" || value === "critical";

export const isIssueGroupBy = (value: string): value is IssueGroupBy =>
  value === "group" || value === "label" || value === "state" || value === "type";

const stripQuotes = (value: string): string => value.trim().replace(/^["']|["']$/gu, "");

const parseInlineList = (value: string): string[] | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }
  const content = trimmed.slice(1, -1).trim();
  if (!content) {
    return [];
  }
  return content
    .split(",")
    .map((item) => stripQuotes(item))
    .filter((item) => item.length > 0);
};

const parseFrontMatter = (text: string): ParsedFrontMatter | null => {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  if (!match) {
    return null;
  }

  const values: FrontMatter = {};
  const errors: string[] = [];
  let currentListKey: string | null = null;

  for (const rawLine of match[1].split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const listItem = rawLine.match(/^\s+-\s*(.*)$/u);
    if (listItem && currentListKey) {
      const current = values[currentListKey];
      if (Array.isArray(current)) {
        current.push(stripQuotes(listItem[1]));
      }
      continue;
    }

    currentListKey = null;
    const scalar = rawLine.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/u);
    if (!scalar) {
      errors.push(`front matter line is not supported: ${rawLine}`);
      continue;
    }

    const [, key, rawValue = ""] = scalar;
    const inlineList = parseInlineList(rawValue);
    if (inlineList) {
      values[key] = inlineList;
      continue;
    }
    if (rawValue.trim().length === 0) {
      values[key] = [];
      currentListKey = key;
      continue;
    }
    values[key] = stripQuotes(rawValue);
  }

  return {
    values,
    body: text.slice(match[0].length),
    errors,
  };
};

const scalarValue = (frontMatter: FrontMatter, key: string): string | null => {
  const value = frontMatter[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const listValue = (frontMatter: FrontMatter, key: string): string[] => {
  const value = frontMatter[key];
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter((item) => item.length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
};

const unique = (values: string[]): string[] => [...new Set(values)];

const validateReferences = (
  fieldName: "depends_on" | "blocks",
  values: string[],
  issueId: string,
  knownIssueIds: Set<string> | null,
  errors: string[],
): string[] => {
  const references: string[] = [];
  for (const value of values) {
    const reference = normalizeIssueReference(value);
    if (!reference) {
      errors.push(`front matter ${fieldName} contains invalid issue reference: ${value}`);
      continue;
    }
    if (reference === issueId) {
      errors.push(`front matter ${fieldName} must not reference itself: ${reference}`);
      continue;
    }
    if (knownIssueIds && !knownIssueIds.has(reference)) {
      errors.push(`front matter ${fieldName} references unknown issue: ${reference}`);
      continue;
    }
    references.push(reference);
  }
  return unique(references);
};

/**
 * Validate a single issue file. Returns the record when valid, or a list of
 * structural errors otherwise.
 */
export const validateIssueFile = (
  text: string,
  filename: string,
  knownIssueIds: Set<string> | null = null,
): IssueValidation => {
  const errors: string[] = [];
  const issueId = issueIdFromFilename(filename);
  if (!issueId) {
    return { record: null, errors: [`filename must match ${ISSUE_FILE_RE.source}`] };
  }
  const parsed = parseFrontMatter(text);
  if (!parsed) {
    return { record: null, errors: ["missing YAML front matter"] };
  }
  errors.push(...parsed.errors);

  const frontMatter = parsed.values;
  const title = scalarValue(frontMatter, "title") ?? "";
  const stateValue = scalarValue(frontMatter, "state") ?? "";
  const githubIssueStatusValue = scalarValue(frontMatter, "github_issue_status") ?? "";
  const typeValue = scalarValue(frontMatter, "type");
  const group = scalarValue(frontMatter, "group") ?? "general";
  const priorityValue = scalarValue(frontMatter, "priority");
  const owner = scalarValue(frontMatter, "owner");
  const source = scalarValue(frontMatter, "source");

  if (!title) {
    errors.push("front matter missing title");
  }
  if (!isIssueState(stateValue)) {
    errors.push(`front matter state must be open|resolved|closed, got: ${stateValue || "(missing)"}`);
  }
  if (!isGithubIssueStatus(githubIssueStatusValue)) {
    errors.push(`front matter github_issue_status must be open|closed, got: ${githubIssueStatusValue || "(missing)"}`);
  }
  if (typeValue && !isIssueType(typeValue)) {
    errors.push(`front matter type must be bug|task|decision|risk|question, got: ${typeValue}`);
  }
  if (priorityValue && !isIssuePriority(priorityValue)) {
    errors.push(`front matter priority must be low|medium|high|critical, got: ${priorityValue}`);
  }

  const labels = unique([...listValue(frontMatter, "labels"), ...listValue(frontMatter, "label")]);
  const dependsOn = validateReferences(
    "depends_on",
    listValue(frontMatter, "depends_on"),
    issueId,
    knownIssueIds,
    errors,
  );
  const blocks = validateReferences("blocks", listValue(frontMatter, "blocks"), issueId, knownIssueIds, errors);

  const unknownKeys = Object.keys(frontMatter).filter((key) => !ALLOWED_FRONT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    errors.push(`front matter has unknown keys: ${unknownKeys.join(", ")}`);
  }

  const missingSections = REQUIRED_SECTIONS.filter((section) => !parsed.body.includes(section));
  if (missingSections.length > 0) {
    errors.push(`body missing sections: ${missingSections.join(", ")}`);
  }
  if (!parsed.body.includes("## Recommendation") && !parsed.body.includes("## Resolution")) {
    errors.push("body missing ## Recommendation or ## Resolution");
  }

  if (errors.length > 0 || !isIssueState(stateValue) || !isGithubIssueStatus(githubIssueStatusValue)) {
    return { record: null, errors };
  }
  return {
    record: {
      path: "",
      relativePath: "",
      issueId,
      title,
      state: stateValue,
      githubIssueStatus: githubIssueStatusValue,
      type: typeValue && isIssueType(typeValue) ? typeValue : null,
      group,
      labels,
      dependsOn,
      blocks,
      priority: priorityValue && isIssuePriority(priorityValue) ? priorityValue : null,
      owner,
      source,
      sections: REQUIRED_SECTIONS.filter((section) => parsed.body.includes(section)),
    },
    errors,
  };
};

const listIssueFiles = async (changeDir: string, includeClosed: boolean): Promise<IssueFileEntry[]> => {
  const issuesDir = join(changeDir, "issues");
  if (!existsSync(issuesDir)) {
    return [];
  }
  const files: IssueFileEntry[] = [];
  for await (const file of walk(issuesDir)) {
    if (!file.endsWith(".md")) {
      continue;
    }
    const relativeToIssues = relative(issuesDir, file);
    const [firstSegment] = relativeToIssues.split(/[\\/]/u);
    if (!includeClosed && firstSegment === "closed") {
      continue;
    }
    const filename = basename(file);
    if (!ISSUE_FILE_RE.test(filename)) {
      continue;
    }
    files.push({
      path: file,
      relativePath: relative(changeDir, file),
      issueId: issueIdFromFilename(filename),
      filename,
    });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

export const collectIssueIds = async (changeDir: string, includeClosed = true): Promise<Set<string>> => {
  const ids = new Set<string>();
  for (const entry of await listIssueFiles(changeDir, includeClosed)) {
    if (entry.issueId) {
      ids.add(entry.issueId);
    }
  }
  return ids;
};

const collectIssueIdCounts = async (changeDir: string): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const entry of await listIssueFiles(changeDir, true)) {
    if (!entry.issueId) {
      continue;
    }
    counts.set(entry.issueId, (counts.get(entry.issueId) ?? 0) + 1);
  }
  return counts;
};

const dependencyCycleErrors = (records: IssueRecord[]): Map<string, string[]> => {
  const activeIds = new Set(records.map((record) => record.issueId));
  const edges = new Map<string, string[]>(
    records.map((record) => [record.issueId, record.dependsOn.filter((dependency) => activeIds.has(dependency))]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const errors = new Map<string, string[]>();

  const pushError = (issueId: string, message: string): void => {
    const existing = errors.get(issueId) ?? [];
    existing.push(message);
    errors.set(issueId, existing);
  };

  const visit = (issueId: string, stack: string[]): void => {
    if (visited.has(issueId)) {
      return;
    }
    const cycleStart = stack.indexOf(issueId);
    if (cycleStart >= 0) {
      const cycle = [...stack.slice(cycleStart), issueId];
      const message = `dependency cycle detected: ${cycle.join(" -> ")}`;
      for (const cycleIssueId of unique(cycle)) {
        pushError(cycleIssueId, message);
      }
      return;
    }
    if (visiting.has(issueId)) {
      return;
    }
    visiting.add(issueId);
    for (const dependency of edges.get(issueId) ?? []) {
      visit(dependency, [...stack, issueId]);
    }
    visiting.delete(issueId);
    visited.add(issueId);
  };

  for (const issueId of edges.keys()) {
    visit(issueId, []);
  }
  return errors;
};

/**
 * Discover and validate every active issue file under `<changeDir>/issues/`.
 * Closed issues under `issues/closed/` are ignored for active convergence but
 * remain valid dependency targets.
 */
export const collectIssues = async (changeDir: string): Promise<IssueRecord[]> => {
  const knownIssueIds = await collectIssueIds(changeDir, true);
  const records: IssueRecord[] = [];
  for (const entry of await listIssueFiles(changeDir, false)) {
    const text = await Bun.file(entry.path).text();
    const { record } = validateIssueFile(text, entry.filename, knownIssueIds);
    if (record) {
      records.push({ ...record, path: entry.path, relativePath: entry.relativePath });
    }
  }
  return records.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

/** Scan active issue files and return per-file validation results. */
export const validateIssues = async (changeDir: string): Promise<IssueValidationResult[]> => {
  const knownIssueIds = await collectIssueIds(changeDir, true);
  const issueIdCounts = await collectIssueIdCounts(changeDir);
  const results: IssueValidationResult[] = [];
  const validRecords: IssueRecord[] = [];

  for (const entry of await listIssueFiles(changeDir, false)) {
    const text = await Bun.file(entry.path).text();
    const validation = validateIssueFile(text, entry.filename, knownIssueIds);
    const errors = [...validation.errors];
    if (entry.issueId && (issueIdCounts.get(entry.issueId) ?? 0) > 1) {
      errors.push(`issue id duplicates another active or closed issue: ${entry.issueId}`);
    }
    if (validation.record) {
      validRecords.push({ ...validation.record, path: entry.path, relativePath: entry.relativePath });
    }
    results.push({ file: entry.path, relativePath: entry.relativePath, issueId: entry.issueId, errors });
  }

  const graphErrors = dependencyCycleErrors(validRecords);
  if (graphErrors.size > 0) {
    for (const result of results) {
      if (!result.issueId) {
        continue;
      }
      result.errors.push(...(graphErrors.get(result.issueId) ?? []));
    }
  }
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};
