#!/usr/bin/env bash
# Owner walkthrough — launch the HN toolbar app (create/reuse + install local tarballs + run).
# WALK_NOPRUN=1  -> do everything except launching (headless validation).
set -euo pipefail
DEMOS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$DEMOS/../../../.." && pwd)"
SCRATCH_DIR="$HOME/opentray-owner-walkthrough"
TGZ="$SCRATCH_DIR/tgz"
URL="${1:-https://news.ycombinator.com}"
APP_DIR="$HOME/.opentray/create/com-ycombinator-news/app"

if [ ! -f "$APP_DIR/package.json" ]; then
  mkdir -p "$SCRATCH_DIR"
  (cd "$SCRATCH_DIR" && pnpm --dir "$REPO" create-opentray create \
    --url "$URL" --toolbar --skip-install --pm npm --json)
fi
cd "$APP_DIR"
TGZ="$TGZ" node "$DEMOS/inject-overrides.mjs"
npm install --no-fund --no-audit >/dev/null
if [ -n "${WALK_NOPRUN:-}" ]; then
  echo "prepared (WALK_NOPRUN): $APP_DIR"
else
  exec node main.mjs
fi
