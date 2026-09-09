// Visual demo (shared-icon-kernel): materialize real .app bundles through the
// packaging seam that broker-command.ensureDarwinBundle drives
// (synthesizeDefaultAppIcon → ensureDarwinAppBundle), with appIcon omitted so
// the glyph default is the only icon source. Run from anywhere:
//   node demos/visual-demo.mjs
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const iconDist = join(root, "packages/icon/dist/index.mjs");
const packagingDist = join(root, "packages/packaging/dist/index.mjs");
const specDist = join(root, "packages/spec/dist/index.mjs");

const { generateDefaultAppIcon, decodeImageFile, encodeImagePng, emptyImageOf, pasteImage, resizeImage } =
  await import(iconDist);
const { ensureDarwinAppBundle } = await import(packagingDist);
const { createBrokerEndpointIdentity } = await import(specDist);

const demoDir = "/tmp/opentray-icon-demo";
await rm(demoDir, { recursive: true, force: true });
await mkdir(demoDir, { recursive: true });

const names = ["Notes", "笔记工具", "DevTool", "5G Watcher"];
const templatePath = join(root, "packages/darwin-app-carrier/Info.plist");
const previews = [];
const runtimeDirOf = (appName) => {
  const identity = createBrokerEndpointIdentity({ packageVersion: "0.21.1", callerLabel: `demo ${appName}` });
  return join(demoDir, "home", ".opentray", identity.packageVersion, identity.callerLabel, "runtime");
};

for (const appName of names) {
  const brokerPath = join(runtimeDirOf(appName), "fake-broker");
  await mkdir(dirname(brokerPath), { recursive: true });
  await writeFile(brokerPath, "#!/bin/sh\nsleep 0\n", "utf8");
  const generated = await generateDefaultAppIcon({
    appName,
    outputDir: join(runtimeDirOf(appName), "app-icon"),
  });
  const executable = await ensureDarwinAppBundle({
    bundlePath: join(demoDir, `${appName}.app`),
    packageName: "opentray-demo",
    appId: `demo.opentray.${appName.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "app"}`,
    appName,
    target: { os: "darwin", arch: "arm64" },
    brokerPath,
    templatePath,
    appIcon: generated.appIcon,
  });
  previews.push({ appName, macOSPngPath: generated.macOSPngPath });
  console.log(`✓ ${appName}.app → ${executable.replace(demoDir + "/", "")}`);
}

// Contact sheet of the macOS variants on an opaque dark backdrop.
const tileSize = 512;
const gap = 64;
const sheet = emptyImageOf(gap + (tileSize + gap) * previews.length, tileSize + gap * 2);
for (let i = 0; i < previews.length; i += 1) {
  const img = await decodeImageFile(previews[i].macOSPngPath);
  const scaled = await resizeImage(img, tileSize, tileSize, "lanczos3");
  pasteImage(sheet, scaled, gap + (tileSize + gap) * i, gap);
}
for (let i = 3; i < sheet.data.length; i += 4) if (sheet.data[i] === 0) sheet.data[i] = 255;
await writeFile(join(demoDir, "contact-sheet.png"), await encodeImagePng(sheet));
console.log("✓ contact-sheet.png");
console.log("demo dir:", demoDir);
