#!/usr/bin/env bash

set -euo pipefail

output_zip="${1:-${LYNX_RUNTIME_ZIP_OUT:-}}"
if [[ -z "${output_zip}" ]]; then
  echo "usage: bash scripts/release/build-lynx-runtime.sh <output-zip-path>" >&2
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
cache_dir="${root_dir}/research/lynx/cache"
logs_dir="${root_dir}/research/lynx/logs/release"
upstream_dir="${root_dir}/research/lynx/upstream"
lynx_dir="${upstream_dir}/lynx"
out_dir="${LYNX_OUT_DIR:-out/Default}"
derived_data_dir="${root_dir}/research/lynx/DerivedData-release"
args_file="${root_dir}/scripts/release/lynx-macos.args.gn"
mirror_urls_file="${root_dir}/scripts/release/lynx-mirrored-urls.txt"
lynx_repo="${LYNX_REPO:-https://github.com/lynx-family/lynx.git}"
lynx_ref="${LYNX_REF:-3a936299ec1669cfd1f3da71e41240296bc226b3}"
mirror_port="${LYNX_MIRROR_PORT:-39123}"
runtime_host_source_dir="${root_dir}/native/lynx-runtime-macos"
lynx_patches_dir="${root_dir}/native/lynx-patches"
runtime_host_upstream_dir="${lynx_dir}/explorer/darwin/macos/lynx_explorer"
runtime_app_name="OpenTrayLynxRuntime"
deps_files=()
mirror_pid=""

rewrite_git_dep_url_if_present() {
  local file="$1"
  local old_url="$2"
  local new_url="$3"

  python3 - "$file" "$old_url" "$new_url" <<'PY'
from pathlib import Path
import platform
import re
import sys

path = Path(sys.argv[1])
old = sys.argv[2]
new = sys.argv[3]
if not path.exists():
    raise SystemExit(0)

text = path.read_text()
if old in text:
    path.write_text(text.replace(old, new))
    raise SystemExit(0)

system = platform.system().lower()
machine = platform.machine().lower()
machine = "x86_64" if machine == "amd64" else machine
ns = {
    "os": __import__("os"),
    "platform": platform,
    "root_dir": "/tmp",
    "system": system,
    "machine": machine,
    "__builtins__": __builtins__,
}
exec(text, ns)

matches = []
for dep_key, spec in ns.get("deps", {}).items():
    if not isinstance(spec, dict) or spec.get("type") != "git":
        continue
    dep_url = spec.get("url")
    if isinstance(dep_url, str) and dep_url == old:
        matches.append(dep_key)

if not matches:
    raise SystemExit(0)

lines = text.splitlines(keepends=True)
for dep_key in matches:
    key_re = re.compile(rf'^\s*[\'"]{re.escape(dep_key)}[\'"]\s*:\s*\{{\s*$')
    url_re = re.compile(r'^(?P<prefix>\s*[\'"]url[\'"]\s*:\s*)(?P<value>.+?)(?P<suffix>,\s*)$')
    in_block = False
    depth = 0
    for index, line in enumerate(lines):
        if not in_block:
            if key_re.match(line):
                in_block = True
                depth = line.count("{") - line.count("}")
            continue
        depth += line.count("{") - line.count("}")
        match = url_re.match(line)
        if match:
            lines[index] = f'{match.group("prefix")}"{new}"{match.group("suffix")}'
            break
        if depth <= 0:
            break

patched = "".join(lines)
if patched != text:
    path.write_text(patched)
PY
}

download_with_retry() {
  local url="$1"
  local target="$2"

  mkdir -p "$(dirname "${target}")"
  if [[ -s "${target}" ]]; then
    return 0
  fi
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

clone_tools_shared() {
  local tools_shared_dir="${lynx_dir}/tools_shared"
  local tools_shared_url=""
  local tools_shared_ref=""

  IFS=$'\t' read -r tools_shared_url tools_shared_ref < <(
    python3 - "${lynx_dir}/dependencies/DEPS" <<'PY'
from pathlib import Path
import platform
import sys

root_dir = "/tmp"
system = platform.system().lower()
machine = platform.machine().lower()
machine = "x86_64" if machine == "amd64" else machine
ns = {
    "os": __import__("os"),
    "platform": platform,
    "root_dir": root_dir,
    "system": system,
    "machine": machine,
    "__builtins__": __builtins__,
}
exec(Path(sys.argv[1]).read_text(), ns)
spec = ns["deps"]["./tools_shared"]
print(f'{spec["url"]}\t{spec["commit"]}')
PY
  )

  git clone "${tools_shared_url}" "${tools_shared_dir}" 2>&1 | tee "${logs_dir}/tools-shared-clone.log"
  git -C "${tools_shared_dir}" checkout --detach "${tools_shared_ref}" 2>&1 | tee "${logs_dir}/tools-shared-checkout.log"
}

install_opentray_runtime_host_sources() {
  if [[ ! -d "${runtime_host_source_dir}" ]]; then
    echo "missing OpenTray Lynx runtime host sources: ${runtime_host_source_dir}" >&2
    exit 1
  fi

  rm -rf "${runtime_host_upstream_dir}"
  mkdir -p "$(dirname "${runtime_host_upstream_dir}")"
  # The upstream checkout stays disposable; OpenTray's owned host-app sources are copied in fresh.
  cp -R "${runtime_host_source_dir}" "${runtime_host_upstream_dir}"
}

apply_opentray_lynx_patches() {
  if [[ ! -d "${lynx_patches_dir}" ]]; then
    return
  fi

  local patch_file=""
  shopt -s nullglob
  for patch_file in "${lynx_patches_dir}"/*.patch; do
    echo "Applying OpenTray Lynx patch: ${patch_file}"
    git apply --whitespace=nowarn "${patch_file}"
  done
  shopt -u nullglob
}

patch_generated_runtime_outputs() {
  local project_file="${lynx_dir}/${out_dir}/all.xcodeproj/project.pbxproj"

  python3 - "${project_file}" "${runtime_app_name}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
app_name = sys.argv[2]
lines = path.read_text().splitlines(keepends=True)
phase_name = 'name = "Action \\"Compile and copy lynx_explorer via ninja\\"";'
outputs = (
    f'"$(PROJECT_DIR)/{app_name}.app/Contents/Info.plist"',
    f'"$(PROJECT_DIR)/{app_name}.app/Contents/PkgInfo"',
    f'"$(PROJECT_DIR)/{app_name}.app/Contents/MacOS/{app_name}"',
)

for index, line in enumerate(lines):
    if phase_name not in line:
        continue

    output_start = None
    output_end = None
    for candidate in range(index + 1, len(lines)):
        if "outputPaths = (" in lines[candidate]:
            output_start = candidate
            for tail in range(candidate + 1, len(lines)):
                if lines[tail].strip() == ");":
                    output_end = tail
                    break
            break

    if output_start is None or output_end is None:
        raise SystemExit("lynx_explorer outputPaths block not found")

    current_block = "".join(lines[output_start : output_end + 1])
    if outputs[0] in current_block:
        raise SystemExit(0)

    indent = lines[output_start].split("outputPaths = (", 1)[0]
    lines[output_start : output_end + 1] = [
        f"{indent}outputPaths = (\n",
        *[f"{indent}\t{output},\n" for output in outputs],
        f"{indent});\n",
    ]
    path.write_text("".join(lines))
    raise SystemExit(0)

raise SystemExit("lynx_explorer build phase not found in generated project")
PY
}

patch_app_bundle_ats() {
  local app_bundle_path="$1"
  local info_plist="${app_bundle_path}/Contents/Info.plist"

  python3 - "${info_plist}" <<'PY'
from pathlib import Path
import plistlib
import sys

path = Path(sys.argv[1])
data = plistlib.loads(path.read_bytes())
ats = data.setdefault("NSAppTransportSecurity", {})
ats["NSAllowsArbitraryLoads"] = True
path.write_bytes(plistlib.dumps(data, sort_keys=False))
PY
}

rewrite_resolved_dep_url_if_present() {
  local file="$1"
  local old_url="$2"
  local new_url="$3"

  python3 - "$file" "$old_url" "$new_url" <<'PY'
from pathlib import Path
import platform
import re
import sys

path = Path(sys.argv[1])
old = sys.argv[2]
new = sys.argv[3]
if not path.exists():
    raise SystemExit(0)

text = path.read_text()
if old in text:
    path.write_text(text.replace(old, new))
    raise SystemExit(0)

system = platform.system().lower()
machine = platform.machine().lower()
machine = "x86_64" if machine == "amd64" else machine
ns = {
    "os": __import__("os"),
    "platform": platform,
    "root_dir": "/tmp",
    "system": system,
    "machine": machine,
    "__builtins__": __builtins__,
}
exec(text, ns)

matches = []
for dep_key, spec in ns.get("deps", {}).items():
    if not isinstance(spec, dict) or spec.get("type") != "http":
        continue
    dep_url = spec.get("url")
    if isinstance(dep_url, str) and dep_url == old:
        matches.append(dep_key)

if not matches:
    raise SystemExit(0)

lines = text.splitlines(keepends=True)
for dep_key in matches:
    key_re = re.compile(rf'^\s*[\'"]{re.escape(dep_key)}[\'"]\s*:\s*\{{\s*$')
    url_re = re.compile(r'^(?P<prefix>\s*[\'"]url[\'"]\s*:\s*)(?P<value>.+?)(?P<suffix>,\s*)$')
    in_block = False
    depth = 0
    for index, line in enumerate(lines):
        if not in_block:
            if key_re.match(line):
                in_block = True
                depth = line.count("{") - line.count("}")
            continue
        depth += line.count("{") - line.count("}")
        match = url_re.match(line)
        if match:
            lines[index] = f'{match.group("prefix")}"{new}"{match.group("suffix")}'
            break
        if depth <= 0:
            break

patched = "".join(lines)
if patched != text:
    path.write_text(patched)
PY
}

rewrite_buildtools_template_urls_if_present() {
  local file="$1"
  local mirror_base="http://127.0.0.1:${mirror_port}"

  python3 - "$file" "$mirror_base" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
mirror_base = sys.argv[2]
if not path.exists():
    raise SystemExit(0)

text = path.read_text()
pattern = re.compile(
    r'(?P<prefix>["\']url["\']\s*:\s*f["\'])'
    r'https://github\.com/lynx-family/buildtools/releases/download/[^/]+/'
    r'(?P<basename>buildtools-[^"\']*?)\{system\}-\{machine\}'
    r'(?P<suffix>\.tar\.gz["\'])'
)
patched = pattern.sub(
    lambda match: (
        f'{match.group("prefix")}{mirror_base}/'
        f'{match.group("basename")}{{system}}-{{machine}}'
        f'{match.group("suffix")}'
    ),
    text,
)
if patched != text:
    path.write_text(patched)
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

  for deps_file in "${deps_files[@]}"; do
    rewrite_buildtools_template_urls_if_present "${deps_file}"
  done

  while IFS= read -r url; do
    if [[ -z "${url}" ]]; then
      continue
    fi

    basename="$(basename "${url}")"
    cached="${cache_dir}/${basename}"
    download_with_retry "${url}" "${cached}" 2>&1 | tee -a "${logs_dir}/prefetch-assets.log"

    local_url="http://127.0.0.1:${mirror_port}/${basename}"
    for deps_file in "${deps_files[@]}"; do
      rewrite_resolved_dep_url_if_present "${deps_file}" "${url}" "${local_url}"
    done
  done < "${mirror_urls_file}"
}

rewrite_git_dependency_urls() {
  local deps_file=""
  for deps_file in "${deps_files[@]}"; do
    rewrite_git_dep_url_if_present \
      "${deps_file}" \
      "https://flutter.googlesource.com/third_party/abseil-cpp" \
      "https://github.com/abseil/abseil-cpp.git"
    rewrite_git_dep_url_if_present \
      "${deps_file}" \
      "https://flutter.googlesource.com/third_party/harfbuzz.git" \
      "https://github.com/harfbuzz/harfbuzz.git"
    rewrite_git_dep_url_if_present \
      "${deps_file}" \
      "https://swiftshader.googlesource.com/SwiftShader.git" \
      "https://github.com/google/swiftshader.git"
  done
}

cleanup() {
  if [[ -n "${mirror_pid}" ]]; then
    kill "${mirror_pid}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

rm -rf "${logs_dir}" "${lynx_dir}" "${derived_data_dir}"
mkdir -p \
  "${cache_dir}" \
  "${logs_dir}" \
  "${upstream_dir}" \
  "${derived_data_dir}"

echo "Cloning Lynx from ${lynx_repo} at ${lynx_ref}"
git clone "${lynx_repo}" "${lynx_dir}" 2>&1 | tee "${logs_dir}/git-clone.log"

cd "${lynx_dir}"
git checkout --detach "${lynx_ref}" 2>&1 | tee "${logs_dir}/git-checkout.log"
git rev-parse HEAD | tee "${logs_dir}/lynx-ref.txt"
clone_tools_shared
install_opentray_runtime_host_sources
apply_opentray_lynx_patches

unset all_proxy http_proxy https_proxy ALL_PROXY HTTP_PROXY HTTPS_PROXY
export XDG_CONFIG_HOME="${lynx_dir}/.xdg-config"
mkdir -p "${XDG_CONFIG_HOME}"

deps_files=(
  "${lynx_dir}/dependencies/DEPS"
  "${lynx_dir}/dependencies/DEPS.clay"
  "${lynx_dir}/tools_shared/dependencies/DEPS"
)
echo "Prefetching mirrored Lynx dependencies"
prefetch_and_rewrite_urls
echo "Rewriting fragile googlesource git dependencies to verified GitHub upstreams"
rewrite_git_dependency_urls
echo "Starting local Lynx dependency mirror on 127.0.0.1:${mirror_port}"
start_local_mirror

set +u
source tools/envsetup.sh
set -u

echo "Running tools/hab sync"
tools/hab sync . --target clay 2>&1 | tee "${logs_dir}/hab-sync.log"

echo "Generating Xcode project with GN"
buildtools/gn/gn gen "${out_dir}" \
  --args="$(<"${args_file}")" \
  --ide=xcode \
  2>&1 | tee "${logs_dir}/gn-gen.log"

patch_generated_runtime_outputs

echo "Building OpenTray Lynx runtime host with xcodebuild"
xcodebuild \
  -project "${out_dir}/all.xcodeproj" \
  -scheme lynx_explorer \
  -configuration Release \
  -destination "generic/platform=macOS" \
  -derivedDataPath "${derived_data_dir}" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  COMPILER_INDEX_STORE_ENABLE=NO \
  build \
  2>&1 | tee "${logs_dir}/xcodebuild-build.log"

app_bundle_path="${lynx_dir}/${out_dir}/${runtime_app_name}.app"
if [[ ! -d "${app_bundle_path}" ]]; then
  echo "expected app bundle not found: ${app_bundle_path}" >&2
  exit 1
fi

patch_app_bundle_ats "${app_bundle_path}"

ditto -c -k --sequesterRsrc --keepParent \
  "${app_bundle_path}" \
  "${output_zip}"

if [[ ! -f "${output_zip}" ]]; then
  echo "expected runtime zip not found after ditto: ${output_zip}" >&2
  exit 1
fi

echo "built Lynx runtime artifact: ${output_zip}"
