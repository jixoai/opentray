#!/usr/bin/env bash
# Owner walkthrough — remove walkthrough apps and scratch state.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
pnpm --dir "$REPO" create-opentray app uninstall com.ycombinator.news || true
pnpm --dir "$REPO" create-opentray app uninstall local.cmd-demo || true
rm -rf /tmp/opentray-wizard-home "$HOME/opentray-owner-walkthrough" 2>/dev/null || true
echo "note: WebKit data lives in ~/Library/WebKit/<appId> (not HOME-isolated); remove manually if desired:"
ls -d "$HOME/Library/WebKit"/com.ycombinator.news "$HOME/Library/WebKit"/local.cmd.demo 2>/dev/null || true
