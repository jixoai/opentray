#!/usr/bin/env bun
import { parseArgs } from "node:util";

import {
  extractChangesetReleasePackages,
  readOptionalWorkspaceFile,
} from "./changeset-files";
import {
  type PreviewBuildFamily,
  type PreviewTargetName,
  inferPreviewFamiliesFromReleasePackages,
  isPreviewBuildFamily,
  materializePreviewBuildJobs,
  parsePreviewTargetName,
  resolvePreviewTargetsForFamilies,
} from "./preview-families";

export interface PreviewBuildMarker {
  readonly alias: string;
  readonly families?: readonly PreviewBuildFamily[];
  readonly targets?: readonly PreviewTargetName[];
  readonly smokes?: readonly string[];
}

export interface PreviewBuildPlan {
  readonly enabled: boolean;
  readonly source: "changeset" | "manual";
  readonly alias?: string;
  readonly selectedChangeset?: string;
  readonly changedFiles: readonly string[];
  readonly families: readonly PreviewBuildFamily[];
  readonly targets: readonly PreviewTargetName[];
  readonly smokes: readonly string[];
  readonly jobs: ReturnType<typeof materializePreviewBuildJobs>;
  readonly reason?: string;
}

interface ResolvePreviewBuildPlanOptions {
  readonly root?: string;
  readonly changedFiles?: readonly string[];
  readonly manualAlias?: string;
  readonly manualFamilies?: readonly PreviewBuildFamily[];
  readonly manualTargets?: readonly PreviewTargetName[];
  readonly manualSmokes?: readonly string[];
}

const MARKER_NAME = "opentray-preview";

export async function resolvePreviewBuildPlan(
  options: ResolvePreviewBuildPlanOptions = {},
): Promise<PreviewBuildPlan> {
  const root = options.root ?? process.cwd();
  const changedFiles = normalizeChangedFiles(options.changedFiles);

  if (options.manualAlias !== undefined) {
    const families = normalizeFamilies(options.manualFamilies);
    if (families.length === 0) {
      throw new Error("manual preview build requires at least one family");
    }
    const targets = resolvePreviewTargetsForFamilies(families, options.manualTargets);
    return {
      enabled: true,
      source: "manual",
      alias: options.manualAlias,
      changedFiles,
      families,
      targets,
      smokes: [...new Set(options.manualSmokes ?? [])],
      jobs: materializePreviewBuildJobs(options.manualAlias, families, targets),
    };
  }

  if (changedFiles.length === 0) {
    return {
      enabled: false,
      source: "changeset",
      changedFiles,
      families: [],
      targets: [],
      smokes: [],
      jobs: [],
      reason: "no changed changeset files",
    };
  }

  const selectedChangesets: {
    readonly path: string;
    readonly marker: PreviewBuildMarker;
    readonly releasePackages: readonly string[];
  }[] = [];

  for (const relativePath of changedFiles) {
    if (!relativePath.endsWith(".md")) {
      continue;
    }
    const content = await readOptionalWorkspaceFile(root, relativePath);
    if (content === undefined) {
      continue;
    }
    const marker = parsePreviewBuildMarker(content);
    if (marker === undefined) {
      continue;
    }
    selectedChangesets.push({
      path: relativePath,
      marker,
      releasePackages: extractChangesetReleasePackages(content),
    });
  }

  if (selectedChangesets.length === 0) {
    return {
      enabled: false,
      source: "changeset",
      changedFiles,
      families: [],
      targets: [],
      smokes: [],
      jobs: [],
      reason: `no changed changeset contained ${MARKER_NAME} marker`,
    };
  }

  if (selectedChangesets.length > 1) {
    throw new Error(
      `multiple changed changesets requested preview builds: ${selectedChangesets
        .map((entry) => entry.path)
        .join(", ")}`,
    );
  }

  const selected = selectedChangesets[0];
  const inferredFamilies =
    selected.marker.families !== undefined && selected.marker.families.length > 0
      ? [...selected.marker.families]
      : inferPreviewFamiliesFromReleasePackages(selected.releasePackages);
  const families = normalizeFamilies(inferredFamilies);
  if (families.length === 0) {
    throw new Error(
      `could not infer preview build family from ${selected.path}; add explicit families to ${MARKER_NAME} marker`,
    );
  }
  const targets = resolvePreviewTargetsForFamilies(families, selected.marker.targets);

  return {
    enabled: true,
    source: "changeset",
    alias: selected.marker.alias,
    selectedChangeset: selected.path,
    changedFiles,
    families,
    targets,
    smokes: [...new Set(selected.marker.smokes ?? [])],
    jobs: materializePreviewBuildJobs(selected.marker.alias, families, targets),
  };
}

export function parsePreviewBuildMarker(content: string): PreviewBuildMarker | undefined {
  const match = content.match(/<!--\s*opentray-preview\s*([\s\S]*?)-->/u);
  if (match === null) {
    return undefined;
  }
  const raw = match[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid ${MARKER_NAME} marker JSON: ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${MARKER_NAME} marker must be a JSON object`);
  }
  const alias = parsed.alias;
  if (typeof alias !== "string" || alias.trim().length === 0) {
    throw new Error(`${MARKER_NAME} marker requires non-empty string alias`);
  }
  const normalizedAlias = alias.trim();
  if (!/^[A-Za-z0-9._-]+$/u.test(normalizedAlias)) {
    throw new Error(`${MARKER_NAME} marker alias must match [A-Za-z0-9._-]+`);
  }

  return {
    alias: normalizedAlias,
    families: parseFamilyList(parsed.families),
    targets: parseTargetList(parsed.targets),
    smokes: parseStringList(parsed.smokes, "smokes"),
  };
}
const normalizeChangedFiles = (
  changedFiles: readonly string[] | undefined,
): string[] => [...new Set((changedFiles ?? []).map((value) => value.trim()).filter((value) => value.length > 0))];

const normalizeFamilies = (
  families: readonly PreviewBuildFamily[] | undefined,
): PreviewBuildFamily[] => {
  const normalized = new Set<PreviewBuildFamily>();
  for (const family of families ?? []) {
    normalized.add(family);
  }
  return [...normalized];
};

const parseFamilyList = (value: unknown): PreviewBuildFamily[] | undefined => {
  const items = parseStringList(value, "families");
  if (items === undefined) {
    return undefined;
  }
  return items.map((item) => {
    if (!isPreviewBuildFamily(item)) {
      throw new Error(`unsupported preview build family in ${MARKER_NAME}: ${item}`);
    }
    return item;
  });
};

const parseTargetList = (value: unknown): PreviewTargetName[] | undefined => {
  const items = parseStringList(value, "targets");
  if (items === undefined) {
    return undefined;
  }
  return items.map((item) => parsePreviewTargetName(item));
};

const parseStringList = (
  value: unknown,
  field: string,
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${MARKER_NAME} marker field ${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: {
      type: "string",
      default: process.cwd(),
    },
    "changed-json": {
      type: "string",
      default: "[]",
    },
    alias: {
      type: "string",
    },
    family: {
      type: "string",
      multiple: true,
    },
    target: {
      type: "string",
      multiple: true,
    },
    smoke: {
      type: "string",
      multiple: true,
    },
  },
});

if (import.meta.main) {
  const changedFiles = parseChangedFilesJson(values["changed-json"]);
  const plan = await resolvePreviewBuildPlan({
    root: values.root,
    changedFiles,
    manualAlias: values.alias,
    manualFamilies: values.family?.map((family) => {
      if (!isPreviewBuildFamily(family)) {
        throw new Error(`unsupported preview build family: ${family}`);
      }
      return family;
    }),
    manualTargets: values.target?.map((target) => parsePreviewTargetName(target)),
    manualSmokes: values.smoke,
  });
  console.log(JSON.stringify(plan, null, 2));
}

function parseChangedFilesJson(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`--changed-json must be valid JSON array: ${message}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("--changed-json must be a JSON array of strings");
  }
  return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
}
