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
if (!["daemon", "webview", "lynx", "lynx-runtime"].includes(values.kind)) {
  throw new Error("--kind must be daemon, webview, lynx, or lynx-runtime");
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
const destination = resolveStageDestination(target, values.kind);
await stageArtifact(values.root ?? process.cwd(), values.source, destination);
console.log(`staged ${values.kind} artifact: ${destination}`);

function resolveStageDestination(
  target: ReturnType<typeof resolveNativeTarget>,
  kind: string,
): string {
  switch (kind) {
    case "daemon":
      return target.daemonArtifact;
    case "webview":
      return target.webviewArtifact;
    case "lynx":
      if (target.lynxArtifact === undefined) {
        throw new Error(`target ${target.packageOs}-${target.arch} does not publish a lynx dylib`);
      }
      return target.lynxArtifact;
    case "lynx-runtime":
      if (target.lynxRuntimeArtifact === undefined) {
        throw new Error(`target ${target.packageOs}-${target.arch} does not publish a lynx runtime`);
      }
      return target.lynxRuntimeArtifact;
    default:
      throw new Error(`unsupported stage kind: ${kind}`);
  }
}
