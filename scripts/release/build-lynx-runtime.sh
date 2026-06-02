#!/usr/bin/env bash

set -euo pipefail

output_zip="${1:-${LYNX_RUNTIME_ZIP_OUT:-}}"
if [[ -z "${output_zip}" ]]; then
  echo "usage: bash scripts/release/build-lynx-runtime.sh <output-zip-path>" >&2
  exit 1
fi

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
deps_files=()
mirror_pid=""

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

patch_macos_http_service() {
  local service_file="${lynx_dir}/explorer/darwin/macos/lynx_explorer/LynxExplorer/service/LynxHttpService.mm"

  python3 - "${service_file}" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()
pattern = re.compile(
    r'void LynxHttpServiceImpl::Request\(std::shared_ptr<pub::LynxHttpRequest> http_request,\n'
    r'\s+std::shared_ptr<pub::LynxHttpResponse> http_response\) \{\n'
    r'.*?\n'
    r'\}\n'
    r'\n'
    r'\}  // namespace service',
    re.S,
)
replacement = """void LynxHttpServiceImpl::Request(std::shared_ptr<pub::LynxHttpRequest> http_request,\n                                  std::shared_ptr<pub::LynxHttpResponse> http_response) {\n  NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:http_request->GetUrl().c_str()]];\n  NSMutableURLRequest *nsRequest = [NSMutableURLRequest requestWithURL:url];\n  nsRequest.HTTPMethod = [NSString stringWithUTF8String:http_request->GetMethod().c_str()];\n\n  for (const auto &header : http_request->GetHeaders()) {\n    NSString *key = [NSString stringWithUTF8String:header.first.c_str()];\n    NSString *value = [NSString stringWithUTF8String:header.second.c_str()];\n    if (key && value) {\n      [nsRequest setValue:value forHTTPHeaderField:key];\n    }\n  }\n\n  const auto &request_body = http_request->GetBody();\n  if (!request_body.empty()) {\n    nsRequest.HTTPBody = [NSData dataWithBytes:request_body.data() length:request_body.size()];\n  }\n\n  NSURLSession *session = [NSURLSession sharedSession];\n  NSURLSessionDataTask *dataTask =\n      [session dataTaskWithRequest:nsRequest\n                 completionHandler:^(NSData *_Nullable data, NSURLResponse *_Nullable response,\n                                     NSError *_Nullable error) {\n                   if (data && data.length > 0) {\n                     http_response->SetBody(\n                         (uint8_t *)data.bytes, data.length,\n                         [](uint8_t *body, size_t length, void *opaque) { CFRelease(opaque); },\n                         (__bridge_retained void *)data);\n                   }\n\n                   if (error) {\n                     static const int SDK_ERROR_STATUS_CODE = 499;\n                     http_response->SetStatusCode(SDK_ERROR_STATUS_CODE);\n                     http_response->SetStatusText([error.localizedDescription UTF8String]);\n                   } else if ([response isKindOfClass:[NSHTTPURLResponse class]]) {\n                     NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;\n                     http_response->SetStatusCode(httpResponse.statusCode);\n\n                     NSString *statusText =\n                         [NSHTTPURLResponse localizedStringForStatusCode:httpResponse.statusCode];\n                     http_response->SetStatusText(statusText ? [statusText UTF8String] : \"\");\n\n                     for (NSString *key in httpResponse.allHeaderFields) {\n                       NSString *value = httpResponse.allHeaderFields[key];\n                       if (key && value) {\n                         http_response->AddHeader([key UTF8String], [value UTF8String]);\n                       }\n                     }\n                   } else {\n                     http_response->SetStatusCode(-1);\n                     http_response->SetStatusText(\"missing http response\");\n                   }\n\n                   http_response->Complete();\n                 }];\n\n  [dataTask resume];\n}\n\n}  // namespace service"""
patched, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit("expected LynxHttpServiceImpl::Request body not found")
path.write_text(patched)
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
  "${derived_data_dir}" \
  "$(dirname "${output_zip}")"

echo "Cloning Lynx from ${lynx_repo} at ${lynx_ref}"
git clone "${lynx_repo}" "${lynx_dir}" 2>&1 | tee "${logs_dir}/git-clone.log"

cd "${lynx_dir}"
git checkout --detach "${lynx_ref}" 2>&1 | tee "${logs_dir}/git-checkout.log"
git rev-parse HEAD | tee "${logs_dir}/lynx-ref.txt"
clone_tools_shared
patch_build_resources_pnpm_path
patch_macos_http_service

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

patch_generated_lynx_explorer_outputs

echo "Building Lynx Explorer with xcodebuild"
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

app_bundle_path="${lynx_dir}/${out_dir}/LynxExplorer.app"
if [[ ! -d "${app_bundle_path}" ]]; then
  echo "expected app bundle not found: ${app_bundle_path}" >&2
  exit 1
fi

patch_app_bundle_ats "${app_bundle_path}"

ditto -c -k --sequesterRsrc --keepParent \
  "${app_bundle_path}" \
  "${output_zip}"

echo "built Lynx runtime artifact: ${output_zip}"
