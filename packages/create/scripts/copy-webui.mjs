// Copies the built create-webui SPA (React + shadcn) into the wizard package's
// dist/webui, plus the ghostty-web WASM at the document root path where the
// renderer resolves it (/ghostty-vt.wasm).
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webuiDist = resolve(root, "..", "create-webui", "dist");
const target = resolve(root, "dist", "webui");

if (!existsSync(resolve(webuiDist, "index.html"))) {
  throw new Error(
    `create-webui build output is missing: ${webuiDist}/index.html — run "pnpm --filter @opentray/create-webui build" first`,
  );
}

mkdirSync(target, { recursive: true });
const copyDir = (from, to) => {
  for (const entry of readdirSync(from)) {
    const source = resolve(from, entry);
    const destination = resolve(to, entry);
    if (statSync(source).isDirectory()) {
      mkdirSync(destination, { recursive: true });
      copyDir(source, destination);
      continue;
    }
    copyFileSync(source, destination);
    console.log(`copied webui asset: ${source} -> ${destination}`);
  }
};
copyDir(webuiDist, target);

// ghostty-web's WASM loader resolves document-relative candidates
// (./ghostty-vt.wasm, /ghostty-vt.wasm); place it at the webui root so both
// resolve against the wizard origin.
const require = createRequire(import.meta.url);
const ghosttyRoot = dirname(dirname(require.resolve("ghostty-web")));
const wasmSource = resolve(ghosttyRoot, "ghostty-vt.wasm");
copyFileSync(wasmSource, resolve(target, "ghostty-vt.wasm"));
console.log(`copied ghostty wasm: ${wasmSource} -> ${resolve(target, "ghostty-vt.wasm")}`);

// Legacy /vendor/* routes stay available for older embedded consumers.
const vendorDir = resolve(target, "vendor");
mkdirSync(vendorDir, { recursive: true });
copyFileSync(
  resolve(ghosttyRoot, "dist", "ghostty-web.js"),
  resolve(vendorDir, "ghostty-web.js"),
);
copyFileSync(wasmSource, resolve(vendorDir, "ghostty-vt.wasm"));
console.log(`refreshed vendor assets in ${vendorDir}`);

// Generated-app window pages (terminal / browse wrappers) with relative asset
// paths, self-contained under dist/shell. terminal.html doubles as the
// directory index for the shell server's SPA fallback.
const shellTarget = resolve(root, "dist", "shell");
mkdirSync(shellTarget, { recursive: true });
for (const entry of readdirSync(webuiDist)) {
  if (entry === "index.html") {
    continue; // wizard page, not part of the generated-app shell
  }
  const source = resolve(webuiDist, entry);
  if (statSync(source).isDirectory()) {
    mkdirSync(resolve(shellTarget, entry), { recursive: true });
    for (const asset of readdirSync(source)) {
      copyFileSync(resolve(source, asset), resolve(shellTarget, entry, asset));
    }
  } else {
    copyFileSync(source, resolve(shellTarget, entry));
    // The terminal page doubles as the SPA index for bare-root requests.
    if (entry === "terminal.html") {
      copyFileSync(source, resolve(shellTarget, "index.html"));
    }
  }
}
console.log(`shell assets copied to ${shellTarget}`);
