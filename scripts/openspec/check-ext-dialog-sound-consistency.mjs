#!/usr/bin/env node
// Orthogonal intents (2026-09-17; original user request: Codex R4 P0-6 — the SSOT grep gate must be executable and trustworthy):
// 1. Forbid retired deferred-protocol/frame names in active add-ext-dialog/add-ext-sound artifacts.
// 2. Forbid the synchronous backend property, the retired event barrier, and dry-run-as-release-evidence wording.
// 3. Allow negative examples only on lines that explicitly mark them as forbidden/retired/historical.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const CHANGES = ["openspec/changes/add-ext-dialog", "openspec/changes/add-ext-sound"];
// Only normative artifacts are scanned; review/ holds review history and is exempt.
const SCANNED_FILES = new Set(["plan.md", "tasks.md", "spec.md", "design-reference.md"]);
// A line mentioning a retired term is allowed only when it also marks it as negative/historical.
const ALLOW_MARKERS = [
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

const FORBIDDEN = [
  /ExtCommandCompleted/,
  /ExtCommandCancelled/,
  /readonly backend/,
  /dialog\.backend/,
  /sound\.backend/,
  /terminal-before-event barrier/,
  /release dry-run/,
  /broker 在 `Library::new` 前重验/,
  /before `Library::new`/,
  /two sessions stay isolated/,
  /A\/B 会话交错/,
];

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

const violations = [];
for (const change of CHANGES) {
  const dir = join(ROOT, change);
  for (const file of collect(dir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const allowed = ALLOW_MARKERS.some((m) => line.includes(m));
      if (allowed) return;
      for (const pattern of FORBIDDEN) {
        if (pattern.test(line)) {
          violations.push(`${file.replace(ROOT, "")}:${i + 1}: ${pattern} → ${line.trim()}`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`consistency gate FAILED (${violations.length} violation(s)):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log("consistency gate OK: no retired protocol text in active dialog/sound artifacts");
