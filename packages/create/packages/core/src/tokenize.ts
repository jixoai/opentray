// Orthogonal intents (maintained 2026-07-22; original user request: the wizard
// runs the user's start command once and derives identity from it):
// 1. Split a command line into an argv without invoking a shell.
// 2. Preserve quoting and escaping semantics for POSIX-like input.
// 3. Report unbalanced quotes instead of silently dropping tokens.

export interface TokenizeResult {
  readonly ok: boolean;
  readonly tokens: readonly string[];
  readonly error: string | undefined;
}

/**
 * Shell-style tokenizer for the wizard command input. Supports single quotes,
 * double quotes, and backslash escapes outside quotes. It never executes
 * anything; it only produces the argv that will be spawned.
 */
export const tokenizeCommandLine = (input: string): TokenizeResult => {
  const tokens: string[] = [];
  let current = "";
  let hasCurrent = false;
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === undefined) {
      break;
    }

    if (isWhitespace(char)) {
      if (hasCurrent) {
        tokens.push(current);
        current = "";
        hasCurrent = false;
      }
      index += 1;
      continue;
    }

    if (char === '"') {
      const quoted = readQuoted(input, index, '"');
      if (quoted === undefined) {
        return { ok: false, tokens: [], error: "unbalanced double quote in command" };
      }
      current += quoted.value;
      hasCurrent = true;
      index = quoted.nextIndex;
      continue;
    }

    if (char === "'") {
      const quoted = readQuoted(input, index, "'");
      if (quoted === undefined) {
        return { ok: false, tokens: [], error: "unbalanced single quote in command" };
      }
      current += quoted.value;
      hasCurrent = true;
      index = quoted.nextIndex;
      continue;
    }

    if (char === "\\" && index + 1 < input.length) {
      const next = input[index + 1];
      if (next !== undefined) {
        current += next;
        hasCurrent = true;
        index += 2;
        continue;
      }
    }

    current += char;
    hasCurrent = true;
    index += 1;
  }

  if (hasCurrent) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    return { ok: false, tokens: [], error: "command is empty" };
  }
  return { ok: true, tokens, error: undefined };
};

const readQuoted = (
  input: string,
  start: number,
  quote: '"' | "'",
): { value: string; nextIndex: number } | undefined => {
  let value = "";
  let index = start + 1;
  while (index < input.length) {
    const char = input[index];
    if (char === undefined) {
      break;
    }
    if (char === quote) {
      return { value, nextIndex: index + 1 };
    }
    if (quote === '"' && char === "\\" && index + 1 < input.length) {
      const next = input[index + 1];
      if (next !== undefined && (next === '"' || next === "\\")) {
        value += next;
        index += 2;
        continue;
      }
    }
    value += char;
    index += 1;
  }
  return undefined;
};

const isWhitespace = (char: string): boolean =>
  char === " " || char === "\t" || char === "\n" || char === "\r";
