import { runDaemonLynxSmoke } from "./_support/daemon-lynx-support";

const argv = process.argv.slice(2);
const bundleFlag = argv.findIndex((value) => value === "--bundle");
const bundlePath = bundleFlag >= 0 ? argv[bundleFlag + 1] : undefined;
const featuresFlag = argv.findIndex((value) => value === "--features");
const featureExpression = featuresFlag >= 0 ? argv[featuresFlag + 1] : undefined;

await runDaemonLynxSmoke({
  ...(bundlePath === undefined ? {} : { bundlePath }),
  ...(featureExpression === undefined ? {} : { featureExpression }),
});
