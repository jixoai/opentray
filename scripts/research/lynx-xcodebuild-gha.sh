#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache_dir="${root_dir}/research/lynx/cache"
logs_dir="${root_dir}/research/lynx/logs"
upstream_dir="${root_dir}/research/lynx/upstream"
lynx_dir="${upstream_dir}/lynx"
out_dir="${LYNX_OUT_DIR:-out/Default}"
derived_data_dir="${root_dir}/research/lynx/DerivedData"
gn_args_file="${root_dir}/scripts/research/lynx-macos.args.gn"
mirror_urls_file="${root_dir}/scripts/research/lynx-mirrored-urls.txt"
lynx_repo="${LYNX_REPO:-https://github.com/lynx-family/lynx.git}"
lynx_ref="${LYNX_REF:-3a936299ec1669cfd1f3da71e41240296bc226b3}"
mirror_port="${LYNX_MIRROR_PORT:-39123}"
deps_files=()

download_with_retry() {
  local url="$1"
  local target="$2"

  mkdir -p "$(dirname "${target}")"
  curl \
    --fail \
    --location \
    --retry 5 \
    --retry-all-errors \
    --retry-delay 2 \
    --connect-timeout 30 \
    --max-time 1200 \
    --output "${target}" \
    "${url}"
}

rewrite_url_if_present() {
  local file="$1"
  local old_url="$2"
  local new_url="$3"

  python3 - "$file" "$old_url" "$new_url" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
old = sys.argv[2]
new = sys.argv[3]
text = path.read_text()
if old not in text:
    raise SystemExit(0)
path.write_text(text.replace(old, new))
PY
}

start_local_mirror() {
  python3 -m http.server "${mirror_port}" \
    --bind 127.0.0.1 \
    --directory "${cache_dir}" \
    > "${logs_dir}/mirror-server.log" 2>&1 &
  mirror_pid=$!
  sleep 1
  curl --silent --fail "http://127.0.0.1:${mirror_port}/" >/dev/null
}

prefetch_and_rewrite_urls() {
  local url=""
  local basename=""
  local cached=""
  local local_url=""
  local deps_file=""

  while IFS= read -r url; do
    if [[ -z "${url}" ]]; then
      continue
    fi

    basename="$(basename "${url}")"
    cached="${cache_dir}/${basename}"
    download_with_retry "${url}" "${cached}" 2>&1 | tee -a "${logs_dir}/prefetch-assets.log"

    local_url="http://127.0.0.1:${mirror_port}/${basename}"
    for deps_file in "${deps_files[@]}"; do
      rewrite_url_if_present "${deps_file}" "${url}" "${local_url}"
    done
  done < "${mirror_urls_file}"
}

cleanup() {
  if [[ -n "${mirror_pid:-}" ]]; then
    kill "${mirror_pid}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

rm -rf "${cache_dir}" "${logs_dir}" "${lynx_dir}" "${derived_data_dir}"
mkdir -p "${cache_dir}" "${logs_dir}" "${upstream_dir}" "${derived_data_dir}"

echo "Cloning Lynx from ${lynx_repo} at ${lynx_ref}"
git clone "${lynx_repo}" "${lynx_dir}" 2>&1 | tee "${logs_dir}/git-clone.log"

cd "${lynx_dir}"
git checkout --detach "${lynx_ref}" 2>&1 | tee "${logs_dir}/git-checkout.log"
git rev-parse HEAD | tee "${logs_dir}/lynx-ref.txt"

unset all_proxy http_proxy https_proxy ALL_PROXY HTTP_PROXY HTTPS_PROXY
export XDG_CONFIG_HOME="${lynx_dir}/.xdg-config"
mkdir -p "${XDG_CONFIG_HOME}"

deps_files=(
  "${lynx_dir}/dependencies/DEPS"
  "${lynx_dir}/dependencies/DEPS.clay"
  "${lynx_dir}/tools_shared/dependencies/DEPS"
)
prefetch_and_rewrite_urls
start_local_mirror

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
