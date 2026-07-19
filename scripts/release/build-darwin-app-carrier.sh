#!/usr/bin/env bash

# Orthogonal intents (maintained 2026-07-19; original user request: make the
# Darwin runtime and official extensions consume one shared app carrier law):
# 1. Materialize a macOS app bundle from one carrier source configuration.
# 2. Merge bundle identity and privacy usage strings deterministically.
# 3. Produce one release-stable zip without owning extension semantics.

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

if [[ ! -f "${source_dir}/main.swift" ]]; then
  echo "missing Darwin carrier source: ${source_dir}/main.swift" >&2
  exit 1
fi
if [[ ! -f "${source_dir}/Info.plist" ]]; then
  echo "missing Darwin carrier plist: ${source_dir}/Info.plist" >&2
  exit 1
fi

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

set_plist_string() {
  local key="$1"
  local value="$2"
  /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "${app_bundle}/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "${app_bundle}/Contents/Info.plist"
}

if [[ -n "${OPENTRAY_DARWIN_BUNDLE_IDENTIFIER:-}" ]]; then
  set_plist_string "CFBundleIdentifier" "${OPENTRAY_DARWIN_BUNDLE_IDENTIFIER}"
fi
if [[ -n "${OPENTRAY_DARWIN_BUNDLE_NAME:-}" ]]; then
  set_plist_string "CFBundleName" "${OPENTRAY_DARWIN_BUNDLE_NAME}"
fi
if [[ -n "${OPENTRAY_DARWIN_BUNDLE_DISPLAY_NAME:-}" ]]; then
  set_plist_string "CFBundleDisplayName" "${OPENTRAY_DARWIN_BUNDLE_DISPLAY_NAME}"
fi

if [[ -n "${privacy_families}" ]]; then
  IFS=',' read -ra families <<< "${privacy_families}"
  for family in "${families[@]}"; do
    family="${family//[[:space:]]/}"
    case "${family}" in
      camera)
        set_plist_string \
          "NSCameraUsageDescription" \
          "${OPENTRAY_DARWIN_CAMERA_USAGE_DESCRIPTION:-OpenTray needs camera access for this app.}"
        ;;
      microphone)
        set_plist_string \
          "NSMicrophoneUsageDescription" \
          "${OPENTRAY_DARWIN_MICROPHONE_USAGE_DESCRIPTION:-OpenTray needs microphone access for this app.}"
        ;;
      "")
        ;;
      *)
        echo "unsupported Darwin privacy family: ${family}" >&2
        exit 1
        ;;
    esac
  done
fi
cp "${build_dir}/${binary_name}" "${app_bundle}/Contents/MacOS/${binary_name}"
chmod 755 "${app_bundle}/Contents/MacOS/${binary_name}"

rm -f "${output_zip}"
ditto -c -k --sequesterRsrc --keepParent \
  "${app_bundle}" \
  "${output_zip}"

echo "built Darwin app carrier artifact: ${output_zip}"
