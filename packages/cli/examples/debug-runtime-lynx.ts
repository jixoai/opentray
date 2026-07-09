import { runDebugRuntimeLynxSmoke } from "./_support/debug-runtime-lynx-support";
import {
  prepareExampleBrokerBinary,
  stripExampleRuntimeModeArgs,
} from "./_support/example-runtime-mode";

await prepareExampleBrokerBinary(import.meta.url);

const argv = stripExampleRuntimeModeArgs(process.argv.slice(2));
const bundleFlag = argv.findIndex((value) => value === "--bundle");
const bundlePath = bundleFlag >= 0 ? argv[bundleFlag + 1] : undefined;
const featuresFlag = argv.findIndex((value) => value === "--features");
const featureExpression =
  featuresFlag >= 0 ? argv[featuresFlag + 1] : undefined;

await runDebugRuntimeLynxSmoke({
  ...(bundlePath === undefined ? {} : { bundlePath }),
  ...(featureExpression === undefined ? {} : { featureExpression }),
});
