#!/usr/bin/env bash
# Owner walkthrough — start the wizard (isolated HOME) and open it in the browser.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
mkdir -p /tmp/opentray-wizard-home
cd /tmp/opentray-wizard-home
URL="$(HOME=/tmp/opentray-wizard-home pnpm --dir "$REPO" create-opentray web --no-open \
  | grep -o 'http://127.0.0.1:[0-9]*/?token=[0-9a-f]*' | tail -1)"
echo "$URL"
open "$URL"
