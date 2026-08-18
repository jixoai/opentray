// Orthogonal intents (maintained 2026-07-22; original user request: the wizard
// runs the user's start command once and derives identity from it):
// 1. Split a command line into an argv without invoking a shell.
// 2. Preserve quoting and escaping semantics for POSIX-like input.
// 3. Report unbalanced quotes instead of silently dropping tokens.
//
// Implementation: shell-quote's `parse` (battle-tested POSIX tokenizer) with a
// thin adapter that keeps this module's typed result surface. shell-quote
// returns special token objects for `$(...)`/`<`/`>` constructs — a wizard
// command must never contain those, so they surface as typed errors instead
// of being silently flattened into strings.

import { parse } from "shell-quote";

export interface TokenizeResult {
  readonly ok: boolean;
  readonly tokens: readonly string[];
  readonly error: string | undefined;
}

/**
 * Shell-style tokenizer for the wizard command input (shell-quote under the
 * hood). Supports single quotes, double quotes, backslash escapes, and
 * adjacent segments (`a"b c"d` → `["ab cd"]`). It never executes anything;
 * it only produces the argv that will be spawned.
 */
export const tokenizeCommandLine = (input: string): TokenizeResult => {
  // shell-quote tolerates unbalanced quotes; the wizard's input contract is
  // stricter — surface them before parse (an unterminated quote almost always
  // means the user is mid-edit).
  if (/["']/.test(input)) {
    const single = (input.match(/'/gu) ?? []).length;
    const double = (input.match(/"/gu) ?? []).length;
    if (single % 2 === 1) {
      return { ok: false, tokens: [], error: "unbalanced single quote in command" };
    }
    if (double % 2 === 1) {
      return { ok: false, tokens: [], error: "unbalanced double quote in command" };
    }
  }
  const parsed = parse(input);
  const tokens: string[] = [];
  for (const node of parsed) {
    if (typeof node !== "string") {
      // Command substitution / redirection operators: meaningless for a
      // spawn vector and dangerous to reinterpret — reject explicitly.
      const op = "op" in node ? node.op : "pattern" in node ? node.pattern : "command";
      return {
        ok: false,
        tokens: [],
        error: `command contains a shell operator token (${String(op)}); pass it as a quoted argument instead`,
      };
    }
    tokens.push(node);
  }
  if (tokens.length === 0) {
    return { ok: false, tokens: [], error: "command is empty" };
  }
  return { ok: true, tokens, error: undefined };
};
