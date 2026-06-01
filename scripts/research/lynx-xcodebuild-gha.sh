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

patch_build_resources_pnpm_path() {
  local build_resources_py="${lynx_dir}/explorer/darwin/macos/lynx_explorer/build_resources.py"

  python3 - "${build_resources_py}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = "    subprocess.check_call(['bash', '-c', 'pnpm install --no-frozen-lockfile && pnpm run build'], cwd=homepage_dir)\n"
new = """    homepage_env = os.environ.copy()\n    homepage_env[\"PATH\"] = os.path.join(root_dir, 'buildtools', 'node', 'bin') + os.pathsep + homepage_env.get(\"PATH\", \"\")\n    subprocess.check_call(['bash', '-c', 'pnpm install --no-frozen-lockfile && pnpm run build'], cwd=homepage_dir, env=homepage_env)\n"""
if old not in text:
    raise SystemExit("expected build_resources.py homepage pnpm invocation not found")
path.write_text(text.replace(old, new, 1))
PY
}

patch_generated_lynx_explorer_outputs() {
  local project_file="${lynx_dir}/${out_dir}/all.xcodeproj/project.pbxproj"

  python3 - "${project_file}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
lines = path.read_text().splitlines(keepends=True)
phase_name = 'name = "Action \\"Compile and copy lynx_explorer via ninja\\"";'
outputs = (
    '"$(PROJECT_DIR)/LynxExplorer.app/Contents/Info.plist"',
    '"$(PROJECT_DIR)/LynxExplorer.app/Contents/PkgInfo"',
    '"$(PROJECT_DIR)/LynxExplorer.app/Contents/MacOS/LynxExplorer"',
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

raise SystemExit('lynx_explorer build phase not found in generated project')
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
      rewrite_resolved_dep_url_if_present "${deps_file}" "${url}" "${local_url}"
    done
  done < "${mirror_urls_file}"
}

cleanup() {
  if [[ -n "${mirror_pid:-}" ]]; then
    kill "${mirror_pid}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

rm -rf "${logs_dir}" "${lynx_dir}" "${derived_data_dir}"
mkdir -p "${cache_dir}" "${logs_dir}" "${upstream_dir}" "${derived_data_dir}"

echo "Cloning Lynx from ${lynx_repo} at ${lynx_ref}"
git clone "${lynx_repo}" "${lynx_dir}" 2>&1 | tee "${logs_dir}/git-clone.log"

cd "${lynx_dir}"
git checkout --detach "${lynx_ref}" 2>&1 | tee "${logs_dir}/git-checkout.log"
git rev-parse HEAD | tee "${logs_dir}/lynx-ref.txt"
clone_tools_shared
patch_build_resources_pnpm_path

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

patch_generated_lynx_explorer_outputs

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
