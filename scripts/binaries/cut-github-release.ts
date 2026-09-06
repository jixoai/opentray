#!/usr/bin/env bun
/*
Orthogonal intents (maintained 2026-09-06; original user request 2026-09-06
Asia/Shanghai: 把没有好好配置 github-releases 的仓库 CI/CD 升级为自动发布,
让 jixoai.com 能显示版本号):
1. Cut ONE GitHub Release per published OpenTray version. The tag follows
   the `changeset tag` convention (`opentray@<version>`); the notes are
   assembled verbatim from the changesets-generated `## <version>` sections
   of the package changelogs under packages/ (dependency-bump-only sections
   are omitted — they carry no reader-facing change).
2. Bootstrap-safe by design: an existing release for the same tag makes the
   run a no-op (exit 0), so the post-publish job and the manual
   "release current version" dispatch can both re-run freely.
3. Callers: the Release workflow (post-publish job + workflow_dispatch
   bootstrap job) and local bootstrap runs. `gh` must be authenticated in
   the environment; on proxy-bound dev machines run it with the proxy
   env vars unset (the proxy kills the GitHub API handshake).
*/
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

interface CliOptions {
  root: string;
  version?: string;
  target?: string;
  repo?: string;
  dryRun: boolean;
}

function parseCliOptions(): CliOptions {
  const { values } = parseArgs({
    options: {
      root: { type: "string", default: process.cwd() },
      version: { type: "string" },
      target: { type: "string" },
      repo: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  return {
    root: values.root ?? process.cwd(),
    version: values.version,
    target: values.target,
    repo: values.repo,
    dryRun: values["dry-run"] === true,
  };
}

/** The driver package of the fixed version family: its version IS the
 * platform version (`.changeset/config.json` fixes every published name to
 * move together). */
function resolveVersion(root: string): string {
  const manifestPath = join(root, "packages/cli/package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`cannot resolve version: ${manifestPath} is missing`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: string };
  if (!manifest.version) {
    throw new Error(`packages/cli/package.json carries no version`);
  }
  return manifest.version;
}

/** The `## <version>` slice of a changesets-generated changelog, verbatim. */
function extractChangelogSection(changelogPath: string, version: string): string | undefined {
  if (!existsSync(changelogPath)) {
    return undefined;
  }
  const changelog = readFileSync(changelogPath, "utf8");
  const start = changelog.indexOf(`\n## ${version}\n`);
  if (start === -1) {
    return undefined;
  }
  const bodyStart = start + `\n## ${version}\n`.length;
  let end = changelog.indexOf("\n## ", bodyStart);
  if (end === -1) {
    end = changelog.length;
  }
  return changelog.slice(bodyStart, end).trim();
}

/** A section whose remaining lines are only sub-headers, blank lines, and
 * dependency-pointer bullets (`- @scope/pkg@1.2.3`) has no reader-facing
 * change — the fixed family rides along on every bump, so those sections
 * would be pure noise in release notes. */
function sectionHasContent(section: string): boolean {
  const dependencyBullet = /^[-*] (?:@[\w^~-][\w./-]*@|[\w^~-][\w./-]*@)\d+[.\d]*$/;
  const nestedDependencyLine = /^\s+- (?:@[\w^~-][\w./-]*@|[\w^~-][\w./-]*@)\d+[.\d]*$/;
  for (const rawLine of section.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") continue;
    if (line.startsWith("### ")) continue;
    if (dependencyBullet.test(line.trim()) || nestedDependencyLine.test(line)) continue;
    return true;
  }
  return false;
}

interface PackageSection {
  name: string;
  body: string;
}

function collectReleaseSections(root: string, version: string): PackageSection[] {
  const packagesDir = join(root, "packages");
  const sections: PackageSection[] = [];
  // Deterministic order: the SDK package first, then the rest sorted, so
  // notes are byte-stable across runs and machines.
  const order = ["cli", ...readdirSorted(packagesDir).filter((dir) => dir !== "cli")];
  for (const dir of order) {
    const manifestPath = join(packagesDir, dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
      private?: boolean;
    };
    if (!manifest.name || manifest.private) continue;
    const section = extractChangelogSection(join(packagesDir, dir, "CHANGELOG.md"), version);
    if (!section || !sectionHasContent(section)) continue;
    sections.push({ name: manifest.name, body: section });
  }
  return sections;
}

function readdirSorted(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function resolveRepo(options: CliOptions): string {
  if (options.repo) return options.repo;
  const remote = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: options.root,
    encoding: "utf8",
  });
  const url = remote.stdout?.trim() ?? "";
  const match = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error("cannot derive owner/repo from the origin remote — pass --repo");
  }
  return match[1];
}

function composeNotes(version: string, sections: PackageSection[]): string {
  const lines: string[] = [
    `Changesets for the \`${version}\` release of the fixed OpenTray package family.`,
    `Sections below are the changesets-generated changelog entries with reader-facing changes;`,
    `dependency-bump-only sections are omitted.`,
    ``,
  ];
  for (const section of sections) {
    lines.push(`## ${section.name}`, ``, section.body, ``);
  }
  lines.push(
    `---`,
    ``,
    `- npm: https://www.npmjs.com/package/opentray/v/${version}`,
    `- Full changelogs: \`packages/cli/CHANGELOG.md\`, \`packages/create/CHANGELOG.md\``,
  );
  return lines.join("\n");
}

function gh(args: string[], options: CliOptions): { status: number | null; stdout: string; stderr: string } {
  const prefixed = options.repo ? ["-R", options.repo, ...args] : args;
  const result = spawnSync("gh", prefixed, { encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function main(): void {
  const options = parseCliOptions();
  const version = options.version ?? resolveVersion(options.root);
  const tag = `opentray@${version}`;
  const repo = resolveRepo(options);

  const existing = gh(["release", "view", tag], options);
  if (existing.status === 0) {
    const url = existing.stdout.split("\n").find((line) => line.startsWith("url:"));
    console.log(`cut-github-release: ${tag} already exists on ${repo} — skipping (${url ?? "no url line"})`);
    return;
  }

  const sections = collectReleaseSections(options.root, version);
  if (sections.length === 0) {
    throw new Error(`no changelog content found for ${version} — refusing to cut an empty release`);
  }
  const notes = composeNotes(version, sections);

  if (options.dryRun) {
    console.log(`cut-github-release: DRY RUN — would create ${tag} on ${repo}`);
    if (options.target) console.log(`target: ${options.target}`);
    console.log("--- notes ---");
    console.log(notes);
    return;
  }

  const notesFile = `${tag}.md`;
  writeFileSync(join(options.root, notesFile), `${notes}\n`);
  const args = ["release", "create", tag, "--title", tag, "--notes-file", notesFile];
  if (options.target) {
    args.push("--target", options.target);
  }
  const created = gh(args, options);
  if (created.status !== 0) {
    process.stderr.write(created.stderr);
    throw new Error(`gh release create failed for ${tag}`);
  }
  process.stdout.write(created.stdout);
  console.log(`cut-github-release: created ${tag} on ${repo}`);
}

main();
