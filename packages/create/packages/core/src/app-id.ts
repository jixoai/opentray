// Orthogonal intents (maintained 2026-08-19; original user request: the default
// appId is the command segment before the first Option, reversed and dot-joined;
// 2026-08-19 scoped-package commands must derive like the user reads them —
// `npx @deepseek-ai/dsh@latest web` → `web.dsh.npx`: the `@scope` segment is
// dropped and `name@version` keeps only `name`):
// 1. Derive the default appId from the pre-option tokens of the command.
// 2. Keep the derivation pure so it is testable against the user's example.
// 3. Provide a display-name and directory-safe projection for scaffolding.

/** A token that looks like a command option, e.g. `--xx`, `-p`, or `--port=8080`. */
const isOptionToken = (token: string): boolean => token.startsWith("-") && token.length > 1;

/**
 * Normalize one command token into an appId segment (or nothing).
 * - Scoped packages `@scope/name` split on `/` and DROP the `@scope` lead.
 * - A bare `@scope`-looking segment carries no identity and is dropped.
 * - `name@version` keeps only the name (a version pin is not identity).
 * - Plain paths keep only their last segment.
 */
const tokenToSegment = (token: string): string => {
  const segments = token.split(/[/\\]/).filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment.startsWith("@"))) {
    const unscoped = segments.filter((segment) => !segment.startsWith("@"));
    return (unscoped[unscoped.length - 1] ?? "").split("@")[0] ?? "";
  }
  const last = segments[segments.length - 1] ?? token;
  return last.split("@")[0] ?? "";
};

/**
 * Default appId derivation. `npx somecommand start --xx` keeps the pre-option
 * tokens `["npx", "somecommand", "start"]`, reverses them, and dot-joins:
 * `start.somecommand.npx`. Scoped commands like `npx @deepseek-ai/dsh@latest
 * web` derive `web.dsh.npx`.
 */
export const deriveDefaultAppId = (tokens: readonly string[]): string => {
  const preOption: string[] = [];
  for (const token of tokens) {
    if (isOptionToken(token)) {
      break;
    }
    preOption.push(token);
  }
  const segments = preOption
    .map(tokenToSegment)
    .filter((segment) => segment.length > 0)
    .reverse();
  if (segments.length === 0) {
    return "app.opentray";
  }
  return segments.join(".");
};

/** Human display name from the appId derivation: `Somecommand Start`. */
export const deriveDefaultAppName = (tokens: readonly string[]): string => {
  const appId = deriveDefaultAppId(tokens);
  return appId
    .split(".")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
};

/** Directory-safe project name from an appId (mirrors packaging normalizeAppId semantics). */
export const toProjectDirectoryName = (appId: string): string => {
  const normalized = appId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "opentray-app";
};

/** True when the appId has the shape consumers expect for stable identity. */
export const isValidAppId = (appId: string): boolean => {
  const trimmed = appId.trim();
  return trimmed.length > 0 && /^[a-z0-9]+(\.[a-z0-9-]+)+$/iu.test(trimmed);
};
