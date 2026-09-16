#!/usr/bin/env node
// Orthogonal intents (2026-09-17; original user request: Codex R4 P0-6 + R5 P0-5 + R6 P1-2/P1-3 —
// the SSOT consistency gate must be executable, semantic, structured, cross-platform, and tested):
// 1. Forbid retired deferred-protocol/frame names in active add-ext-dialog/add-ext-sound artifacts
//    (allowlist applies ONLY to these historical-name rules).
// 2. Forbid semantic contradictions strictly (no allowlist): poll-carried terminals, pre-Accept
//    terminal wording, the retired event barrier as a claim, dry-run-as-release-evidence, the
//    impossible identity order, and fictional two-session scenarios.
// 3. Keep the gate runnable via `bun run verify:spec-consistency` and covered by fixture tests.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CHANGES = ["openspec/changes/add-ext-dialog", "openspec/changes/add-ext-sound"];
// Only normative artifacts are scanned; review/ holds review history and is exempt.
const SCANNED_FILES = new Set(["plan.md", "tasks.md", "spec.md", "design-reference.md"]);

// Historical-name rules: a line is exempt when it explicitly marks the term as negative/historical.
export const ALLOW_MARKERS = [
  "禁止",
  "不得出现",
  "负面",
  "残留",
  "作废",
  "retired",
  "forbidden",
  "历史引用",
  "移除",
  "不承诺",
  "forbidding",
];

/** [ruleId, pattern, kind] — kind "name" honors the allowlist; kind "semantic" never does. */
export const RULES = [
  ["retired-frame-completed", /ExtCommandCompleted/, "name"],
  ["retired-frame-cancelled", /ExtCommandCancelled/, "name"],
  ["retired-sync-backend", /readonly backend/, "name"],
  ["retired-sync-backend-dot", /dialog\.backend/, "name"],
  ["retired-sync-backend-dot", /sound\.backend/, "name"],
  ["retired-event-barrier", /terminal-before-event barrier/, "semantic"],
  ["retired-dry-run-evidence", /release dry-run/, "semantic"],
  ["impossible-identity-order", /broker 在 `Library::new` 前重验/, "semantic"],
  ["impossible-identity-order", /before `Library::new`/, "semantic"],
  ["fictional-two-session", /two sessions stay isolated/, "semantic"],
  ["fictional-two-session", /A\/B 会话交错/, "semantic"],
  // Semantic contradictions (R5 P0-2/P0-3): poll must never carry terminals;
  // pre-Accept failures are synchronous requestId errors, never terminal frames.
  ["poll-terminal-channel", /Done\(terminal\)/, "semantic"],
  ["poll-terminal-channel", /Done \| Pending/, "semantic"],
  ["preaccept-terminal", /presentation_failed` terminal/, "semantic"],
  ["preaccept-terminal", /presentation_failed 终帧/, "semantic"],
  ["preaccept-terminal", /producing a typed `dialog_presentation_failed` terminal/, "semantic"],
];

/** Check one document; returns violation strings (relative path prefix applied by caller). */
export const checkDocument = (relativePath, content) => {
  const violations = [];
  content.split("\n").forEach((line, i) => {
    const marked = ALLOW_MARKERS.some((m) => line.includes(m));
    for (const [ruleId, pattern, kind] of RULES) {
      if (kind === "name" && marked) continue;
      if (pattern.test(line)) {
        violations.push(
          `${relativePath}:${i + 1} [${ruleId}] ${pattern.source} → ${line.trim()}`
        );
      }
    }
  });
  return violations;
};

const collect = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "review" || entry === ".git") continue;
      out.push(...collect(full));
    } else if (SCANNED_FILES.has(entry)) {
      out.push(full);
    }
  }
  return out;
};

const runOnRepo = () => {
  const violations = [];
  for (const change of CHANGES) {
    for (const file of collect(join(ROOT, change))) {
      violations.push(
        ...checkDocument(file.slice(ROOT.length), readFileSync(file, "utf8"))
      );
    }
  }
  return violations;
};

export const main = () => {
  const violations = runOnRepo();
  if (violations.length > 0) {
    console.error(`consistency gate FAILED (${violations.length} violation(s)):`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(
    "consistency gate OK: no retired protocol text or semantic contradiction in active dialog/sound artifacts"
  );
};

// URL-safe entry detection: comparing raw `file://${argv[1]}` breaks on Windows drive paths.
if (pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
