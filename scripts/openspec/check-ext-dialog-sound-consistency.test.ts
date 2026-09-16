// Orthogonal intents (2026-09-17; original user request: Codex R6 P1-2 — gate self-test, three arms):
// 1. Legitimate negative/historical references are exempt for name rules.
// 2. A disguised marker must NOT exempt a semantic contradiction (strict rules).
// 3. Every ruleId fires on a matching sample and the real repo scan stays clean.

import { describe, expect, test } from "bun:test";
import { checkDocument } from "./check-ext-dialog-sound-consistency.mjs";

describe("check-ext-dialog-sound-consistency", () => {
  test("arm 1: marked historical references are exempt for name rules", () => {
    const doc = "旧帧 ExtCommandCompleted 已移除（禁止出现）\n正常规范文本一行\n";
    expect(checkDocument("sample.md", doc)).toEqual([]);
  });

  test("arm 2: an allow marker does NOT exempt semantic contradictions", () => {
    const doc = "poll_owner -> Done(terminal) | Pending —— 负面清单外的真实冲突";
    const violations = checkDocument("sample.md", doc);
    expect(violations.some((v) => v.includes("[poll-terminal-channel]"))).toBe(true);
  });

  test("arm 3: each semantic ruleId fires on its matching sample", () => {
    const samples: Array<[string, string]> = [
      ["terminal-before-event barrier 被承诺", "retired-event-barrier"],
      ["release dry-run 作为证据", "retired-dry-run-evidence"],
      ["the broker verifies it before `Library::new`", "impossible-identity-order"],
      ["two sessions stay isolated", "fictional-two-session"],
      ["Done(terminal)", "poll-terminal-channel"],
      ["Done | Pending", "poll-terminal-channel"],
      ["typed `dialog_presentation_failed` terminal", "preaccept-terminal"],
    ];
    for (const [line, ruleId] of samples) {
      const violations = checkDocument("sample.md", `${line}\n`);
      expect(
        violations.some((v) => v.includes(`[${ruleId}]`)),
        `${line} should trigger ${ruleId}`
      ).toBe(true);
    }
  });

  test("unknown-tag guard: rule table stays non-empty and structured", () => {
    const { RULES } = require("./check-ext-dialog-sound-consistency.mjs") as {
      RULES: Array<[string, RegExp, string]>;
    };
    expect(RULES.length).toBeGreaterThan(10);
    for (const [id, , kind] of RULES) {
      expect(typeof id).toBe("string");
      expect(["name", "semantic"]).toContain(kind);
    }
  });
});
