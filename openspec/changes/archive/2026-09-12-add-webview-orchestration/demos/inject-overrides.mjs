// Walkthrough helper: point a generated app at the local worktree tarballs.
// Works on both platforms (picks the matching platform package names).
import fs from "node:fs";

const tgz = process.env.TGZ;
if (!tgz) {
  console.error("TGZ env var required (tarball directory)");
  process.exit(1);
}
const isWin = process.platform === "win32";
const platformPkg = isWin ? "@opentray/windows-x64" : "@opentray/darwin-arm64";
const extPlatformPkg = isWin
  ? "@opentray/ext-webview-windows-x64"
  : "@opentray/ext-webview-darwin-arm64";
const t = (n) => `file:${tgz}/${n}`;
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
pkg.overrides = {
  "opentray": t("opentray-0.23.0.tgz"),
  "@opentray/spec": t("opentray-spec-0.23.0.tgz"),
  "@opentray/packaging": t("opentray-packaging-0.23.0.tgz"),
  "@opentray/icon": t("opentray-icon-0.23.0.tgz"),
  [platformPkg]: t(`opentray-${isWin ? "windows" : "darwin"}-${isWin ? "x64" : "arm64"}-0.23.0.tgz`),
  "@opentray/ext-webview": t("opentray-ext-webview-0.23.0.tgz"),
  [extPlatformPkg]: t(`opentray-ext-webview-${isWin ? "windows" : "darwin"}-${isWin ? "x64" : "arm64"}-0.23.0.tgz`),
};
pkg.dependencies["opentray"] = t("opentray-0.23.0.tgz");
pkg.dependencies["@opentray/ext-webview"] = t("opentray-ext-webview-0.23.0.tgz");
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
console.log(`overrides injected (${isWin ? "win32" : "darwin"} tarballs) -> ${tgz}`);
