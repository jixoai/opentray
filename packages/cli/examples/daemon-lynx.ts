import { runDaemonLynxSmoke } from "../src/smoke/daemon-lynx";

const argv = process.argv.slice(2);
const bundleFlag = argv.findIndex((value) => value === "--bundle");
const bundlePath = bundleFlag >= 0 ? argv[bundleFlag + 1] : undefined;

await runDaemonLynxSmoke(bundlePath === undefined ? {} : { bundlePath });
