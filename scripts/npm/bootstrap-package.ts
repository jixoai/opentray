#!/usr/bin/env bun

export {
  classifyRegistryResult,
  createPackageManifest,
  defaultPackageDir,
  parseArgs,
  redact,
  trustMatches,
} from "./bootstrap-package/index";
import { bootstrapPackage, parseArgs } from "./bootstrap-package/index";

const main = async (): Promise<void> => {
  try {
    const options = parseArgs(Bun.argv.slice(2));
    const report = await bootstrapPackage(options);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

if (import.meta.main) {
  await main();
}
