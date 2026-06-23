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
source_dir="${root_dir}/packages/ext-badge-darwin-arm64/app"
build_dir="${root_dir}/target/badge-dock-helper"
app_bundle="${build_dir}/OpenTrayBadgeHelper.app"
binary_name="OpenTrayBadgeHelper"

rm -rf "${build_dir}"
mkdir -p "${build_dir}"

swiftc \
  -O \
  -framework AppKit \
  -o "${build_dir}/${binary_name}" \
  "${source_dir}/main.swift"

mkdir -p "${app_bundle}/Contents/MacOS"
cp "${source_dir}/Info.plist" "${app_bundle}/Contents/Info.plist"
cp "${build_dir}/${binary_name}" "${app_bundle}/Contents/MacOS/${binary_name}"
chmod 755 "${app_bundle}/Contents/MacOS/${binary_name}"

ditto -c -k --sequesterRsrc --keepParent \
  "${app_bundle}" \
  "${output_zip}"

echo "built badge dock helper artifact: ${output_zip}"
