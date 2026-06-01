#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
logs_dir="${root_dir}/research/lynx/logs"
upstream_dir="${root_dir}/research/lynx/upstream"
lynx_dir="${upstream_dir}/lynx"
out_dir="${LYNX_OUT_DIR:-out/Default}"
derived_data_dir="${root_dir}/research/lynx/DerivedData"
gn_args_file="${root_dir}/scripts/research/lynx-macos.args.gn"
lynx_repo="${LYNX_REPO:-https://github.com/lynx-family/lynx.git}"
lynx_ref="${LYNX_REF:-3a936299ec1669cfd1f3da71e41240296bc226b3}"

rm -rf "${logs_dir}" "${lynx_dir}" "${derived_data_dir}"
mkdir -p "${logs_dir}" "${upstream_dir}" "${derived_data_dir}"

echo "Cloning Lynx from ${lynx_repo} at ${lynx_ref}"
git clone "${lynx_repo}" "${lynx_dir}" 2>&1 | tee "${logs_dir}/git-clone.log"

cd "${lynx_dir}"
git checkout --detach "${lynx_ref}" 2>&1 | tee "${logs_dir}/git-checkout.log"
git rev-parse HEAD | tee "${logs_dir}/lynx-ref.txt"

unset all_proxy http_proxy https_proxy ALL_PROXY HTTP_PROXY HTTPS_PROXY
export XDG_CONFIG_HOME="${lynx_dir}/.xdg-config"
mkdir -p "${XDG_CONFIG_HOME}"

# Lynx ships its own build environment setup.
set +u
source tools/envsetup.sh
set -u

tools/hab sync . --target clay 2>&1 | tee "${logs_dir}/hab-sync.log"

buildtools/gn/gn gen "${out_dir}" \
  --args="$(<"${gn_args_file}")" \
  --ide=xcode \
  2>&1 | tee "${logs_dir}/gn-gen.log"

xcodebuild \
  -project "${out_dir}/all.xcodeproj" \
  -list \
  2>&1 | tee "${logs_dir}/xcodebuild-list.log"

xcodebuild \
  -project "${out_dir}/all.xcodeproj" \
  -scheme lynx_explorer \
  -configuration Release \
  -destination 'generic/platform=macOS' \
  -derivedDataPath "${derived_data_dir}" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  COMPILER_INDEX_STORE_ENABLE=NO \
  build \
  2>&1 | tee "${logs_dir}/xcodebuild-build.log"

find "${lynx_dir}/${out_dir}" -maxdepth 2 -name 'LynxExplorer.app' -print \
  | tee "${logs_dir}/app-paths.txt"
