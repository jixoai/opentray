#!/usr/bin/env bash

set -euo pipefail

output_zip="${1:-}"
source_dir="${2:-}"
app_name="${3:-}"
binary_name="${4:-}"
privacy_families="${OPENTRAY_DARWIN_PRIVACY_FAMILIES:-}"

if [[ -z "${output_zip}" || -z "${source_dir}" || -z "${app_name}" || -z "${binary_name}" ]]; then
  echo "usage: bash scripts/release/build-darwin-app-carrier.sh <output-zip-path> <source-dir> <app-name> <binary-name>" >&2
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
case "${source_dir}" in
  /*) ;;
  *) source_dir="${root_dir}/${source_dir}" ;;
esac

build_dir="${root_dir}/target/darwin-app-carrier/${app_name}"
app_bundle="${build_dir}/${app_name}.app"

rm -rf "${build_dir}"
mkdir -p "${build_dir}"

swiftc \
  -O \
  -framework AppKit \
  -o "${build_dir}/${binary_name}" \
  "${source_dir}/main.swift"

mkdir -p "${app_bundle}/Contents/MacOS"
cp "${source_dir}/Info.plist" "${app_bundle}/Contents/Info.plist"
if [[ -n "${privacy_families}" ]]; then
  IFS=',' read -ra families <<< "${privacy_families}"
  for family in "${families[@]}"; do
    case "${family}" in
      camera)
        /usr/libexec/PlistBuddy -c "Set :NSCameraUsageDescription OpenTray needs camera access for this app." "${app_bundle}/Contents/Info.plist" 2>/dev/null \
          || /usr/libexec/PlistBuddy -c "Add :NSCameraUsageDescription string OpenTray needs camera access for this app." "${app_bundle}/Contents/Info.plist"
        ;;
      microphone)
        /usr/libexec/PlistBuddy -c "Set :NSMicrophoneUsageDescription OpenTray needs microphone access for this app." "${app_bundle}/Contents/Info.plist" 2>/dev/null \
          || /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string OpenTray needs microphone access for this app." "${app_bundle}/Contents/Info.plist"
        ;;
    esac
  done
fi
cp "${build_dir}/${binary_name}" "${app_bundle}/Contents/MacOS/${binary_name}"
chmod 755 "${app_bundle}/Contents/MacOS/${binary_name}"

ditto -c -k --sequesterRsrc --keepParent \
  "${app_bundle}" \
  "${output_zip}"

echo "built Darwin app carrier artifact: ${output_zip}"
