#!/usr/bin/env bun
import { parseArgs } from "node:util";

import {
  normalizeArch,
  platformToPackageOs,
  resolveNativePackageTarget,
  resolveNativeTarget,
  stageArtifact,
} from "./artifacts";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    kind: {
      type: "string",
      default: "daemon",
    },
    source: {
      type: "string",
    },
    root: {
      type: "string",
      default: process.cwd(),
    },
    "package-os": {
      type: "string",
    },
    arch: {
      type: "string",
    },
  },
});

if (values.source === undefined || values.source.length === 0) {
  throw new Error("--source is required");
}
if (values.kind !== "daemon" && values.kind !== "webview") {
  throw new Error("--kind must be daemon or webview");
}
if ((values["package-os"] === undefined) !== (values.arch === undefined)) {
  throw new Error("--package-os and --arch must be provided together");
}

const target =
  values["package-os"] === undefined
    ? resolveNativeTarget()
    : resolveNativePackageTarget(
        platformToPackageOs(values["package-os"]),
        normalizeArch(values.arch),
      );
const destination = values.kind === "daemon" ? target.daemonArtifact : target.webviewArtifact;
await stageArtifact(values.root ?? process.cwd(), values.source, destination);
console.log(`staged ${values.kind} artifact: ${destination}`);
