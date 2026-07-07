use std::{
    collections::HashSet,
    env,
    ffi::{c_void, CString, OsString},
    path::{Path, PathBuf},
    ptr,
};

use libloading::Library;
use opentray_core::{
    ExtensionError, ExtensionHostContext as CoreExtensionHostContext, ExtensionInstance,
    ExtensionLoadRequest, ExtensionLoader,
};
#[cfg(test)]
use opentray_spec::REQUIRED_EXTENSION_SYMBOLS;
use opentray_spec::{
    ExtBytes, ExtContext, ExtHostContext, ExtOwnedBytes, ExtResultCode, ExtensionEnvelope,
    ExtensionScope, Rect, EXT_ABI_VERSION, EXT_API_VERSION, EXT_ERR_INTERNAL, EXT_ERR_REJECTED,
    EXT_ERR_UNSUPPORTED, EXT_OK, EXT_SYMBOL_ABI_VERSION, EXT_SYMBOL_COMMAND, EXT_SYMBOL_DEINIT,
    EXT_SYMBOL_FREE_STRING, EXT_SYMBOL_INIT, EXT_SYMBOL_SESSION_CLOSED,
};

type ExtAbiVersionFn = unsafe extern "C" fn() -> u32;
type ExtInitFn = unsafe extern "C" fn(
    context: *const ExtContext,
    out_instance: *mut *mut c_void,
) -> ExtResultCode;
type ExtCommandFn = unsafe extern "C" fn(
    instance: *mut c_void,
    context: *const ExtHostContext,
    envelope_json: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode;
type ExtSessionClosedFn = unsafe extern "C" fn(
    instance: *mut c_void,
    context: *const ExtHostContext,
    session_id: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
) -> ExtResultCode;
type ExtDeinitFn = unsafe extern "C" fn(instance: *mut c_void);
type ExtFreeStringFn = unsafe extern "C" fn(bytes: ExtOwnedBytes);

#[derive(Debug, Clone)]
pub struct DynamicExtensionLoader {
    discovery: ExtensionDiscovery,
}

impl DynamicExtensionLoader {
    pub fn from_env() -> Result<Self, ExtensionError> {
        Ok(Self {
            discovery: ExtensionDiscovery::from_env()?,
        })
    }

    pub fn load_if_resolved(
        &self,
        request: &ExtensionLoadRequest,
    ) -> Result<Option<Box<dyn ExtensionInstance>>, ExtensionError> {
        let Some(library_path) = self.discovery.resolve_optional(request) else {
            return Ok(None);
        };
        let instance = unsafe { DynamicExtensionInstance::load(request, &library_path)? };
        Ok(Some(Box::new(instance)))
    }
}

impl ExtensionLoader for DynamicExtensionLoader {
    fn load(
        &self,
        request: &ExtensionLoadRequest,
    ) -> Result<Box<dyn ExtensionInstance>, ExtensionError> {
        self.load_if_resolved(request)?.ok_or_else(|| {
            ExtensionError::Unsupported(format!(
                "extension {} could not be resolved; candidates={}",
                request.name,
                self.discovery
                    .candidates(request)
                    .iter()
                    .map(|candidate| candidate.display().to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            ))
        })
    }
}

#[derive(Debug, Clone)]
pub struct ExtensionDiscovery {
    current_exe: PathBuf,
    home_dir: Option<PathBuf>,
    ext_paths: Vec<PathBuf>,
    node_module_roots: Vec<PathBuf>,
    package_os: String,
    arch: String,
}

impl ExtensionDiscovery {
    pub fn from_env() -> Result<Self, ExtensionError> {
        let current_exe = env::current_exe().map_err(|error| {
            ExtensionError::Unsupported(format!("cannot resolve current executable: {error}"))
        })?;
        let current_dir = env::current_dir().map_err(|error| {
            ExtensionError::Unsupported(format!("cannot resolve current directory: {error}"))
        })?;
        let cli_entrypoint = env::var_os("OPENTRAY_DAEMON_CLI_ENTRYPOINT")
            .map(PathBuf::from)
            .map(|path| absolutize_path(&current_dir, path));
        let node_module_roots = collect_node_module_roots(
            &current_dir,
            &current_exe,
            cli_entrypoint.as_deref(),
            env::var_os("NODE_PATH"),
        );
        Ok(Self {
            current_exe,
            home_dir: env::var_os("OPENTRAY_DAEMON_HOME").map(PathBuf::from),
            ext_paths: env::var_os("OPENTRAY_EXT_PATH")
                .map(|value| {
                    env::split_paths(&value)
                        .map(|path| absolutize_path(&current_dir, path))
                        .collect()
                })
                .unwrap_or_default(),
            node_module_roots,
            package_os: current_package_os().to_string(),
            arch: current_arch().to_string(),
        })
    }

    #[cfg(test)]
    fn for_test(current_exe: PathBuf, home_dir: Option<PathBuf>, ext_paths: Vec<PathBuf>) -> Self {
        Self::for_test_with_node_module_roots(current_exe, home_dir, ext_paths, Vec::new())
    }

    #[cfg(test)]
    fn for_test_with_node_module_roots(
        current_exe: PathBuf,
        home_dir: Option<PathBuf>,
        ext_paths: Vec<PathBuf>,
        node_module_roots: Vec<PathBuf>,
    ) -> Self {
        Self {
            current_exe,
            home_dir,
            ext_paths,
            node_module_roots,
            package_os: current_package_os().to_string(),
            arch: current_arch().to_string(),
        }
    }

    fn resolve_optional(&self, request: &ExtensionLoadRequest) -> Option<PathBuf> {
        let candidates = self.candidates(request);
        for candidate in &candidates {
            if candidate.is_file() {
                return Some(candidate.clone());
            }
        }
        None
    }

    pub fn candidates(&self, request: &ExtensionLoadRequest) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        let requested = PathBuf::from(&request.path);
        if is_filesystem_path(&request.path) {
            candidates.push(absolutize_path(
                self.current_exe.parent().unwrap_or_else(|| Path::new(".")),
                requested,
            ));
        }

        let library_file_name = dynamic_library_file_name(&request.name);
        for path in &self.ext_paths {
            candidates.push(if path.extension().is_some() {
                path.clone()
            } else {
                path.join(&library_file_name)
            });
        }

        candidates.extend(self.request_package_candidates(request));
        candidates.extend(self.daemon_adjacent_candidates(request));

        if let Some(home_dir) = &self.home_dir {
            candidates.push(
                home_dir
                    .join(".opentray")
                    .join("extensions")
                    .join(&request.name)
                    .join(&library_file_name),
            );
            candidates.push(
                home_dir
                    .join(".opentray")
                    .join("extensions")
                    .join(format!("{}-{}", self.package_os, self.arch))
                    .join(&library_file_name),
            );
        }

        dedupe_paths(candidates)
    }

    fn request_package_candidates(&self, request: &ExtensionLoadRequest) -> Vec<PathBuf> {
        let Some(package_ref) = PackageRef::parse(&request.path) else {
            return Vec::new();
        };
        let platform_package = package_ref.platform_package(&self.package_os, &self.arch);
        let mut candidates = Vec::new();
        for root in &self.node_module_roots {
            candidates.push(
                platform_package
                    .path_in(root)
                    .join(dynamic_library_relative_path(&request.name)),
            );
            candidates.push(
                package_ref
                    .path_in(root)
                    .join("node_modules")
                    .join(platform_package.path())
                    .join(dynamic_library_relative_path(&request.name)),
            );
        }
        candidates
    }

    fn daemon_adjacent_candidates(&self, request: &ExtensionLoadRequest) -> Vec<PathBuf> {
        let Some(scope_dir) = package_family_dir(&self.current_exe) else {
            return Vec::new();
        };
        let platform_package = PackageRef::parse(&request.path)
            .map(|package_ref| package_ref.platform_package(&self.package_os, &self.arch))
            .unwrap_or_else(|| {
                PackageRef::scoped(
                    "@opentray".to_string(),
                    format!("ext-{}-{}-{}", request.name, self.package_os, self.arch),
                )
            });
        vec![scope_dir
            .join(platform_package.name)
            .join(dynamic_library_relative_path(&request.name))]
    }
}

#[cfg(test)]
fn validate_required_extension_symbols<'a>(
    symbols: impl IntoIterator<Item = &'a str>,
) -> Result<(), Vec<&'static str>> {
    let symbols = symbols.into_iter().collect::<HashSet<_>>();
    let missing = REQUIRED_EXTENSION_SYMBOLS
        .iter()
        .copied()
        .filter(|symbol| !symbols.contains(symbol))
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(missing)
    }
}

struct DynamicExtensionInstance {
    name: String,
    instance: *mut c_void,
    command: ExtCommandFn,
    session_closed: ExtSessionClosedFn,
    deinit: ExtDeinitFn,
    free_string: ExtFreeStringFn,
    _library: Library,
}

unsafe impl Send for DynamicExtensionInstance {}

impl DynamicExtensionInstance {
    unsafe fn load(
        request: &ExtensionLoadRequest,
        library_path: &Path,
    ) -> Result<Self, ExtensionError> {
        let library = unsafe { Library::new(library_path) }.map_err(|error| {
            ExtensionError::Unsupported(format!(
                "failed to load extension library {}: {error}",
                library_path.display()
            ))
        })?;

        let abi_version =
            unsafe { get_symbol::<ExtAbiVersionFn>(&library, EXT_SYMBOL_ABI_VERSION)? };
        let actual_abi = unsafe { abi_version() };
        if actual_abi != EXT_ABI_VERSION {
            return Err(ExtensionError::Unsupported(format!(
                "extension {} uses ABI version {actual_abi}; expected {EXT_ABI_VERSION}",
                request.name
            )));
        }

        let init = unsafe { get_symbol::<ExtInitFn>(&library, EXT_SYMBOL_INIT)? };
        let command = unsafe { get_symbol::<ExtCommandFn>(&library, EXT_SYMBOL_COMMAND)? };
        let session_closed =
            unsafe { get_symbol::<ExtSessionClosedFn>(&library, EXT_SYMBOL_SESSION_CLOSED)? };
        let deinit = unsafe { get_symbol::<ExtDeinitFn>(&library, EXT_SYMBOL_DEINIT)? };
        let free_string =
            unsafe { get_symbol::<ExtFreeStringFn>(&library, EXT_SYMBOL_FREE_STRING)? };

        let app_id = CString::new(request.app_id.as_str()).map_err(|error| {
            ExtensionError::Unsupported(format!("extension app id contains nul byte: {error}"))
        })?;
        // Init context is stable metadata only; host capabilities are per-call so
        // daemon-owned UI authority never escapes as a long-lived raw pointer.
        let context = ExtContext {
            api_version: EXT_API_VERSION,
            app_id: borrowed_bytes(&app_id),
        };
        let mut instance = ptr::null_mut();
        let result = unsafe { init(&context, &mut instance) };
        if result != EXT_OK || instance.is_null() {
            return Err(ExtensionError::Unsupported(format!(
                "extension {} init failed with code {result}",
                request.name
            )));
        }

        Ok(Self {
            name: request.instance_name().to_string(),
            instance,
            command,
            session_closed,
            deinit,
            free_string,
            _library: library,
        })
    }

    fn read_events(
        &self,
        output: ExtOwnedBytes,
        scope: Option<ExtensionScope>,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        if output.ptr.is_null() || output.len == 0 {
            return Ok(Vec::new());
        }

        let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) };
        let mut parsed =
            serde_json::from_slice::<Vec<ExtensionEnvelope>>(bytes).map_err(|error| {
                ExtensionError::Rejected(format!(
                    "extension {} returned invalid events JSON: {error}",
                    self.name
                ))
            })?;
        unsafe { (self.free_string)(output) };
        if let Some(scope) = scope {
            for event in &mut parsed {
                event.scope = scope.clone();
            }
        }
        Ok(parsed)
    }
}

impl ExtensionInstance for DynamicExtensionInstance {
    fn name(&self) -> &str {
        &self.name
    }

    fn command(
        &mut self,
        envelope: ExtensionEnvelope,
        host: &mut dyn CoreExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        let scope = envelope.scope.clone();
        let json = CString::new(serde_json::to_vec(&envelope).map_err(|error| {
            ExtensionError::Rejected(format!(
                "extension {} command JSON failed: {error}",
                self.name
            ))
        })?)
        .map_err(|error| {
            ExtensionError::Rejected(format!(
                "extension {} command JSON contains nul byte: {error}",
                self.name
            ))
        })?;
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        let mut host_context = HostCallContext { host };
        let ffi_host_context = host_context.as_ffi();
        let result = unsafe {
            (self.command)(
                self.instance,
                &ffi_host_context,
                borrowed_bytes(&json),
                &mut output,
            )
        };
        if result != EXT_OK {
            return Err(result_error(&self.name, result));
        }
        self.read_events(output, Some(scope))
    }

    fn session_closed(
        &mut self,
        session_id: &str,
        host: &mut dyn CoreExtensionHostContext,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        let session_id = CString::new(session_id).map_err(|error| {
            ExtensionError::Rejected(format!(
                "extension {} session id contains nul byte: {error}",
                self.name
            ))
        })?;
        let mut output = ExtOwnedBytes {
            ptr: ptr::null_mut(),
            len: 0,
        };
        let mut host_context = HostCallContext { host };
        let ffi_host_context = host_context.as_ffi();
        let result = unsafe {
            (self.session_closed)(
                self.instance,
                &ffi_host_context,
                borrowed_bytes(&session_id),
                &mut output,
            )
        };
        if result != EXT_OK {
            return Err(result_error(&self.name, result));
        }
        self.read_events(output, None)
    }
}

impl Drop for DynamicExtensionInstance {
    fn drop(&mut self) {
        if !self.instance.is_null() {
            unsafe { (self.deinit)(self.instance) };
            self.instance = ptr::null_mut();
        }
    }
}

unsafe fn get_symbol<T: Copy>(library: &Library, name: &str) -> Result<T, ExtensionError> {
    let symbol_name = format!("{name}\0");
    unsafe { library.get::<T>(symbol_name.as_bytes()) }
        .map(|symbol| *symbol)
        .map_err(|error| {
            ExtensionError::Unsupported(format!("extension missing symbol {name}: {error}"))
        })
}

fn result_error(name: &str, result: ExtResultCode) -> ExtensionError {
    match result {
        EXT_ERR_UNSUPPORTED => {
            ExtensionError::Unsupported(format!("extension {name} returned unsupported"))
        }
        EXT_ERR_INTERNAL => {
            ExtensionError::Rejected(format!("extension {name} returned internal error"))
        }
        other => ExtensionError::Rejected(format!("extension {name} returned code {other}")),
    }
}

fn borrowed_bytes(value: &CString) -> ExtBytes {
    ExtBytes {
        ptr: value.as_ptr(),
        len: value.as_bytes().len(),
    }
}

struct HostCallContext<'a> {
    host: &'a mut dyn CoreExtensionHostContext,
}

impl HostCallContext<'_> {
    fn as_ffi(&mut self) -> ExtHostContext {
        // This callback table is the only ABI bridge from extension atoms into
        // daemon-owned capabilities such as the native WebView event loop.
        ExtHostContext {
            host_data: (self as *mut HostCallContext<'_>).cast::<c_void>(),
            send_event: send_event,
            get_rect: get_rect,
            invoke_host: invoke_host,
            free_host_string: free_host_string,
        }
    }
}

extern "C" fn send_event(host_data: *mut c_void, event_json: ExtBytes) -> ExtResultCode {
    let Some(context) = (unsafe { host_context_from_ptr(host_data) }) else {
        return EXT_ERR_REJECTED;
    };
    let Some(bytes) = (unsafe { ext_bytes_as_slice(event_json) }) else {
        return EXT_ERR_REJECTED;
    };
    match context.host.send_event(bytes) {
        Ok(()) => EXT_OK,
        Err(error) => extension_error_code(error),
    }
}

extern "C" fn get_rect(host_data: *mut c_void, out: *mut Rect) -> ExtResultCode {
    if out.is_null() {
        return EXT_ERR_REJECTED;
    }
    let Some(context) = (unsafe { host_context_from_ptr(host_data) }) else {
        return EXT_ERR_REJECTED;
    };
    match context.host.tray_bounds() {
        Ok(Some(rect)) => {
            unsafe {
                *out = rect;
            }
            EXT_OK
        }
        Ok(None) => EXT_ERR_UNSUPPORTED,
        Err(error) => extension_error_code(error),
    }
}

extern "C" fn invoke_host(
    host_data: *mut c_void,
    capability: ExtBytes,
    request_json: ExtBytes,
    out_response_json: *mut ExtOwnedBytes,
) -> ExtResultCode {
    let Some(context) = (unsafe { host_context_from_ptr(host_data) }) else {
        return EXT_ERR_REJECTED;
    };
    let Some(capability) = (unsafe { ext_bytes_as_slice(capability) })
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
    else {
        return EXT_ERR_REJECTED;
    };
    let Some(request_json) = (unsafe { ext_bytes_as_slice(request_json) }) else {
        return EXT_ERR_REJECTED;
    };

    match context.host.invoke_host(capability, request_json) {
        Ok(response) => write_host_response(out_response_json, &response),
        Err(error) => extension_error_code(error),
    }
}

extern "C" fn free_host_string(_host_data: *mut c_void, bytes: ExtOwnedBytes) {
    if !bytes.ptr.is_null() {
        drop(unsafe { CString::from_raw(bytes.ptr) });
    }
}

unsafe fn host_context_from_ptr<'a>(host_data: *mut c_void) -> Option<&'a mut HostCallContext<'a>> {
    if host_data.is_null() {
        return None;
    }
    Some(unsafe { &mut *host_data.cast::<HostCallContext<'a>>() })
}

unsafe fn ext_bytes_as_slice<'a>(bytes: ExtBytes) -> Option<&'a [u8]> {
    if bytes.ptr.is_null() {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(bytes.ptr.cast::<u8>(), bytes.len) })
}

fn write_host_response(out: *mut ExtOwnedBytes, response: &[u8]) -> ExtResultCode {
    if out.is_null() {
        return EXT_ERR_REJECTED;
    }
    if response.is_empty() {
        unsafe {
            *out = ExtOwnedBytes {
                ptr: ptr::null_mut(),
                len: 0,
            };
        }
        return EXT_OK;
    }
    let Ok(value) = CString::new(response) else {
        return EXT_ERR_REJECTED;
    };
    let len = value.as_bytes().len();
    unsafe {
        *out = ExtOwnedBytes {
            ptr: value.into_raw(),
            len,
        };
    }
    EXT_OK
}

fn extension_error_code(error: ExtensionError) -> ExtResultCode {
    match error {
        ExtensionError::Unsupported(_) => EXT_ERR_UNSUPPORTED,
        ExtensionError::NotFound(_) | ExtensionError::Rejected(_) => EXT_ERR_REJECTED,
    }
}

fn package_family_dir(current_exe: &Path) -> Option<PathBuf> {
    let package_dir = current_exe.parent()?.parent()?;
    package_dir.parent().map(Path::to_path_buf)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PackageRef {
    scope: Option<String>,
    name: String,
}

impl PackageRef {
    fn parse(value: &str) -> Option<Self> {
        if is_filesystem_path(value) {
            return None;
        }
        if value.starts_with('@') {
            let mut parts = value.split('/');
            let scope = parts.next()?;
            let name = parts.next()?;
            if scope.len() <= 1 || name.is_empty() {
                return None;
            }
            return Some(Self::scoped(scope.to_string(), name.to_string()));
        }
        let name = value.split('/').next()?;
        if name.is_empty() {
            None
        } else {
            Some(Self {
                scope: None,
                name: name.to_string(),
            })
        }
    }

    fn scoped(scope: String, name: String) -> Self {
        Self {
            scope: Some(scope),
            name,
        }
    }

    fn platform_package(&self, package_os: &str, arch: &str) -> Self {
        Self {
            scope: self.scope.clone(),
            name: format!("{}-{package_os}-{arch}", self.name),
        }
    }

    fn path(&self) -> PathBuf {
        match &self.scope {
            Some(scope) => PathBuf::from(scope).join(&self.name),
            None => PathBuf::from(&self.name),
        }
    }

    fn path_in(&self, node_modules_root: &Path) -> PathBuf {
        node_modules_root.join(self.path())
    }
}

fn collect_node_module_roots(
    current_dir: &Path,
    current_exe: &Path,
    cli_entrypoint: Option<&Path>,
    node_path: Option<OsString>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    roots.push(current_dir.join("node_modules"));
    roots.extend(ancestor_node_modules(current_dir));
    if let Some(cli_entrypoint) = cli_entrypoint {
        roots.extend(ancestor_node_modules(cli_entrypoint));
    }
    roots.extend(ancestor_node_modules(current_exe));
    if let Some(node_path) = node_path {
        roots.extend(env::split_paths(&node_path).map(|path| absolutize_path(current_dir, path)));
    }
    dedupe_paths(roots)
}

fn ancestor_node_modules(path: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut current = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };

    loop {
        if current.file_name().and_then(|name| name.to_str()) == Some("node_modules") {
            roots.push(current.to_path_buf());
        }
        let candidate = current.join("node_modules");
        if candidate.is_dir() {
            roots.push(candidate);
        }

        let Some(parent) = current.parent() else {
            break;
        };
        if parent == current {
            break;
        }
        current = parent;
    }

    roots
}

fn is_filesystem_path(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with("./")
        || path.starts_with("../")
        || path.contains('\\')
        || Path::new(path).extension().is_some()
}

fn dynamic_library_relative_path(extension_name: &str) -> PathBuf {
    let file = dynamic_library_file_name(extension_name);
    if cfg!(target_os = "windows") {
        PathBuf::from("bin").join(file)
    } else {
        PathBuf::from("lib").join(file)
    }
}

fn dynamic_library_file_name(extension_name: &str) -> String {
    let stem = format!("opentray_ext_{}", normalize_extension_name(extension_name));
    if cfg!(target_os = "windows") {
        format!("{stem}.dll")
    } else if cfg!(target_os = "macos") {
        format!("lib{stem}.dylib")
    } else {
        format!("lib{stem}.so")
    }
}

fn normalize_extension_name(name: &str) -> String {
    name.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    for path in paths {
        if seen.insert(path.clone()) {
            output.push(path);
        }
    }
    output
}

fn absolutize_path(base_dir: &Path, path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        base_dir.join(path)
    }
}

fn current_package_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_required_symbols_as_a_single_abi_gate() {
        assert!(
            validate_required_extension_symbols(REQUIRED_EXTENSION_SYMBOLS.iter().copied()).is_ok()
        );

        let missing = validate_required_extension_symbols([
            EXT_SYMBOL_ABI_VERSION,
            EXT_SYMBOL_INIT,
            EXT_SYMBOL_COMMAND,
        ])
        .unwrap_err();

        assert!(missing.contains(&EXT_SYMBOL_SESSION_CLOSED));
        assert!(missing.contains(&EXT_SYMBOL_DEINIT));
    }

    #[test]
    fn discovery_prefers_package_adjacent_platform_library() {
        let discovery = ExtensionDiscovery::for_test(
            PathBuf::from("/app/node_modules/@opentray/darwin-arm64/bin/opentray"),
            None,
            Vec::new(),
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: "@opentray/ext-webview".to_string(),
            mount_id: None,
        };

        let candidates = discovery.candidates(&request);

        assert_eq!(
            candidates[0],
            PathBuf::from("/app/node_modules/@opentray").join(format!(
                "ext-webview-{}-{}/{}",
                current_package_os(),
                current_arch(),
                dynamic_library_relative_path("webview").display()
            ))
        );
    }

    #[test]
    fn discovery_resolves_badge_platform_library_from_package_candidates() {
        let discovery = ExtensionDiscovery::for_test(
            PathBuf::from("/app/node_modules/@opentray/darwin-arm64/bin/opentray"),
            None,
            Vec::new(),
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "badge".to_string(),
            path: "@opentray/ext-badge".to_string(),
            mount_id: None,
        };

        let candidates = discovery.candidates(&request);

        assert_eq!(
            candidates[0],
            PathBuf::from("/app/node_modules/@opentray").join(format!(
                "ext-badge-{}-{}/{}",
                current_package_os(),
                current_arch(),
                dynamic_library_relative_path("badge").display()
            ))
        );
    }

    #[test]
    fn discovery_prefers_explicit_extension_path_over_package_candidates() {
        let discovery = ExtensionDiscovery::for_test_with_node_module_roots(
            PathBuf::from("/app/node_modules/.pnpm/opentray@0.2.0/node_modules/@opentray/darwin-arm64/bin/opentray"),
            None,
            vec![PathBuf::from("/local/libopentray_ext_webview.dylib")],
            vec![PathBuf::from("/app/node_modules/.pnpm/opentray@0.2.0/node_modules")],
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: "@opentray/ext-webview".to_string(),
            mount_id: None,
        };

        let candidates = discovery.candidates(&request);

        assert_eq!(
            candidates[0],
            PathBuf::from("/local/libopentray_ext_webview.dylib")
        );
    }

    #[test]
    fn discovery_resolves_platform_library_from_request_package_roots() {
        let discovery = ExtensionDiscovery::for_test_with_node_module_roots(
            PathBuf::from("/app/node_modules/@opentray/darwin-arm64/bin/opentray"),
            None,
            Vec::new(),
            vec![
                PathBuf::from("/app/node_modules/.pnpm/opentray@0.2.0/node_modules"),
                PathBuf::from("/app/node_modules"),
            ],
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: "@opentray/ext-webview".to_string(),
            mount_id: None,
        };

        let candidates = discovery.candidates(&request);

        assert_eq!(
            candidates[0],
            PathBuf::from(format!(
                "/app/node_modules/.pnpm/opentray@0.2.0/node_modules/@opentray/ext-webview-{}-{}/{}",
                current_package_os(),
                current_arch(),
                dynamic_library_relative_path("webview").display()
            ))
        );
        assert!(candidates.iter().any(|path| {
            path.starts_with(format!(
                "/app/node_modules/.pnpm/opentray@0.2.0/node_modules/@opentray/ext-webview/node_modules/@opentray/ext-webview-{}-{}",
                current_package_os(),
                current_arch()
            ))
        }));
    }

    #[test]
    fn discovery_prefers_top_level_platform_package_over_facade_nested_dependency() {
        let discovery = ExtensionDiscovery::for_test_with_node_module_roots(
            PathBuf::from("/workspace/app/node_modules/.pnpm/opentray@0.2.0/node_modules/@opentray/darwin-arm64/bin/opentray"),
            None,
            Vec::new(),
            vec![PathBuf::from("/workspace/app/node_modules")],
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: "@opentray/ext-webview".to_string(),
            mount_id: None,
        };

        let candidates = discovery.candidates(&request);

        assert_eq!(
            candidates[0],
            PathBuf::from(format!(
                "/workspace/app/node_modules/@opentray/ext-webview-{}-{}/{}",
                current_package_os(),
                current_arch(),
                dynamic_library_relative_path("webview").display()
            ))
        );
        assert_eq!(
            candidates[1],
            PathBuf::from("/workspace/app/node_modules/@opentray/ext-webview")
                .join("node_modules")
                .join(format!(
                    "@opentray/ext-webview-{}-{}/{}",
                    current_package_os(),
                    current_arch(),
                    dynamic_library_relative_path("webview").display()
                ))
        );
    }

    #[test]
    fn collect_node_module_roots_prefers_current_project_over_cli_virtual_store() {
        let roots = collect_node_module_roots(
            Path::new("/workspace/app"),
            Path::new("/workspace/app/node_modules/.pnpm/opentray@0.2.0/node_modules/@opentray/darwin-arm64/bin/opentray"),
            None,
            None,
        );

        assert_eq!(roots[0], PathBuf::from("/workspace/app/node_modules"));
        assert!(roots.iter().any(|root| root
            == &PathBuf::from("/workspace/app/node_modules/.pnpm/opentray@0.2.0/node_modules")));
    }

    #[test]
    fn package_ref_parses_scoped_and_plain_packages() {
        assert_eq!(
            PackageRef::parse("@opentray/ext-webview").unwrap().path(),
            PathBuf::from("@opentray").join("ext-webview")
        );
        assert_eq!(
            PackageRef::parse("plain-package").unwrap().path(),
            PathBuf::from("plain-package")
        );
        assert_eq!(PackageRef::parse("./libext.dylib"), None);
    }

    #[test]
    fn discovery_includes_env_and_user_config_candidates() {
        let discovery = ExtensionDiscovery::for_test(
            PathBuf::from("/repo/target/debug/opentray"),
            Some(PathBuf::from("/home/me")),
            vec![PathBuf::from("/extensions"), PathBuf::from("/repo/exts")],
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: "@opentray/ext-webview".to_string(),
            mount_id: None,
        };

        let candidates = discovery.candidates(&request);

        assert!(candidates
            .iter()
            .any(|path| path.starts_with("/extensions")));
        assert!(candidates.iter().any(|path| path.starts_with("/repo/exts")));
        assert!(candidates
            .iter()
            .any(|path| path.starts_with("/home/me/.opentray/extensions/webview")));
    }

    #[test]
    fn relative_paths_are_normalized_against_base_directory() {
        assert_eq!(
            absolutize_path(Path::new("/repo"), PathBuf::from("extensions")),
            PathBuf::from("/repo/extensions")
        );
        assert_eq!(
            absolutize_path(Path::new("/repo"), PathBuf::from("/extensions")),
            PathBuf::from("/extensions")
        );
    }
}
