use std::{
    collections::HashSet,
    env,
    ffi::{c_void, CString},
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
    EmbeddedExtensionManifest, ExpectedExtensionIdentity, ExtBytes, ExtContext, ExtHostContext,
    ExtOwnedBytes, ExtResultCode, ExtensionEnvelope, ExtensionErrorDetail, ExtensionScope, Rect,
    EXT_ABI_VERSION, EXT_API_VERSION, EXT_ERR_INTERNAL, EXT_ERR_REJECTED, EXT_ERR_UNSUPPORTED,
    EXT_OK, EXT_SYMBOL_ABI_VERSION, EXT_SYMBOL_COMMAND, EXT_SYMBOL_DEINIT, EXT_SYMBOL_FREE_STRING,
    EXT_SYMBOL_INIT, EXT_SYMBOL_MANIFEST, EXT_SYMBOL_SESSION_CLOSED, EXT_SYMBOL_TAKE_ERROR,
};

type ExtAbiVersionFn = unsafe extern "C" fn() -> u32;
type ExtManifestFn = unsafe extern "C" fn(out_manifest_json: *mut ExtOwnedBytes) -> ExtResultCode;
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
type ExtFreeStringFn = unsafe extern "C" fn(ptr: *mut std::ffi::c_char, len: usize);
type ExtTakeErrorFn = unsafe extern "C" fn(out_error_json: *mut ExtOwnedBytes) -> ExtResultCode;

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
        load_candidate_paths(
            request,
            self.discovery.candidates(request),
            |library_path| {
                let instance = unsafe { DynamicExtensionInstance::load(request, library_path)? };
                Ok(Box::new(instance) as Box<dyn ExtensionInstance>)
            },
        )
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
    home_dir: Option<PathBuf>,
    ext_paths: Vec<PathBuf>,
    package_os: String,
    arch: String,
}

impl ExtensionDiscovery {
    pub fn from_env() -> Result<Self, ExtensionError> {
        let current_dir = env::current_dir().map_err(|error| {
            ExtensionError::Unsupported(format!("cannot resolve current directory: {error}"))
        })?;
        Ok(Self {
            home_dir: env::var_os("OPENTRAY_DAEMON_HOME").map(PathBuf::from),
            ext_paths: env::var_os("OPENTRAY_EXT_PATH")
                .map(|value| {
                    env::split_paths(&value)
                        .map(|path| absolutize_path(&current_dir, path))
                        .collect()
                })
                .unwrap_or_default(),
            package_os: current_package_os().to_string(),
            arch: current_arch().to_string(),
        })
    }

    #[cfg(test)]
    fn for_test(home_dir: Option<PathBuf>, ext_paths: Vec<PathBuf>) -> Self {
        Self {
            home_dir,
            ext_paths,
            package_os: current_package_os().to_string(),
            arch: current_arch().to_string(),
        }
    }

    pub fn candidates(&self, request: &ExtensionLoadRequest) -> Vec<PathBuf> {
        let requested = PathBuf::from(&request.path);
        if requested.is_absolute() {
            // A package facade already resolved this file from its own dependency closure.
            // Falling back here would let stale diagnostic or package paths shadow it again.
            return vec![requested];
        }

        let mut candidates = Vec::new();
        let library_file_name = dynamic_library_file_name(&request.name);
        for path in &self.ext_paths {
            candidates.push(if path.extension().is_some() {
                path.clone()
            } else {
                path.join(&library_file_name)
            });
        }

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
}

fn load_candidate_paths<F>(
    request: &ExtensionLoadRequest,
    candidates: Vec<PathBuf>,
    mut load: F,
) -> Result<Option<Box<dyn ExtensionInstance>>, ExtensionError>
where
    F: FnMut(&Path) -> Result<Box<dyn ExtensionInstance>, ExtensionError>,
{
    let exact_path = PathBuf::from(&request.path).is_absolute();
    let mut rejected = Vec::new();
    for candidate in candidates {
        match std::fs::metadata(&candidate) {
            Ok(metadata) if metadata.is_file() => {}
            Ok(_) => {
                rejected.push(format!("{}: unreadable (not a file)", candidate.display()));
                continue;
            }
            Err(error) => {
                let category = if error.kind() == std::io::ErrorKind::NotFound {
                    "missing"
                } else {
                    "unreadable"
                };
                rejected.push(format!("{}: {category} ({error})", candidate.display()));
                continue;
            }
        }

        match load(&candidate) {
            Ok(instance) => return Ok(Some(instance)),
            Err(error) if exact_path => return Err(error),
            Err(error) => rejected.push(format!(
                "{}: {} ({error})",
                candidate.display(),
                candidate_error_category(&error),
            )),
        }
    }

    if rejected.is_empty() {
        return Ok(None);
    }
    Err(ExtensionError::Unsupported(format!(
        "extension {} diagnostic candidates were rejected: {}",
        request.name,
        rejected.join("; "),
    )))
}

fn candidate_error_category(error: &ExtensionError) -> &'static str {
    match error {
        ExtensionError::Detailed { category, .. } if category == "artifact_identity_mismatch" => {
            "identity-incompatible"
        }
        ExtensionError::Unsupported(message)
            if message.contains("missing symbol") || message.contains("ABI version") =>
        {
            "abi-incompatible"
        }
        ExtensionError::NotFound(_) => "missing",
        ExtensionError::Rejected(_) | ExtensionError::Detailed { .. } => "rejected",
        ExtensionError::Unsupported(_) => "unreadable",
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
    take_error: ExtTakeErrorFn,
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

        let free_string =
            unsafe { get_symbol::<ExtFreeStringFn>(&library, EXT_SYMBOL_FREE_STRING)? };
        let take_error = unsafe { get_symbol::<ExtTakeErrorFn>(&library, EXT_SYMBOL_TAKE_ERROR)? };
        let manifest = unsafe { get_symbol::<ExtManifestFn>(&library, EXT_SYMBOL_MANIFEST)? };
        let mut manifest_output = empty_owned_bytes();
        let manifest_result = unsafe { manifest(&mut manifest_output) };
        if manifest_result != EXT_OK {
            return Err(result_error(
                &request.name,
                manifest_result,
                take_error,
                free_string,
            ));
        }
        let actual_manifest = unsafe {
            read_owned_json::<EmbeddedExtensionManifest>(
                manifest_output,
                free_string,
                "extension manifest",
            )?
        };
        // Identity validation is deliberately complete before init creates native state.
        validate_extension_manifest(&request.expected_identity, &actual_manifest)?;

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
            return Err(result_error(&request.name, result, take_error, free_string));
        }

        Ok(Self {
            name: request.instance_name().to_string(),
            instance,
            command,
            session_closed,
            deinit,
            free_string,
            take_error,
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

        let bytes =
            unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) }.to_vec();
        unsafe { (self.free_string)(output.ptr, output.len) };
        let mut parsed =
            serde_json::from_slice::<Vec<ExtensionEnvelope>>(&bytes).map_err(|error| {
                ExtensionError::Rejected(format!(
                    "extension {} returned invalid events JSON: {error}",
                    self.name
                ))
            })?;
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
            return Err(result_error(
                &self.name,
                result,
                self.take_error,
                self.free_string,
            ));
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
            return Err(result_error(
                &self.name,
                result,
                self.take_error,
                self.free_string,
            ));
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

fn result_error(
    name: &str,
    result: ExtResultCode,
    take_error: ExtTakeErrorFn,
    free_string: ExtFreeStringFn,
) -> ExtensionError {
    if let Some(detail) = take_extension_error(take_error, free_string) {
        return ExtensionError::Detailed {
            category: detail.category,
            message: detail.message,
        };
    }
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

fn take_extension_error(
    take_error: ExtTakeErrorFn,
    free_string: ExtFreeStringFn,
) -> Option<ExtensionErrorDetail> {
    let mut output = empty_owned_bytes();
    if unsafe { take_error(&mut output) } != EXT_OK {
        return None;
    }
    unsafe {
        read_owned_json(output, free_string, "extension error")
            .ok()
            .filter(|detail: &ExtensionErrorDetail| {
                !detail.category.is_empty() && !detail.message.is_empty()
            })
    }
}

unsafe fn read_owned_json<T: serde::de::DeserializeOwned>(
    output: ExtOwnedBytes,
    free_string: ExtFreeStringFn,
    label: &str,
) -> Result<T, ExtensionError> {
    if output.ptr.is_null() || output.len == 0 {
        return Err(ExtensionError::Rejected(format!(
            "{label} returned no JSON"
        )));
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) }.to_vec();
    unsafe { free_string(output.ptr, output.len) };
    serde_json::from_slice(&bytes).map_err(|error| {
        ExtensionError::Rejected(format!("{label} returned invalid JSON: {error}"))
    })
}

fn empty_owned_bytes() -> ExtOwnedBytes {
    ExtOwnedBytes {
        ptr: ptr::null_mut(),
        len: 0,
    }
}

fn validate_extension_manifest(
    expected: &ExpectedExtensionIdentity,
    actual: &EmbeddedExtensionManifest,
) -> Result<(), ExtensionError> {
    let identity_matches = actual.abi_version == EXT_ABI_VERSION
        && actual.extension_name == expected.extension_name
        && actual.artifact_set_version == expected.artifact_set_version
        && actual.contract_fingerprint == expected.contract_fingerprint
        && actual.target == expected.target
        && !actual.build_identity.is_empty();
    if identity_matches {
        return Ok(());
    }
    Err(ExtensionError::Detailed {
        category: "artifact_identity_mismatch".to_string(),
        message: format!(
            "expected={}; actual={}",
            serde_json::to_string(expected).unwrap_or_else(|_| "<unserializable>".to_string()),
            serde_json::to_string(actual).unwrap_or_else(|_| "<unserializable>".to_string())
        ),
    })
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
        ExtensionError::NotFound(_)
        | ExtensionError::Rejected(_)
        | ExtensionError::Detailed { .. } => EXT_ERR_REJECTED,
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
    use opentray_core::RecordingExtension;

    fn expected_extension_identity(
        extension_name: &str,
    ) -> opentray_spec::ExpectedExtensionIdentity {
        opentray_spec::ExpectedExtensionIdentity {
            extension_name: extension_name.to_string(),
            artifact_set_version: "current".to_string(),
            contract_fingerprint: "current-contract".to_string(),
            target: opentray_spec::ExtensionArtifactTarget {
                os: "darwin".to_string(),
                arch: "arm64".to_string(),
            },
        }
    }

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
        assert!(missing.contains(&"opentray_ext_manifest"));
        assert!(missing.contains(&"opentray_ext_take_error"));
    }

    #[test]
    fn rejects_a_mismatched_manifest_with_expected_and_actual_evidence() {
        let expected = expected_extension_identity("webview");
        let actual = opentray_spec::EmbeddedExtensionManifest {
            extension_name: "webview".to_string(),
            abi_version: EXT_ABI_VERSION,
            artifact_set_version: "old".to_string(),
            contract_fingerprint: "old-contract".to_string(),
            target: expected.target.clone(),
            build_identity: "old-build".to_string(),
        };

        let error = validate_extension_manifest(&expected, &actual).unwrap_err();

        let message = error.to_string();
        assert!(message.contains("current"));
        assert!(message.contains("old"));
        assert!(message.contains("old-build"));
    }

    #[test]
    fn exact_request_never_falls_back_to_diagnostic_candidates() {
        let discovery = ExtensionDiscovery::for_test(
            Some(PathBuf::from("/home/me")),
            vec![PathBuf::from("/diagnostic/libopentray_ext_webview.dylib")],
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: "/facade/current/libopentray_ext_webview.dylib".to_string(),
            expected_identity: expected_extension_identity("webview"),
            mount_id: None,
        };

        assert_eq!(
            discovery.candidates(&request),
            vec![PathBuf::from(
                "/facade/current/libopentray_ext_webview.dylib"
            )]
        );
    }

    #[test]
    fn diagnostic_request_includes_only_explicit_and_user_candidates() {
        let discovery = ExtensionDiscovery::for_test(
            Some(PathBuf::from("/home/me")),
            vec![PathBuf::from("/extensions"), PathBuf::from("/repo/exts")],
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: "diagnostic".to_string(),
            expected_identity: expected_extension_identity("webview"),
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
        assert!(candidates
            .iter()
            .all(|path| !path.to_string_lossy().contains("node_modules")));
    }

    #[test]
    fn diagnostic_candidates_continue_after_a_rejected_artifact() {
        let root = std::env::temp_dir().join(format!(
            "opentray-extension-candidates-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let first = root.join("old.dylib");
        let second = root.join("current.dylib");
        std::fs::write(&first, b"old").unwrap();
        std::fs::write(&second, b"current").unwrap();
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: "diagnostic".to_string(),
            expected_identity: expected_extension_identity("webview"),
            mount_id: None,
        };
        let mut attempts = Vec::new();

        let result = load_candidate_paths(&request, vec![first.clone(), second.clone()], |path| {
            attempts.push(path.to_path_buf());
            if path == first {
                return Err(ExtensionError::Detailed {
                    category: "artifact_identity_mismatch".to_string(),
                    message: "old candidate".to_string(),
                });
            }
            Ok(Box::new(RecordingExtension::new("webview")) as Box<dyn ExtensionInstance>)
        })
        .unwrap();

        assert!(result.is_some());
        assert_eq!(attempts, vec![first.clone(), second.clone()]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn exact_candidate_rejection_does_not_fall_back() {
        let root =
            std::env::temp_dir().join(format!("opentray-exact-candidate-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let exact = root.join("current.dylib");
        let fallback = root.join("fallback.dylib");
        std::fs::write(&exact, b"exact").unwrap();
        std::fs::write(&fallback, b"fallback").unwrap();
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: exact.to_string_lossy().to_string(),
            expected_identity: expected_extension_identity("webview"),
            mount_id: None,
        };
        let mut attempts = Vec::new();

        let result = load_candidate_paths(&request, vec![exact.clone(), fallback], |path| {
            attempts.push(path.to_path_buf());
            Err(ExtensionError::Detailed {
                category: "artifact_identity_mismatch".to_string(),
                message: "exact candidate".to_string(),
            })
        });
        let error = match result {
            Ok(_) => panic!("exact candidate unexpectedly loaded"),
            Err(error) => error,
        };

        assert!(error.to_string().contains("exact candidate"));
        assert_eq!(attempts, vec![exact]);
        std::fs::remove_dir_all(root).unwrap();
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
