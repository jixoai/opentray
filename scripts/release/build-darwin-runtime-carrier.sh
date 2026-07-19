#!/usr/bin/env bash

# Orthogonal intents (maintained 2026-07-19; original user request: publish the
# shared Darwin app carrier with each @opentray/darwin-* runtime package):
# 1. Bind the generic carrier builder to the OpenTray runtime source identity.
# 2. Declare release-default macOS privacy usage families.

set -euo pipefail

output_zip="${1:-${OPENTRAY_DARWIN_RUNTIME_CARRIER_ZIP_OUT:-}}"
if [[ -z "${output_zip}" ]]; then
  echo "usage: bash scripts/release/build-darwin-runtime-carrier.sh <output-zip-path>" >&2
  exit 1
fi

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_dir="${OPENTRAY_DARWIN_RUNTIME_CARRIER_SOURCE_DIR:-packages/darwin-app-carrier}"
export OPENTRAY_DARWIN_PRIVACY_FAMILIES="${OPENTRAY_DARWIN_PRIVACY_FAMILIES:-camera,microphone}"

bash "${root_dir}/scripts/release/build-darwin-app-carrier.sh" \
  "${output_zip}" \
  "${source_dir}" \
  "OpenTray" \
  "OpenTray"

echo "built Darwin runtime carrier artifact: ${output_zip}"
