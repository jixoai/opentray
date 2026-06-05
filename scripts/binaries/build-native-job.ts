#!/usr/bin/env bun
import { parseArgs } from "node:util";

import {
  executeNativeBuildExecution,
  isNativeBuildComponent,
  materializeNativeBuildExecutions,
  parseNativeBuildTargetName,
  type NativeBuildComponent,
} from "./native-build-graph";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    root: {
      type: "string",
      default: process.cwd(),
    },
    target: {
      type: "string",
    },
    components: {
      type: "string",
    },
    "output-dir": {
      type: "string",
    },
  },
});

if (values.target === undefined || values.target.trim().length === 0) {
  throw new Error("--target is required");
}
if (values.components === undefined || values.components.trim().length === 0) {
  throw new Error("--components is required");
}
if (values["output-dir"] === undefined || values["output-dir"].trim().length === 0) {
  throw new Error("--output-dir is required");
}

const components = values.components
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
if (components.length === 0) {
  throw new Error("--components must contain at least one native build component");
}
if (components.some((value) => !isNativeBuildComponent(value))) {
  throw new Error(`--components contains unsupported native build component: ${values.components}`);
}

const execution = materializeNativeBuildExecutions(
  components as NativeBuildComponent[],
  [parseNativeBuildTargetName(values.target)],
)[0];
const manifest = await executeNativeBuildExecution(
  values.root ?? process.cwd(),
  execution,
  values["output-dir"].trim(),
);
console.log(JSON.stringify(manifest, null, 2));
