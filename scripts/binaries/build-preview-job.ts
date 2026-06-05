#!/usr/bin/env bun
import { parseArgs } from "node:util";

import {
  executePreviewBuildJob,
  isPreviewBuildFamily,
  materializePreviewBuildJobs,
  parsePreviewTargetName,
  type PreviewBuildFamily,
} from "./preview-families";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: {
      type: "string",
      default: process.cwd(),
    },
    alias: {
      type: "string",
    },
    family: {
      type: "string",
    },
    target: {
      type: "string",
    },
    "output-dir": {
      type: "string",
    },
  },
});

if (values.alias === undefined || values.alias.trim().length === 0) {
  throw new Error("--alias is required");
}
if (values.family === undefined || values.family.trim().length === 0) {
  throw new Error("--family is required");
}
if (values.target === undefined || values.target.trim().length === 0) {
  throw new Error("--target is required");
}
if (values["output-dir"] === undefined || values["output-dir"].trim().length === 0) {
  throw new Error("--output-dir is required");
}
if (!isPreviewBuildFamily(values.family)) {
  throw new Error(`unsupported preview build family: ${values.family}`);
}

const job = materializePreviewBuildJobs(
  values.alias.trim(),
  [values.family as PreviewBuildFamily],
  [parsePreviewTargetName(values.target)],
)[0];
const manifest = await executePreviewBuildJob(
  values.root ?? process.cwd(),
  job,
  values["output-dir"].trim(),
);
console.log(JSON.stringify(manifest, null, 2));
