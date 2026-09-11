#!/usr/bin/env bash
# Owner walkthrough — command app with local service + toolbar (create/reuse + run).
# WALK_NOPRUN=1  -> do everything except launching.
set -euo pipefail
DEMOS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DEMOS/../../../.." && pwd)"
SCRATCH_DIR="$HOME/opentray-owner-walkthrough"
TGZ="$SCRATCH_DIR/tgz"
APP_DIR="$HOME/.opentray/create/local-cmd-demo/app"

mkdir -p "$SCRATCH_DIR/cmd-content"
echo '<!doctype html><title>Cmd Service</title><h1>command app service</h1>' \
  > "$SCRATCH_DIR/cmd-content/index.html"
if [ ! -f "$APP_DIR/package.json" ]; then
  (cd "$SCRATCH_DIR" && pnpm --dir "$REPO" create-opentray create \
    --app-id local.cmd-demo --app-name "Cmd Demo" \
    --exec python3 --arg=-m --arg=http.server --arg=8137 \
    --cwd "$SCRATCH_DIR/cmd-content" --toolbar --skip-install --pm npm --json)
fi
cd "$APP_DIR"
TGZ="$TGZ" node "$DEMOS/inject-overrides.mjs"
npm install --no-fund --no-audit >/dev/null
if [ -n "${WALK_NOPRUN:-}" ]; then
  echo "prepared (WALK_NOPRUN): $APP_DIR"
else
  exec node main.mjs
fi
