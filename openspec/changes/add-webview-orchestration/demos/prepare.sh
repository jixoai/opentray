#!/usr/bin/env bash
# Owner walkthrough — one-time preparation (idempotent): build + stage + pack tarballs.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRATCH_DIR="$HOME/opentray-owner-walkthrough"
mkdir -p "$SCRATCH_DIR/tgz"

cd "$REPO"
mbx build --release -p opentray-bin -p opentray-ext-webview -j 2
cp -f target/release/libopentray_ext_webview.dylib \
      packages/ext-webview-darwin-arm64/lib/libopentray_ext_webview.dylib
mkdir -p packages/darwin-arm64/bin packages/darwin-arm64/app
cp -f target/release/opentray packages/darwin-arm64/bin/opentray
cp -f packages/darwin-app-carrier/Info.plist packages/darwin-arm64/app/Info.plist
pnpm -F opentray build
for p in opentray @opentray/spec @opentray/packaging @opentray/icon \
         @opentray/darwin-arm64 @opentray/ext-webview \
         @opentray/ext-webview-darwin-arm64; do
  pnpm -F "$p" pack --pack-destination "$SCRATCH_DIR/tgz" >/dev/null
done
echo "ready: $(ls "$SCRATCH_DIR/tgz" | wc -l | tr -d ' ') tarballs in $SCRATCH_DIR/tgz"
