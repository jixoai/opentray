import { describe, expect, it } from "vitest";

import { tokenizeCommandLine } from "./tokenize";

describe("tokenizeCommandLine", () => {
  it("splits on whitespace", () => {
    const result = tokenizeCommandLine("npx somecommand start --xx");
    expect(result).toEqual({
      ok: true,
      tokens: ["npx", "somecommand", "start", "--xx"],
      error: undefined,
    });
  });

  it("preserves quoted segments as one token", () => {
    const result = tokenizeCommandLine('npx tool --message "hello world" end');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual(["npx", "tool", "--message", "hello world", "end"]);
  });

  it("supports single quotes", () => {
    const result = tokenizeCommandLine("echo 'a b c'");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual(["echo", "a b c"]);
  });

  it("supports backslash escapes outside quotes", () => {
    const result = tokenizeCommandLine("echo a\\ b");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toEqual(["echo", "a b"]);
  });

  it("rejects unbalanced quotes", () => {
    expect(tokenizeCommandLine('echo "unclosed').ok).toBe(false);
    expect(tokenizeCommandLine("echo 'unclosed").ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(tokenizeCommandLine("   ").ok).toBe(false);
  });
});
