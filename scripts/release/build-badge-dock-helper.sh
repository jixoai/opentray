#!/usr/bin/env bash

# Orthogonal intents (maintained 2026-07-19; original user request: keep the
# badge helper as an independent consumer of the shared Darwin carrier builder):
# 1. Select the matching badge source atom for the native runner architecture.
# 2. Bind badge-specific identity to the shared carrier builder.

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
source_dir="${OPENTRAY_BADGE_DOCK_HELPER_SOURCE_DIR:-}"
if [[ -z "${source_dir}" ]]; then
  case "$(uname -m)" in
    arm64)
      package_arch="arm64"
      ;;
    x86_64)
      package_arch="x64"
      ;;
    *)
      echo "unsupported Darwin badge helper architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
  source_dir="packages/ext-badge-darwin-${package_arch}/app"
fi

bash "${root_dir}/scripts/release/build-darwin-app-carrier.sh" \
  "${output_zip}" \
  "${source_dir}" \
  "OpenTrayBadgeHelper" \
  "OpenTrayBadgeHelper"

echo "built badge dock helper artifact: ${output_zip}"
