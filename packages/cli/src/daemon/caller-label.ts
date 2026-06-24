import { basename } from "node:path";

import { sanitizeCallerLabel } from "@opentray/spec";

export interface CallerLabelSources {
  /** Explicit developer-provided label, highest precedence. */
  readonly explicit?: string;
  /** `npm_package_name` environment value. */
  readonly npmPackageName?: string;
  /** Script path resolved from `process.argv[1]` or equivalent. */
  readonly scriptPath?: string;
}

export interface ResolveCallerLabelOptions extends Partial<CallerLabelSources> {
  env?: NodeJS.ProcessEnv;
  argv?: readonly string[];
}

/**
 * Derives a caller label using the precedence: explicit > npm_package_name >
 * script basename > neutral default. The result is always sanitized to a
 * filesystem- and process-safe component, so callers can use it directly in
 * endpoint identity, runtime directories, and process titles.
 */
export const resolveCallerLabel = (options: ResolveCallerLabelOptions = {}): string => {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;

  const candidates: string[] = [];
  if (options.explicit !== undefined && options.explicit.length > 0) {
    candidates.push(options.explicit);
  }
  const npmName = options.npmPackageName ?? env.npm_package_name;
  if (typeof npmName === "string" && npmName.length > 0) {
    candidates.push(npmName);
  }
  const scriptPath = options.scriptPath ?? argv[1];
  if (typeof scriptPath === "string" && scriptPath.length > 0) {
    candidates.push(basename(scriptPath));
  }

  for (const candidate of candidates) {
    const sanitized = sanitizeCallerLabel(candidate);
    if (sanitized.length > 0) {
      return sanitized;
    }
  }

  return sanitizeCallerLabel(undefined);
};
