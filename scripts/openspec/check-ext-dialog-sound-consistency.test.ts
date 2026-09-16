// Orthogonal intents (2026-09-17; original user request: Codex R6 P1-2 - gate self-test, three arms):
// 1. Legitimate negative/historical references are exempt for name rules.
// 2. A disguised marker must NOT exempt a semantic contradiction (strict rules).
// 3. Every ruleId fires on a matching sample and the real repo scan stays clean.

import { describe, expect, test } from "bun:test";
import {
  checkDocument,
  RULES,
  type ConsistencyRule,
} from "./check-ext-dialog-sound-consistency.ts";

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

  test("arm 3: every unique ruleId fires on a matching sample (name + semantic)", () => {
    // One unmarked sample per unique ruleId (name rules need a bare mention; semantic rules
    // are strict). Asserting the fired set equals the unique ruleId set proves full coverage.
    const samples: Record<string, string> = {
      "retired-frame-completed": "ExtCommandCompleted 出现在规范文本",
      "retired-frame-cancelled": "ExtCommandCancelled 出现在规范文本",
      "retired-sync-backend": "readonly backend 属性",
      "retired-sync-backend-dot": "dialog.backend 快照",
      "retired-event-barrier": "terminal-before-event barrier 被承诺",
      "retired-dry-run-evidence": "release dry-run 作为证据",
      "impossible-identity-order": "the broker verifies it before `Library::new`",
      "fictional-two-session": "two sessions stay isolated",
      "poll-terminal-channel": "Done(terminal)",
      "preaccept-terminal": "typed `dialog_presentation_failed` terminal",
    };
    const fired = new Set<string>();
    for (const line of Object.values(samples)) {
      for (const v of checkDocument("sample.md", `${line}\n`)) {
        const m = /\[([a-z-]+)\]/.exec(v);
        if (m) fired.add(m[1]);
      }
    }
    const uniqueIds = new Set(RULES.map(([id]) => id));
    expect([...uniqueIds].every((id) => fired.has(id)), `all ruleIds must fire; missing: ${[...uniqueIds].filter((id) => !fired.has(id)).join(",")}`).toBe(true);
    // "Done | Pending" shares a ruleId with Done(terminal) — covered via the shared id above.
  });

  test("arm 3b: name rules without a marker hit, with a marker pass", () => {
    expect(checkDocument("s.md", "ExtCommandCancelled\n")[0]).toContain("retired-frame-cancelled");
    expect(checkDocument("s.md", "ExtCommandCancelled（移除）\n")).toEqual([]);
  });

  test("unknown-tag guard: rule table stays non-empty and structured", () => {
    const rules: readonly ConsistencyRule[] = RULES;
    expect(rules.length).toBeGreaterThan(10);
    for (const [id, , kind] of rules) {
      expect(typeof id).toBe("string");
      expect(["name", "semantic"]).toContain(kind);
    }
  });
});
