#!/usr/bin/env bash

set -euo pipefail

output_zip="${1:-${BADGE_DOCK_HELPER_ZIP_OUT:-}}"
if [[ -z "${output_zip}" ]]; then
  echo "usage: bash scripts/release/build-badge-dock-helper.sh <output-zip-path>" >&2
  exit 1
fi

caller_dir="$(pwd)"
case "${output_zip}" in
  /*) ;;
  *) output_zip="${caller_dir}/${output_zip}" ;;
esac

output_dir="$(dirname "${output_zip}")"
mkdir -p "${output_dir}"
output_dir="$(cd "${output_dir}" && pwd)"
output_zip="${output_dir}/$(basename "${output_zip}")"

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_dir="packages/ext-badge-darwin-arm64/app"

bash "${root_dir}/scripts/release/build-darwin-app-carrier.sh" \
  "${output_zip}" \
  "${source_dir}" \
  "OpenTrayBadgeHelper" \
  "OpenTrayBadgeHelper"

echo "built badge dock helper artifact: ${output_zip}"
