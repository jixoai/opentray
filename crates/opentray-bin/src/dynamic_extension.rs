// Orthogonal intents (maintained 2026-09-17; original user requests:
// load dynamic extension libraries through a validated identity chain and
// let long-running commands answer through the frozen DeferredOperation
// disposition ABI):
// 1. Verify artifact identity (optional expected sha256 before dlopen, the
//    native embedded manifest between dlopen and init) before any native
//    state exists.
// 2. Resolve the four-cell command-surface matrix by probing both command
//    symbols; dispatch through V2 whenever it exists, keep V1-only
//    libraries always-Immediate, and reject a library exporting neither.
// 3. Seed the broker-issued handle into the disposition struct (one-way,
//    single-use delivery) and classify the returned disposition without
//    guessing semantics.
// 4. Attach the optional EventPort and DeferredPort capabilities by value;
//    every load failure deinits deterministically and revokes what it
//    reserved.
// Compromise: this module is the single dynamic-hosting composition point,
// so loader probing, identity gating, and disposition dispatch cannot be
// physically separated without splitting one C ABI consumer across crates.

use std::{
    collections::HashSet,
    env,
    ffi::{c_void, CString},
    path::{Path, PathBuf},
    ptr,
};

use libloading::Library;
use opentray_core::{
    ExtensionCommandDisposition, ExtensionError, ExtensionHostContext as CoreExtensionHostContext,
    ExtensionInstance, ExtensionLoadRequest, ExtensionLoader, IssuedOperation,
};
#[cfg(test)]
use opentray_spec::REQUIRED_EXTENSION_SYMBOLS;
use opentray_spec::{
    EmbeddedExtensionManifest, ExpectedExtensionIdentity, ExtAttachDeferredPortV1Fn,
    ExtAttachEventPortV1Fn, ExtCommandDispositionV1, ExtBytes, ExtContext, ExtEventPortV1,
    ExtHostContext, ExtOwnedBytes, ExtResultCode, ExtensionEnvelope, ExtensionErrorDetail,
    ExtensionScope, Rect, EXT_ABI_VERSION, EXT_API_VERSION, EXT_COMMAND_DISPOSITION_TAG_DEFERRED,
    EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE, EXT_ERR_INTERNAL, EXT_ERR_REJECTED, EXT_ERR_UNSUPPORTED,
    EXT_EVENT_PORT_ABI_V1, EXT_OK, EXT_SYMBOL_ABI_VERSION, EXT_SYMBOL_ATTACH_DEFERRED_PORT_V1,
    EXT_SYMBOL_ATTACH_EVENT_PORT_V1, EXT_SYMBOL_COMMAND, EXT_SYMBOL_COMMAND_V2, EXT_SYMBOL_DEINIT,
    EXT_SYMBOL_FREE_STRING, EXT_SYMBOL_INIT, EXT_SYMBOL_MANIFEST, EXT_SYMBOL_SESSION_CLOSED,
    EXT_SYMBOL_TAKE_ERROR,
};
use sha2::{Digest, Sha256};

use crate::deferred_port::{
    validate_deferred_port, DeferredPortHandle, DeferredPortHub, DeferredPortValidationError,
};
use crate::event_hub::{EventHub, SourceHandle, SourceLimitReached};

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
/// DeferredOperation command entry (design section 5.1 frozen signature): the extension
/// reads the broker-issued handle from the pre-seeded disposition and
/// answers with its own disposition.
type ExtCommandV2Fn = unsafe extern "C" fn(
    instance: *mut c_void,
    context: *const ExtHostContext,
    envelope_json: ExtBytes,
    out_events_json: *mut ExtOwnedBytes,
    out_disposition: *mut ExtCommandDispositionV1,
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

const ABI_INCOMPATIBLE_CATEGORY: &str = "abi_incompatible";
const ARTIFACT_IDENTITY_MISMATCH_CATEGORY: &str = "artifact_identity_mismatch";
const EVENT_PORT_ABI_INCOMPATIBLE_CATEGORY: &str = "event_port_abi_incompatible";
const EVENT_PORT_SOURCE_LIMIT_CATEGORY: &str = "event_port_source_limit";
const EVENT_PORT_UNSUPPORTED_CATEGORY: &str = "event_port_unsupported";
const DEFERRED_PORT_ABI_INCOMPATIBLE_CATEGORY: &str = "deferred_port_abi_incompatible";
const DEFERRED_PORT_UNSUPPORTED_CATEGORY: &str = "deferred_port_unsupported";

/// Delivery capability observed for one load. Recorded on the hub as
/// capability diagnostics so direct EventPort delivery is distinguishable
/// from legacy response flushing without inferring it from package versions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PortCapability {
    DirectEventPort,
    LegacyFlush,
}

impl PortCapability {
    fn diagnostic_label(self) -> &'static str {
        match self {
            PortCapability::DirectEventPort => "direct-event-port",
            PortCapability::LegacyFlush => "legacy-flush",
        }
    }
}

/// The four-cell command-surface matrix (design section 5.1, R6 P1-4 frozen). The loader
/// probes both symbols and dispatches through V2 whenever it exists; a
/// V1-only library is never called with the V2 signature (no UB) and is
/// permanently Immediate; neither symbol is an `abi_incompatible` load
/// rejection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommandSurfaceCell {
    /// Only `opentray_ext_command_v2`: full capability; the legacy symbol is
    /// not required.
    V2Only,
    /// Only `opentray_ext_command`: always Immediate, no deferred channel.
    V1Only,
    /// Both symbols: V2 wins, the legacy symbol is ignored.
    BothUseV2,
    /// Neither symbol: `abi_incompatible`.
    None,
}

impl CommandSurfaceCell {
    fn diagnostic_label(self) -> &'static str {
        match self {
            CommandSurfaceCell::V2Only | CommandSurfaceCell::BothUseV2 => "v2",
            CommandSurfaceCell::V1Only => "no-deferred",
            CommandSurfaceCell::None => "missing",
        }
    }
}

fn classify_command_surface(has_v2: bool, has_v1: bool) -> CommandSurfaceCell {
    match (has_v2, has_v1) {
        (true, true) => CommandSurfaceCell::BothUseV2,
        (true, false) => CommandSurfaceCell::V2Only,
        (false, true) => CommandSurfaceCell::V1Only,
        (false, false) => CommandSurfaceCell::None,
    }
}

/// Typed capability gate for a Deferred disposition (review P1-3): deferring
/// is only expressible for instances that attached the deferred completion
/// port, because the port submit is the one legal terminal channel. A
/// portless V2 instance that answers Deferred would strand the operation
/// forever; this rejection surfaces immediately with the frozen
/// `deferred_port_unsupported` category.
fn ensure_deferred_channel(has_port: bool, name: &str) -> Result<(), ExtensionError> {
    if has_port {
        return Ok(());
    }
    Err(ExtensionError::Detailed {
        category: DEFERRED_PORT_UNSUPPORTED_CATEGORY.to_string(),
        message: format!(
            "extension {name} answered Deferred without attaching the deferred completion port: \
             no terminal channel exists, so the operation cannot be accepted"
        ),
        details: None,
    })
}

/// The resolved command entry of one loaded library.
#[derive(Debug, Clone, Copy)]
enum CommandSurface {
    V2(ExtCommandV2Fn),
    V1(ExtCommandFn),
}

#[derive(Debug, Clone)]
pub struct DynamicExtensionLoader {
    discovery: ExtensionDiscovery,
    hub: EventHub,
    deferred: DeferredPortHub,
}

impl DynamicExtensionLoader {
    /// The loader receives the broker EventHub and DeferredPortHub from
    /// runtime composition; it never exposes either to core.
    pub fn from_env(hub: EventHub, deferred: DeferredPortHub) -> Result<Self, ExtensionError> {
        Ok(Self {
            discovery: ExtensionDiscovery::from_env()?,
            hub,
            deferred,
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
                let instance = unsafe {
                    DynamicExtensionInstance::load(&self.hub, &self.deferred, request, library_path)?
                };
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
        ExtensionError::Detailed { category, .. }
            if category == ARTIFACT_IDENTITY_MISMATCH_CATEGORY =>
        {
            "identity-incompatible"
        }
        ExtensionError::Detailed { category, .. } if category == ABI_INCOMPATIBLE_CATEGORY => {
            "abi-incompatible"
        }
        ExtensionError::NotFound(_) => "missing",
        ExtensionError::Rejected(_)
        | ExtensionError::Detailed { .. }
        | ExtensionError::Unsupported(_) => "unreadable",
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

/// Combined loader gate used by the symbol-matrix tests: the base ABI-3 set
/// plus the four-cell command-surface rule (at least one command symbol).
#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
enum SymbolGate {
    Admitted(CommandSurfaceCell),
    MissingBase(Vec<&'static str>),
    MissingCommandSurface,
}

#[cfg(test)]
fn validate_extension_symbols<'a>(
    symbols: impl IntoIterator<Item = &'a str>,
) -> SymbolGate {
    let symbols = symbols.into_iter().collect::<HashSet<_>>();
    let missing = REQUIRED_EXTENSION_SYMBOLS
        .iter()
        .copied()
        .filter(|symbol| !symbols.contains(symbol))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return SymbolGate::MissingBase(missing);
    }
    let cell = classify_command_surface(
        symbols.contains(EXT_SYMBOL_COMMAND_V2),
        symbols.contains(EXT_SYMBOL_COMMAND),
    );
    match cell {
        CommandSurfaceCell::None => SymbolGate::MissingCommandSurface,
        cell => SymbolGate::Admitted(cell),
    }
}

struct DynamicExtensionInstance {
    name: String,
    instance: *mut c_void,
    command: CommandSurface,
    session_closed: ExtSessionClosedFn,
    deinit: ExtDeinitFn,
    free_string: ExtFreeStringFn,
    take_error: ExtTakeErrorFn,
    source: Option<SourceHandle>,
    deferred_port: Option<DeferredPortHandle>,
    #[allow(dead_code)] // capability diagnostic is logged at load; batch B probes it
    event_port: PortCapability,
    #[allow(dead_code)] // capability diagnostic is logged at load
    command_surface: CommandSurfaceCell,
    _library: Library,
}

unsafe impl Send for DynamicExtensionInstance {}

impl DynamicExtensionInstance {
    unsafe fn load(
        hub: &EventHub,
        deferred_hub: &DeferredPortHub,
        request: &ExtensionLoadRequest,
        library_path: &Path,
    ) -> Result<Self, ExtensionError> {
        // Identity chain (design design section 6.4): when the caller supplied an expected
        // byte hash, re-hash the resolved file BEFORE dlopen so a swapped
        // artifact cannot load. The recorded TOCTOU window between this hash
        // and the load is a known boundary; CI re-hashes after staging as
        // the release authority.
        verify_library_sha256(library_path, request)?;

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
            return Err(ExtensionError::Detailed {
                category: ABI_INCOMPATIBLE_CATEGORY.to_string(),
                message: format!(
                    "extension {} uses ABI version {actual_abi}; expected {EXT_ABI_VERSION}",
                    request.name
                ),
                details: None,
            });
        }

        let init = unsafe { get_symbol::<ExtInitFn>(&library, EXT_SYMBOL_INIT)? };
        // Four-cell command-surface matrix: at least one command symbol is
        // required; V2 wins when both exist; neither guesses semantics.
        let command_v2 = probe_symbol::<ExtCommandV2Fn>(&library, EXT_SYMBOL_COMMAND_V2);
        let command_v1 = probe_symbol::<ExtCommandFn>(&library, EXT_SYMBOL_COMMAND);
        let surface_cell = classify_command_surface(command_v2.is_some(), command_v1.is_some());
        let command = match surface_cell {
            CommandSurfaceCell::None => {
                return Err(ExtensionError::Detailed {
                    category: ABI_INCOMPATIBLE_CATEGORY.to_string(),
                    message: format!(
                        "extension {} exports neither {EXT_SYMBOL_COMMAND_V2} nor \
                         {EXT_SYMBOL_COMMAND}",
                        request.name
                    ),
                    details: None,
                });
            }
            CommandSurfaceCell::V2Only | CommandSurfaceCell::BothUseV2 => {
                CommandSurface::V2(command_v2.expect("classified V2"))
            }
            CommandSurfaceCell::V1Only => CommandSurface::V1(command_v1.expect("classified V1")),
        };
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

        // The EventPort attach symbol is optional and singular: absence
        // means legacy response flushing, presence is validated and invoked
        // exactly once with a PENDING, host-owned port.
        let attach = unsafe {
            library
                .get::<ExtAttachEventPortV1Fn>(
                    format!("{EXT_SYMBOL_ATTACH_EVENT_PORT_V1}\0").as_bytes(),
                )
                .ok()
                .map(|symbol| *symbol)
        };
        let (instance, source, event_port) = unsafe {
            init_and_attach(
                hub,
                request,
                &context,
                init,
                deinit,
                attach,
                take_error,
                free_string,
            )
        }?;

        // The DeferredPort attach symbol is optional too: a V1-only library
        // (or one that never defers) attaches no terminal channel. Any
        // failure after init deterministically deinits the instance and
        // revokes both ports (the wrapper whose Drop owns the success-path
        // cleanup is not constructed for a failed load).
        let deferred_attach = probe_symbol::<opentray_spec::ExtAttachDeferredPortV1Fn>(
            &library,
            EXT_SYMBOL_ATTACH_DEFERRED_PORT_V1,
        );
        let deferred_port = match deferred_attach {
            Some(attach) => {
                match attach_deferred_port(
                    deferred_hub,
                    request,
                    instance,
                    attach,
                    take_error,
                    free_string,
                ) {
                    Ok(handle) => Some(handle),
                    Err(error) => {
                        source.revoke();
                        unsafe { deinit(instance) };
                        return Err(error);
                    }
                }
            }
            None => None,
        };

        eprintln!(
            "opentray extension {}: event delivery mode: {}; command surface: {}; deferred port: {}",
            request.instance_name(),
            event_port.diagnostic_label(),
            surface_cell.diagnostic_label(),
            if deferred_port.is_some() { "attached" } else { "absent" },
        );

        Ok(Self {
            name: request.instance_name().to_string(),
            instance,
            command,
            session_closed,
            deinit,
            free_string,
            take_error,
            source: Some(source),
            deferred_port,
            event_port,
            command_surface: surface_cell,
            _library: library,
        })
    }

    fn read_events(
        &self,
        output: ExtOwnedBytes,
        scope: Option<ExtensionScope>,
    ) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
        read_owned_events(&self.name, output, self.free_string, scope)
    }
}

impl ExtensionInstance for DynamicExtensionInstance {
    fn name(&self) -> &str {
        &self.name
    }

    fn command(
        &mut self,
        envelope: ExtensionEnvelope,
        issued: IssuedOperation,
        host: &mut dyn CoreExtensionHostContext,
    ) -> Result<ExtensionCommandDisposition, ExtensionError> {
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
        match self.command {
            // V1-only surface: always Immediate by construction -- the legacy
            // signature has no disposition parameter and is never called
            // with the V2 shape.
            CommandSurface::V1(command) => {
                let mut output = ExtOwnedBytes {
                    ptr: ptr::null_mut(),
                    len: 0,
                };
                let mut host_context = HostCallContext { host };
                let ffi_host_context = host_context.as_ffi();
                let result = unsafe {
                    command(
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
                let events = self.read_events(output, Some(scope))?;
                Ok(ExtensionCommandDisposition::Immediate(events))
            }
            CommandSurface::V2(command) => {
                let outcome = dispatch_command_v2(
                    &self.name,
                    command,
                    self.instance,
                    &json,
                    issued.handle,
                    host,
                    self.take_error,
                    self.free_string,
                )?;
                match outcome {
                    V2DispatchOutcome::Immediate(output) => {
                        let events = self.read_events(output, Some(scope))?;
                        Ok(ExtensionCommandDisposition::Immediate(events))
                    }
                    V2DispatchOutcome::Deferred => {
                        // Review P1-3 capability law: a Deferred disposition
                        // promises a later terminal through the deferred
                        // port. An instance that answered Deferred without
                        // attaching the port has no legal terminal channel,
                        // so its operation would pend forever -- reject the
                        // dispatch with a typed capability error instead
                        // (the registry retires the pre-registered operation
                        // on the error path).
                        ensure_deferred_channel(self.deferred_port.is_some(), &self.name)?;
                        Ok(ExtensionCommandDisposition::Deferred)
                    }
                }
            }
        }
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
        // Lifecycle law: revoke the EventPort source AND the DeferredPort
        // BEFORE deinit and library drop, so a stale producer or worker
        // thread observes PORT_CLOSED against process-lifetime state and
        // never races native teardown.
        if let Some(handle) = &self.deferred_port {
            handle.revoke();
        }
        if let Some(source) = &self.source {
            source.revoke();
        }
        if !self.instance.is_null() {
            unsafe { (self.deinit)(self.instance) };
            self.instance = ptr::null_mut();
        }
    }
}

/// Reserves the PENDING EventPort source, initializes the extension
/// instance, and attaches the port.
///
/// Failure-cleanup law (D19 final review): the source slot is reserved
/// BEFORE `init`, so the phase-1 generation limit rejects the load with no
/// native instance ever created; an `init` failure revokes the reserved
/// source (init produced no instance, so there is nothing to deinitialize);
/// and ANY post-init failure (port validation or attach) deterministically
/// calls the extension's `deinit` and revokes the source before returning.
/// Without that deinit the initialized C instance would leak, because the
/// `DynamicExtensionInstance` wrapper -- whose `Drop` owns cleanup on the
/// success path -- is never constructed for a failed load.
unsafe fn init_and_attach(
    hub: &EventHub,
    request: &ExtensionLoadRequest,
    context: &ExtContext,
    init: ExtInitFn,
    deinit: ExtDeinitFn,
    attach: Option<ExtAttachEventPortV1Fn>,
    take_error: ExtTakeErrorFn,
    free_string: ExtFreeStringFn,
) -> Result<(*mut c_void, SourceHandle, PortCapability), ExtensionError> {
    // Reserve before init: a source-limit rejection means "no instance is
    // opened" -- init never runs.
    let source = reserve_port_source(hub, request)?;

    let mut instance = ptr::null_mut();
    let result = unsafe { init(context, &mut instance) };
    if result != EXT_OK || instance.is_null() {
        source.revoke();
        return Err(result_error(&request.name, result, take_error, free_string));
    }

    match probe_and_attach(hub, request, source, attach, instance, take_error, free_string) {
        Ok((source, capability)) => Ok((instance, source, capability)),
        Err(error) => {
            // probe_and_attach revoked the source on its failure paths; the
            // initialized instance still needs its deterministic deinit
            // because no Drop will run for this load. The structured error
            // is preserved unchanged.
            unsafe { deinit(instance) };
            Err(error)
        }
    }
}

/// Maps the phase-1 source-generation limit to the structured rejection the
/// loader surfaces before any port is constructed or attached.
fn reserve_port_source(
    hub: &EventHub,
    request: &ExtensionLoadRequest,
) -> Result<SourceHandle, ExtensionError> {
    hub.reserve_source(request.app_id.clone(), request.instance_name().to_string())
        .map_err(|SourceLimitReached| ExtensionError::Detailed {
            category: EVENT_PORT_SOURCE_LIMIT_CATEGORY.to_string(),
            message: format!(
                "extension {} cannot reserve an event port source: the broker has retained \
                 {} source generations and must be restarted before another port can be created",
                request.instance_name(),
                crate::event_hub::EVENT_HUB_MAX_SOURCES
            ),
            details: None,
        })
}

/// Validates and transfers the reserved PENDING source's immutable port
/// exactly once when the optional attach symbol is present. Absent symbol
/// means legacy flush; a malformed port or failed attach rejects the load
/// with a structured category -- never a silent downgrade. Every failure
/// path revokes the source it owns. The source limit is enforced earlier,
/// before `init` (see `init_and_attach`).
fn probe_and_attach(
    hub: &EventHub,
    request: &ExtensionLoadRequest,
    source: SourceHandle,
    attach: Option<ExtAttachEventPortV1Fn>,
    instance: *mut c_void,
    take_error: ExtTakeErrorFn,
    free_string: ExtFreeStringFn,
) -> Result<(SourceHandle, PortCapability), ExtensionError> {
    let Some(attach) = attach else {
        hub.note_capability(false);
        return Ok((source, PortCapability::LegacyFlush));
    };

    let port = source.port();
    if let Err(error) = validate_port(&port) {
        source.revoke();
        return Err(ExtensionError::Detailed {
            category: EVENT_PORT_ABI_INCOMPATIBLE_CATEGORY.to_string(),
            message: format!(
                "extension {} received a malformed event port: {}",
                request.instance_name(),
                match error {
                    PortValidationError::AbiVersion(actual) => {
                        format!("abi version {actual}; expected {EXT_EVENT_PORT_ABI_V1}")
                    }
                    PortValidationError::StructSize(actual) => {
                        format!("struct size {actual}; expected {}", port.struct_size)
                    }
                    PortValidationError::NullPortData => {
                        "port_data is null".to_string()
                    }
                }
            ),
            details: None,
        });
    }

    let result = unsafe { attach(instance, port) };
    if result != EXT_OK {
        source.revoke();
        let detail = take_extension_error(take_error, free_string);
        return Err(match detail {
            Some(detail) => ExtensionError::Detailed {
                category: detail.category,
                message: format!(
                    "extension {} event port attach failed: {}",
                    request.instance_name(),
                    detail.message
                ),
                details: detail.details,
            },
            None if result == EXT_ERR_UNSUPPORTED => ExtensionError::Detailed {
                category: EVENT_PORT_UNSUPPORTED_CATEGORY.to_string(),
                message: format!(
                    "extension {} explicitly does not support the event port and declares no \
                     legacy fallback",
                    request.instance_name()
                ),
                details: None,
            },
            None => ExtensionError::Rejected(format!(
                "extension {} event port attach returned code {result}",
                request.instance_name()
            )),
        });
    }

    hub.note_capability(true);
    Ok((source, PortCapability::DirectEventPort))
}

enum PortValidationError {
    AbiVersion(u32),
    StructSize(u32),
    NullPortData,
}

/// Defensive validation of the port the host is about to transfer: exact
/// nested EventPort ABI version, matching struct size, and non-null host
/// state. `try_submit` is non-nullable by its Rust function-pointer type.
fn validate_port(port: &ExtEventPortV1) -> Result<(), PortValidationError> {
    if port.abi_version != EXT_EVENT_PORT_ABI_V1 {
        return Err(PortValidationError::AbiVersion(port.abi_version));
    }
    if port.struct_size as usize != std::mem::size_of::<ExtEventPortV1>() {
        return Err(PortValidationError::StructSize(port.struct_size));
    }
    if port.port_data.is_null() {
        return Err(PortValidationError::NullPortData);
    }
    Ok(())
}

/// Optional-symbol probe: absence is a legitimate matrix cell, never an
/// error by itself.
fn probe_symbol<T: Copy>(library: &Library, name: &str) -> Option<T> {
    let symbol_name = format!("{name}\0");
    unsafe { library.get::<T>(symbol_name.as_bytes()) }
        .ok()
        .map(|symbol| *symbol)
}

/// Validates and transfers one PENDING deferred port by value through the
/// optional attach symbol (EventPort attach pattern). Absent symbol means no
/// terminal channel; a malformed port or failed attach rejects the load with
/// a structured category -- never a silent downgrade. Every failure path
/// revokes the port it created.
fn attach_deferred_port(
    hub: &DeferredPortHub,
    request: &ExtensionLoadRequest,
    instance: *mut c_void,
    attach: ExtAttachDeferredPortV1Fn,
    take_error: ExtTakeErrorFn,
    free_string: ExtFreeStringFn,
) -> Result<DeferredPortHandle, ExtensionError> {
    let handle = hub.attach_port(request.app_id.clone(), request.instance_name().to_string());
    let port = handle.port();
    if let Err(error) = validate_deferred_port(&port) {
        handle.revoke();
        return Err(ExtensionError::Detailed {
            category: DEFERRED_PORT_ABI_INCOMPATIBLE_CATEGORY.to_string(),
            message: format!(
                "extension {} received a malformed deferred port: {}",
                request.instance_name(),
                match error {
                    DeferredPortValidationError::AbiVersion(actual) => {
                        format!("abi version {actual}")
                    }
                    DeferredPortValidationError::StructSize(actual) => {
                        format!("struct size {actual}")
                    }
                    DeferredPortValidationError::NullPortData => {
                        "port_data is null".to_string()
                    }
                }
            ),
            details: None,
        });
    }

    let result = unsafe { attach(instance, port) };
    if result != EXT_OK {
        handle.revoke();
        let detail = take_extension_error(take_error, free_string);
        return Err(match detail {
            Some(detail) => ExtensionError::Detailed {
                category: detail.category,
                message: format!(
                    "extension {} deferred port attach failed: {}",
                    request.instance_name(),
                    detail.message
                ),
                details: detail.details,
            },
            None if result == EXT_ERR_UNSUPPORTED => ExtensionError::Detailed {
                category: DEFERRED_PORT_UNSUPPORTED_CATEGORY.to_string(),
                message: format!(
                    "extension {} explicitly does not support the deferred port",
                    request.instance_name()
                ),
                details: None,
            },
            None => ExtensionError::Rejected(format!(
                "extension {} deferred port attach returned code {result}",
                request.instance_name()
            )),
        });
    }
    Ok(handle)
}

/// Identity-chain gate (design design section 6.4): when the LoadExt frame carried an
/// expected byte hash, re-hash the resolved library file BEFORE `dlopen`.
/// The comparison is against the lowercase-hex SHA-256 wire form.
fn verify_library_sha256(
    library_path: &Path,
    request: &ExtensionLoadRequest,
) -> Result<(), ExtensionError> {
    let Some(expected) = request.expected_identity.sha256.as_deref() else {
        return Ok(());
    };
    let bytes = std::fs::read(library_path).map_err(|error| {
        ExtensionError::Unsupported(format!(
            "cannot read extension library {} for identity hashing: {error}",
            library_path.display()
        ))
    })?;
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if expected.eq_ignore_ascii_case(&actual) {
        return Ok(());
    }
    Err(ExtensionError::Detailed {
        category: ARTIFACT_IDENTITY_MISMATCH_CATEGORY.to_string(),
        message: format!(
            "extension {} library bytes do not match the expected sha256: expected={expected}; \
             actual={actual}; path={}",
            request.name,
            library_path.display()
        ),
        details: None,
    })
}

/// Releases one extension-owned buffer through the extension's
/// `free_string`. Centralized ownership law (review P2 zero-length): a
/// NON-NULL pointer is freed regardless of its length -- a zero-length
/// allocation is still an allocation the extension owns, and skipping it
/// would leak. A null pointer is never passed to `free_string`.
///
/// # Safety
///
/// `ptr` must be null or point to a buffer allocated by the same extension
/// that provided `free_string`; the buffer must not be used afterwards.
unsafe fn free_owned_bytes(output: ExtOwnedBytes, free_string: ExtFreeStringFn) {
    if !output.ptr.is_null() {
        unsafe { free_string(output.ptr, output.len) };
    }
}

/// Reads (and frees through the extension's `free_string`) one owned events
/// buffer; an absent buffer is an empty Immediate result. A non-null
/// zero-length buffer is freed exactly like any other owned allocation.
/// When a scope is supplied, every parsed envelope is re-bound to the
/// host-derived scope -- extension-claimed scopes are never trusted.
fn read_owned_events(
    name: &str,
    output: ExtOwnedBytes,
    free_string: ExtFreeStringFn,
    scope: Option<ExtensionScope>,
) -> Result<Vec<ExtensionEnvelope>, ExtensionError> {
    if output.ptr.is_null() {
        return Ok(Vec::new());
    }
    if output.len == 0 {
        // Zero-length is still an empty Immediate result, but the non-null
        // allocation is released first (review P2).
        unsafe { free_owned_bytes(output, free_string) };
        return Ok(Vec::new());
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) }.to_vec();
    unsafe { free_owned_bytes(output, free_string) };
    let mut parsed = serde_json::from_slice::<Vec<ExtensionEnvelope>>(&bytes).map_err(|error| {
        ExtensionError::Rejected(format!(
            "extension {name} returned invalid events JSON: {error}"
        ))
    })?;
    if let Some(scope) = scope {
        for event in &mut parsed {
            event.scope = scope.clone();
        }
    }
    Ok(parsed)
}

/// Host-side outcome of one V2 command call, before envelope parsing.
#[derive(Debug)]
enum V2DispatchOutcome {
    /// Immediate disposition; the caller owns and must free `out_events`.
    Immediate(ExtOwnedBytes),
    /// Deferred disposition (the operation stays pending).
    Deferred,
}

/// Violations of the frozen disposition output matrix. All map to typed
/// `abi_incompatible`-family rejections: the host never guesses semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DispositionViolation {
    UnknownTag(u32),
    Reserved(u32),
    /// Immediate with a non-zero value: dual-output attempt (the "Immediate
    /// dual output" negative).
    ImmediateWithValue(u64),
    /// Deferred with a handle other than the one the host seeded.
    DeferredHandleMismatch { echoed: u64, issued: u64 },
}

/// Validates the disposition the extension left in the host-seeded struct.
/// `Ok(None)` is Immediate; `Ok(Some(handle))` is Deferred with the echoed
/// handle confirmed equal to the issued one.
fn classify_returned_disposition(
    returned: &ExtCommandDispositionV1,
    issued_handle: u64,
) -> Result<Option<u64>, DispositionViolation> {
    if returned.tag != EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE
        && returned.tag != EXT_COMMAND_DISPOSITION_TAG_DEFERRED
    {
        return Err(DispositionViolation::UnknownTag(returned.tag));
    }
    if returned.reserved != 0 {
        return Err(DispositionViolation::Reserved(returned.reserved));
    }
    match returned.tag {
        EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE => {
            if !returned.value_is_zero() {
                return Err(DispositionViolation::ImmediateWithValue(
                    returned.operation_handle(),
                ));
            }
            Ok(None)
        }
        _ => {
            let echoed = returned.operation_handle();
            if echoed != issued_handle {
                return Err(DispositionViolation::DeferredHandleMismatch {
                    echoed,
                    issued: issued_handle,
                });
            }
            Ok(Some(echoed))
        }
    }
}

fn disposition_violation_error(name: &str, violation: DispositionViolation) -> ExtensionError {
    let detail = match violation {
        DispositionViolation::UnknownTag(tag) => {
            format!("unknown disposition tag {tag} (expected 0=Immediate or 1=Deferred)")
        }
        DispositionViolation::Reserved(value) => {
            format!("non-zero disposition reserved field {value}")
        }
        DispositionViolation::ImmediateWithValue(value) => {
            format!(
                "Immediate disposition must zero the value union, got operation handle \
                 {value:#018x} (dual output is not expressible)"
            )
        }
        DispositionViolation::DeferredHandleMismatch { echoed, issued } => {
            format!(
                "Deferred disposition echoed handle {echoed:#018x} instead of the issued \
                 {issued:#018x} (self-forged handles are rejected)"
            )
        }
    };
    ExtensionError::Detailed {
        category: ABI_INCOMPATIBLE_CATEGORY.to_string(),
        message: format!("extension {name} violated the command disposition matrix: {detail}"),
        details: None,
    }
}

/// Runs one V2 command call: seeds the disposition with the broker-issued
/// handle (the one-way, single-use handle delivery design section 5.1 freezes), invokes
/// the extension, and classifies the returned disposition. Deferred with a
/// non-empty `out_events` buffer is a structured protocol violation: the
/// buffer is freed and its events dropped, never delivered.
// FFI boundary shape: the raw symbol signature plus the two error hooks
// mirror `init_and_attach`'s argument set.
#[allow(clippy::too_many_arguments)]
fn dispatch_command_v2(
    name: &str,
    command: ExtCommandV2Fn,
    instance: *mut c_void,
    envelope_json: &CString,
    issued_handle: u64,
    host: &mut dyn CoreExtensionHostContext,
    take_error: ExtTakeErrorFn,
    free_string: ExtFreeStringFn,
) -> Result<V2DispatchOutcome, ExtensionError> {
    let mut output = ExtOwnedBytes {
        ptr: ptr::null_mut(),
        len: 0,
    };
    // Pre-seed the handle delivery: the extension receives the handle
    // through this struct during the call and either keeps the Deferred
    // disposition or rewrites to Immediate.
    let mut disposition = ExtCommandDispositionV1::deferred(issued_handle);
    let mut host_context = HostCallContext { host };
    let ffi_host_context = host_context.as_ffi();
    let result = unsafe {
        command(
            instance,
            &ffi_host_context,
            borrowed_bytes(envelope_json),
            &mut output,
            &mut disposition,
        )
    };
    if result != EXT_OK {
        return Err(result_error(name, result, take_error, free_string));
    }
    match classify_returned_disposition(&disposition, issued_handle) {
        Ok(None) => Ok(V2DispatchOutcome::Immediate(output)),
        Ok(Some(_handle)) => {
            // Deferred: out_events must be empty. Non-empty is a protocol
            // violation -- record a structured diagnostic, free the buffer,
            // and deliver nothing (the command still defers). A non-null
            // zero-length buffer is freed too: ownership cleanup never
            // depends on the length (review P2).
            if !output.ptr.is_null() {
                if output.len != 0 {
                    eprintln!(
                        "opentray extension {name}: deferred command also wrote out_events \
                         (protocol violation); dropping the buffer without delivery"
                    );
                }
                unsafe { free_owned_bytes(output, free_string) };
            }
            Ok(V2DispatchOutcome::Deferred)
        }
        Err(violation) => {
            // Neither buffer may leak on a typed rejection: free any
            // non-null events buffer (ownership is independent of the
            // disposition struct, which carries no bytes).
            unsafe { free_owned_bytes(output, free_string) };
            Err(disposition_violation_error(name, violation))
        }
    }
}

unsafe fn get_symbol<T: Copy>(library: &Library, name: &str) -> Result<T, ExtensionError> {
    let symbol_name = format!("{name}\0");
    unsafe { library.get::<T>(symbol_name.as_bytes()) }
        .map(|symbol| *symbol)
        .map_err(|error| ExtensionError::Detailed {
            category: ABI_INCOMPATIBLE_CATEGORY.to_string(),
            message: format!("extension missing symbol {name}: {error}"),
            details: None,
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
            details: detail.details,
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
        // A non-null zero-length buffer is still released before rejecting:
        // ownership cleanup never depends on the length (review P2).
        unsafe { free_owned_bytes(output, free_string) };
        return Err(ExtensionError::Rejected(format!(
            "{label} returned no JSON"
        )));
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.ptr.cast::<u8>(), output.len) }.to_vec();
    unsafe { free_owned_bytes(output, free_string) };
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
    let mut identity_matches = actual.abi_version == EXT_ABI_VERSION
        && actual.extension_name == expected.extension_name
        && actual.artifact_set_version == expected.artifact_set_version
        && actual.contract_fingerprint == expected.contract_fingerprint
        && actual.target == expected.target
        && !actual.build_identity.is_empty();
    // Identity-chain gate (design design section 6.4): when the caller supplied an
    // expected build identity, the native manifest must match it exactly.
    if let Some(expected_build) = expected.build_identity.as_deref() {
        identity_matches = identity_matches && actual.build_identity == expected_build;
    }
    if identity_matches {
        return Ok(());
    }
    Err(ExtensionError::Detailed {
        category: ARTIFACT_IDENTITY_MISMATCH_CATEGORY.to_string(),
        message: format!(
            "expected={}; actual={}",
            serde_json::to_string(expected).unwrap_or_else(|_| "<unserializable>".to_string()),
            serde_json::to_string(actual).unwrap_or_else(|_| "<unserializable>".to_string())
        ),
        details: None,
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
    use crate::event_hub::event_hub_test_support::NoopWake;
    use opentray_core::RecordingExtension;
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};

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
            sha256: None,
            build_identity: None,
        }
    }

    // -- Real shared-library command-surface fixtures (review P1-5) ---------
    //
    // The pure-classifier and in-process stub tables above stay, but the
    // four command-surface cells are ALSO proven against real compiled
    // shared libraries: symbol spelling, #[repr(C)] layout, calling
    // convention, and the V1-cell-never-called-through-V2 rule all become
    // observable facts instead of classifier outputs. Fixtures compile at
    // test time through the host `cc` (present on every darwin/linux dev
    // host; Windows real-library coverage remains separate platform
    // evidence per the repository's platform-evidence law).
    #[cfg(unix)]
    mod real_library_fixtures {
        use super::*;
        use std::process::Command;

        const FIXTURE_C: &str = r#"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct { char *ptr; size_t len; } owned_bytes;
typedef struct { const char *ptr; size_t len; } borrowed_bytes;
typedef struct { uint32_t tag; uint32_t reserved; uint64_t handle; } disposition_v1;
typedef struct { uint32_t abi_version; uint32_t struct_size; void *port_data;
                 int32_t (*submit)(void *, uint64_t, const uint8_t *, size_t); } deferred_port_v1;

static uint32_t g_last_symbol = 0; /* 1 = v1 entry, 2 = v2 entry */
static uint64_t g_last_handle = 0;
static void *g_port_data = 0;
static int32_t (*g_submit)(void *, uint64_t, const uint8_t *, size_t) = 0;

uint32_t opentray_fixture_last_symbol(void) { return g_last_symbol; }
uint64_t opentray_fixture_last_handle(void) { return g_last_handle; }

int32_t opentray_ext_abi_version(void) { return 3; }

static const char *manifest_json(void) {
    return "{\"extensionName\":\"dialog\",\"abiVersion\":3,"
           "\"artifactSetVersion\":\"current\","
           "\"contractFingerprint\":\"current-contract\","
           "\"target\":{\"os\":\"darwin\",\"arch\":\"arm64\"},"
           "\"buildIdentity\":\"fixture-build\"}";
}

int32_t opentray_ext_manifest(owned_bytes *out) {
    if (!out) return 1;
    const char *json = manifest_json();
    size_t len = strlen(json);
    char *buf = (char *)malloc(len + 1);
    if (!buf) return 3;
    memcpy(buf, json, len + 1);
    out->ptr = buf;
    out->len = len;
    return 0;
}

void opentray_ext_free_string(char *ptr, size_t len) { (void)len; free(ptr); }

int32_t opentray_ext_take_error(owned_bytes *out) {
    if (out) { out->ptr = 0; out->len = 0; }
    return 1; /* no structured detail */
}

int32_t opentray_ext_init(const void *context, void **out_instance) {
    (void)context;
    if (!out_instance) return 1;
    *out_instance = (void *)0x1234;
    return 0;
}

void opentray_ext_deinit(void *instance) { (void)instance; }

int32_t opentray_ext_session_closed(void *instance, const void *context,
                                     borrowed_bytes session_id,
                                     owned_bytes *out_events) {
    (void)instance; (void)context; (void)session_id;
    if (out_events) { out_events->ptr = 0; out_events->len = 0; }
    return 0;
}

#ifdef HAS_V1
int32_t opentray_ext_command(void *instance, const void *context,
                             borrowed_bytes envelope, owned_bytes *out_events) {
    (void)instance; (void)context; (void)envelope;
    g_last_symbol = 1;
    static const char events[] = "[{\"scope\":{\"appId\":\"app-1\",\"trayId\":\"tray-1\","
                                 "\"ext\":\"dialog\"},\"data\":{\"type\":\"v1-immediate\"}}]";
    size_t len = sizeof(events) - 1;
    char *buf = (char *)malloc(len + 1);
    if (!buf) return 3;
    memcpy(buf, events, len + 1);
    if (out_events) { out_events->ptr = buf; out_events->len = len; }
    else free(buf);
    return 0;
}
#endif

#ifdef HAS_V2
int32_t opentray_ext_command_v2(void *instance, const void *context,
                                borrowed_bytes envelope, owned_bytes *out_events,
                                disposition_v1 *out_disposition) {
    (void)instance; (void)context; (void)envelope;
    g_last_symbol = 2;
    /* Observe the host-seeded handle delivery, then leave the Deferred
       disposition untouched: the command defers. */
    if (out_disposition) { g_last_handle = out_disposition->handle; }
    if (out_events) { out_events->ptr = 0; out_events->len = 0; }
    return 0;
}
#endif

#ifdef HAS_DEFERRED_PORT
int32_t opentray_ext_attach_deferred_completion_port_v1(void *instance,
                                                        deferred_port_v1 port) {
    (void)instance;
    /* By-value law: copy only port_data and the submit fn. */
    g_port_data = port.port_data;
    g_submit = port.submit;
    return 0;
}

int32_t opentray_fixture_submit_terminal(const uint8_t *payload, size_t len) {
    if (!g_submit || !g_port_data) return 5; /* port closed */
    return g_submit(g_port_data, g_last_handle, payload, len);
}
#endif
"#;

        /// Compiles the fixture C source into a real shared library with the
        /// requested preprocessor cells. Returns the absolute library path
        /// (exact-path loads never fall back to diagnostic candidates).
        fn compile_fixture(label: &str, defines: &[&str]) -> PathBuf {
            let root = std::env::temp_dir().join(format!(
                "opentray-extdlg-fixture-{label}-{}-{}",
                std::process::id(),
                label
            ));
            std::fs::create_dir_all(&root).expect("fixture dir");
            let source = root.join("fixture.c");
            std::fs::write(&source, FIXTURE_C).expect("write fixture source");
            let library = if cfg!(target_os = "macos") {
                root.join("libopentray_ext_dialog.dylib")
            } else {
                root.join("libopentray_ext_dialog.so")
            };
            let output = Command::new("cc")
                .arg("-shared")
                .arg("-fPIC")
                .args(defines.iter().map(|define| format!("-D{define}")))
                .arg(&source)
                .arg("-o")
                .arg(&library)
                .output()
                .expect("run cc");
            assert!(
                output.status.success(),
                "fixture {label} failed to compile: {}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            library
        }

        /// The fixture's per-image call log, read through a second library
        /// handle (dlopen of the same path shares statics).
        struct FixtureProbe {
            last_symbol: unsafe extern "C" fn() -> u32,
            last_handle: unsafe extern "C" fn() -> u64,
            submit_terminal: Option<unsafe extern "C" fn(*const u8, usize) -> i32>,
            _library: Library,
        }

        impl FixtureProbe {
            fn open(path: &std::path::Path) -> Self {
                let library = unsafe { Library::new(path) }.expect("probe library");
                let symbol = unsafe {
                    *library
                        .get::<unsafe extern "C" fn() -> u32>(b"opentray_fixture_last_symbol\0")
                        .expect("last symbol getter")
                };
                let handle = unsafe {
                    *library
                        .get::<unsafe extern "C" fn() -> u64>(b"opentray_fixture_last_handle\0")
                        .expect("last handle getter")
                };
                let submit_terminal = unsafe {
                    library
                        .get::<unsafe extern "C" fn(*const u8, usize) -> i32>(
                            b"opentray_fixture_submit_terminal\0",
                        )
                        .ok()
                        .map(|getter| *getter)
                };
                Self {
                    last_symbol: symbol,
                    last_handle: handle,
                    submit_terminal,
                    _library: library,
                }
            }
        }

        struct FixtureHarness {
            hub: EventHub,
            deferred_hub: crate::deferred_port::DeferredPortHub,
            registry: std::sync::Arc<opentray_core::operations::DeferredOperationRegistry>,
            library_path: PathBuf,
            /// Kept for the Drop cleanup below.
            root: PathBuf,
        }

        impl Drop for FixtureHarness {
            fn drop(&mut self) {
                // Unlinking a dlopen'd image is safe on unix; the test
                // process owns this directory exclusively.
                let _ = std::fs::remove_dir_all(&self.root);
            }
        }

        fn harness(label: &str, defines: &[&str]) -> FixtureHarness {
            let registry = operations_registry();
            let library_path = compile_fixture(label, defines);
            let root = library_path
                .parent()
                .expect("fixture library parent")
                .to_path_buf();
            FixtureHarness {
                hub: test_hub(),
                deferred_hub: test_deferred_hub(&registry),
                registry,
                library_path,
                root,
            }
        }

        fn load_instance(
            fixture: &FixtureHarness,
        ) -> Box<DynamicExtensionInstance> {
            let request = ExtensionLoadRequest {
                app_id: "app-1".to_string(),
                name: "dialog".to_string(),
                path: fixture.library_path.to_string_lossy().into_owned(),
                expected_identity: expected_extension_identity("dialog"),
                mount_id: None,
            };
            match unsafe {
                DynamicExtensionInstance::load(
                    &fixture.hub,
                    &fixture.deferred_hub,
                    &request,
                    &fixture.library_path,
                )
            } {
                Ok(instance) => Box::new(instance),
                Err(error) => panic!("real fixture library loads: {error}"),
            }
        }

        fn command_envelope() -> ExtensionEnvelope {
            ExtensionEnvelope {
                scope: opentray_spec::ExtensionScope {
                    app_id: "app-1".to_string(),
                    tray_id: Some("tray-1".to_string()),
                    ext: "dialog".to_string(),
                },
                command_scope: None,
                data: serde_json::json!({ "type": "messageDialog" }),
            }
        }

        fn issued_operation(
            registry: &opentray_core::operations::DeferredOperationRegistry,
        ) -> opentray_core::operations::IssuedOperation {
            registry.register_pending(
                opentray_spec::CommandScope {
                    app_id: "app-1".to_string(),
                    tray_id: "tray-1".to_string(),
                    session_id: "session-1".to_string(),
                    instance_generation: registry.current_generation("app-1", "dialog"),
                },
                "dialog".to_string(),
            )
        }

        /// Dispatches one command and returns the issued operation together
        /// with the outcome, so tests can compare the fixture-observed
        /// handle against the exact handle the host seeded.
        fn dispatch(
            instance: &mut DynamicExtensionInstance,
            registry: &opentray_core::operations::DeferredOperationRegistry,
        ) -> (
            opentray_core::operations::IssuedOperation,
            Result<ExtensionCommandDisposition, ExtensionError>,
        ) {
            let issued = issued_operation(registry);
            let mut host = opentray_core::UnsupportedExtensionHostContext;
            let outcome = instance.command(command_envelope(), issued.clone(), &mut host);
            (issued, outcome)
        }

        /// V2-only cell: a real library exporting exactly the V2 command
        /// symbol loads with full capability; the command call crosses a
        /// real FFI boundary and observes the seeded handle (one-way
        /// delivery through the disposition struct). Without the deferred
        /// port symbol the Deferred answer is the P1-3 typed rejection --
        /// proven here against the real library, with the fixture's recorded
        /// handle matching the exact seeded one.
        #[test]
        fn v2_only_real_library_sees_the_seeded_handle() {
            let fixture = harness("v2-only", &["HAS_V2=1"]);
            let probe = FixtureProbe::open(&fixture.library_path);
            let mut instance = load_instance(&fixture);

            let (issued, outcome) = dispatch(instance.as_mut(), &fixture.registry);
            let error = match outcome {
                Err(error) => error,
                Ok(_) => panic!("expected typed rejection"),
            };
            let ExtensionError::Detailed { category, .. } = &error else {
                panic!("expected typed rejection, got: {error}");
            };
            assert_eq!(category, DEFERRED_PORT_UNSUPPORTED_CATEGORY);
            assert_eq!(
                unsafe { (probe.last_symbol)() },
                2,
                "the V2 entry ran across the real FFI boundary"
            );
            assert_eq!(
                unsafe { (probe.last_handle)() },
                issued.handle,
                "the fixture recorded the exact handle the host seeded"
            );
        }

        /// V1-only cell: a real library exporting only the legacy command
        /// symbol is permanently Immediate. The V1 entry observes the V1
        /// calling convention (4 arguments, no disposition pointer): if the
        /// host ever called it through the V2 signature, the argument
        /// registers would misalign and this marker/events pair could not
        /// both be correct.
        #[test]
        fn v1_only_real_library_is_immediate_and_never_called_with_the_v2_signature() {
            let fixture = harness("v1-only", &["HAS_V1=1"]);
            let probe = FixtureProbe::open(&fixture.library_path);
            let mut instance = load_instance(&fixture);

            let (.., outcome) = dispatch(instance.as_mut(), &fixture.registry);
            let disposition = outcome.expect("V1-only dispatch is always Immediate");
            assert_eq!(
                unsafe { (probe.last_symbol)() },
                1,
                "the V1 entry ran with the V1 convention"
            );
            let ExtensionCommandDisposition::Immediate(events) = disposition else {
                panic!("a V1-only library can never defer");
            };
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].data["type"], "v1-immediate");
            assert_eq!(unsafe { (probe.last_handle)() }, 0);
        }

        /// Both-symbols cell: V2 wins; the legacy symbol is ignored.
        #[test]
        fn both_symbols_real_library_dispatches_through_v2() {
            let fixture = harness("both", &["HAS_V1=1", "HAS_V2=1", "HAS_DEFERRED_PORT=1"]);
            let probe = FixtureProbe::open(&fixture.library_path);
            let mut instance = load_instance(&fixture);

            let (.., outcome) = dispatch(instance.as_mut(), &fixture.registry);
            let disposition = outcome.expect("dispatch through V2");
            assert!(matches!(disposition, ExtensionCommandDisposition::Deferred));
            assert_eq!(unsafe { (probe.last_symbol)() }, 2);
        }

        /// Neither-symbol cell: the real library rejects the load with the
        /// frozen `abi_incompatible` category and no command entry runs.
        #[test]
        fn neither_symbol_real_library_rejects_as_abi_incompatible() {
            let fixture = harness("neither", &[]);
            let probe = FixtureProbe::open(&fixture.library_path);
            let request = ExtensionLoadRequest {
                app_id: "app-1".to_string(),
                name: "dialog".to_string(),
                path: fixture.library_path.to_string_lossy().into_owned(),
                expected_identity: expected_extension_identity("dialog"),
                mount_id: None,
            };
            let error = match unsafe {
                DynamicExtensionInstance::load(
                    &fixture.hub,
                    &fixture.deferred_hub,
                    &request,
                    &fixture.library_path,
                )
            } {
                Ok(_) => panic!("neither-symbol library must reject the load"),
                Err(error) => error,
            };
            let ExtensionError::Detailed { category, message, .. } = &error else {
                panic!("expected typed rejection, got: {error}");
            };
            assert_eq!(category, ABI_INCOMPATIBLE_CATEGORY);
            assert!(message.contains(EXT_SYMBOL_COMMAND_V2), "{message}");
            assert!(message.contains(EXT_SYMBOL_COMMAND), "{message}");
            assert_eq!(
                unsafe { (probe.last_symbol)() },
                0,
                "no command entry ran"
            );
        }

        /// Review P1-3, explicit real-library arm: a V2 library WITHOUT the
        /// deferred-port attach symbol answers Deferred, and the host
        /// rejects the dispatch with the frozen `deferred_port_unsupported`
        /// category instead of leaving the operation pending forever.
        #[test]
        fn portless_v2_deferred_is_a_typed_capability_rejection() {
            let fixture = harness("v2-no-port", &["HAS_V2=1"]);
            let mut instance = load_instance(&fixture);

            let (.., outcome) = dispatch(instance.as_mut(), &fixture.registry);
            let error = match outcome {
                Err(error) => error,
                Ok(_) => panic!("expected typed rejection"),
            };
            let ExtensionError::Detailed { category, message, .. } = &error else {
                panic!("expected typed rejection, got: {error}");
            };
            assert_eq!(category, DEFERRED_PORT_UNSUPPORTED_CATEGORY);
            assert!(message.contains("without attaching"), "{message}");
        }

        /// End-to-end across two real FFI boundaries: the fixture defers,
        /// then submits its terminal through the by-value port it copied at
        /// attach (real C -> Rust function-pointer call), and the owner-loop
        /// drain settles exactly one terminal frame.
        #[test]
        fn real_library_deferred_transaction_settles_through_the_port_submit() {
            let fixture = harness("e2e", &["HAS_V2=1", "HAS_DEFERRED_PORT=1"]);
            let probe = FixtureProbe::open(&fixture.library_path);
            let mut instance = load_instance(&fixture);

            // LoadExt ACK opens the submit channel.
            assert!(fixture
                .deferred_hub
                .open_port("app-1", "dialog", "session-1"));

            let issued = issued_operation(&fixture.registry);
            let mut host = opentray_core::UnsupportedExtensionHostContext;
            let disposition = instance
                .command(command_envelope(), issued.clone(), &mut host)
                .expect("deferred dispatch with a live port");
            assert!(matches!(disposition, ExtensionCommandDisposition::Deferred));
            assert_eq!(unsafe { (probe.last_symbol)() }, 2);

            // The extension (real C code) submits the single terminal.
            let payload = serde_json::to_vec(&opentray_spec::ExtOperationPayload::Result {
                value: serde_json::json!({ "response": 1 }),
            })
            .expect("terminal payload json");
            let submit_terminal = probe.submit_terminal.expect("fixture submit helper");
            assert_eq!(
                unsafe { submit_terminal(payload.as_ptr(), payload.len()) },
                EXT_OK
            );

            // Owner-loop settlement writes exactly one terminal frame.
            let backend = opentray_core::FakeBackend::new(opentray_core::BackendCapabilities::full());
            let broker = opentray_core::BrokerKernel::with_default_app_options_and_operations(
                backend,
                opentray_core::UnsupportedExtensionLoader,
                opentray_spec::AppOptions {
                    id: Some("app-1".to_string()),
                    name: None,
                    app_icon: None,
                    default: true,
                },
                opentray_spec::BrokerArtifactIdentity {
                    package_version: "0.1.0".to_string(),
                    target: opentray_spec::BrokerArtifactTarget {
                        os: "darwin".to_string(),
                        arch: "arm64".to_string(),
                    },
                    executable_hash: "0".repeat(64),
                    build_identity: "test-broker".to_string(),
                },
                fixture.registry.clone(),
            );
            let mut delivered: Vec<(String, opentray_spec::ServerFrame)> = Vec::new();
            crate::deferred_port::drain_deferred_terminals(
                &fixture.deferred_hub,
                &broker,
                None,
                &mut |owner, frame| {
                    delivered.push((owner.to_string(), frame));
                    true
                },
            );
            assert_eq!(delivered.len(), 1, "exactly one terminal frame");
            assert_eq!(delivered[0].0, "session-1");
            assert!(matches!(
                &delivered[0].1,
                opentray_spec::ServerFrame::ExtOperationTerminal { operation_id, .. }
                    if operation_id == &issued.operation_id
            ));
        }
    }

    // -- EventPort fixture matrix (task 2.3) --------------------------------
    //
    // The optional-attach decision table is exercised through
    // `probe_and_attach` with stub attach/take_error functions, which is the
    // exact code the loader runs between `init` and LoadExt ACK. Real
    // cross-dylib fixtures belong to the ext-webview migration and platform
    // evidence stages.

    fn test_hub() -> EventHub {
        EventHub::new(Box::new(NoopWake))
    }

    fn operations_registry() -> std::sync::Arc<opentray_core::operations::DeferredOperationRegistry>
    {
        std::sync::Arc::new(opentray_core::operations::DeferredOperationRegistry::new())
    }

    fn test_deferred_hub(
        registry: &std::sync::Arc<opentray_core::operations::DeferredOperationRegistry>,
    ) -> crate::deferred_port::DeferredPortHub {
        use crate::deferred_port::deferred_port_test_support::NoopWake as DeferredNoopWake;
        crate::deferred_port::DeferredPortHub::new(Box::new(DeferredNoopWake), registry.clone())
    }

    fn reserved_source(hub: &EventHub) -> SourceHandle {
        hub.reserve_source("app-1".to_string(), "webview".to_string())
            .expect("source slot")
    }

    fn stub_context() -> ExtContext {
        ExtContext {
            api_version: EXT_API_VERSION,
            app_id: ExtBytes {
                ptr: std::ptr::null(),
                len: 0,
            },
        }
    }

    fn load_request(name: &str) -> ExtensionLoadRequest {
        ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: name.to_string(),
            path: format!("test://{name}"),
            expected_identity: expected_extension_identity(name),
            mount_id: None,
        }
    }

    unsafe extern "C" fn stub_take_error(_out: *mut ExtOwnedBytes) -> ExtResultCode {
        // No structured detail: the loader must synthesize its own category.
        EXT_ERR_UNSUPPORTED
    }

    unsafe extern "C" fn stub_free_string(_ptr: *mut std::ffi::c_char, _len: usize) {}

    #[test]
    fn absent_attach_symbol_loads_legacy_with_a_reserved_source() {
        let hub = test_hub();
        let request = load_request("webview");

        let (handle, capability) = probe_and_attach(
            &hub,
            &request,
            reserved_source(&hub),
            None,
            ptr::null_mut(),
            stub_take_error,
            stub_free_string,
        )
        .expect("legacy load");

        assert_eq!(capability, PortCapability::LegacyFlush);
        assert_eq!(capability.diagnostic_label(), "legacy-flush");
        // A legacy extension still gets a source slot: its command-time
        // send_event pushes bind to the same hub ingress. The reservation
        // stages a PENDING candidate; `current` appears only at the ACK.
        assert!(
            hub.current_source("app-1", "webview").is_none(),
            "a reservation alone must not switch the current mapping"
        );
        assert!(hub.note_loaded_and_open("app-1", "webview", "session-1"));
        assert!(hub.current_source("app-1", "webview").is_some());
        assert_eq!(hub.metrics().legacy_sources, 1);
        assert_eq!(hub.metrics().direct_sources, 0);
        drop(handle);
    }

    #[test]
    fn successful_attach_transfers_one_validated_port() {
        static ATTACH_CALLS: AtomicUsize = AtomicUsize::new(0);
        static CAPTURED_ABI: AtomicU32 = AtomicU32::new(0);
        static CAPTURED_SIZE: AtomicU32 = AtomicU32::new(0);
        static CAPTURED_PTR_NONNULL: AtomicBool = AtomicBool::new(false);

        unsafe extern "C" fn capture_attach(
            _instance: *mut c_void,
            port: ExtEventPortV1,
        ) -> ExtResultCode {
            ATTACH_CALLS.fetch_add(1, Ordering::SeqCst);
            CAPTURED_ABI.store(port.abi_version, Ordering::SeqCst);
            CAPTURED_SIZE.store(port.struct_size, Ordering::SeqCst);
            CAPTURED_PTR_NONNULL.store(!port.port_data.is_null(), Ordering::SeqCst);
            EXT_OK
        }

        let hub = test_hub();
        let request = load_request("webview");
        let (handle, capability) = probe_and_attach(
            &hub,
            &request,
            reserved_source(&hub),
            Some(capture_attach),
            0x1 as *mut c_void,
            stub_take_error,
            stub_free_string,
        )
        .expect("direct load");

        assert_eq!(capability, PortCapability::DirectEventPort);
        assert_eq!(ATTACH_CALLS.load(Ordering::SeqCst), 1, "attach runs once");
        assert_eq!(CAPTURED_ABI.load(Ordering::SeqCst), EXT_EVENT_PORT_ABI_V1);
        assert_eq!(
            CAPTURED_SIZE.load(Ordering::SeqCst) as usize,
            std::mem::size_of::<ExtEventPortV1>()
        );
        assert!(CAPTURED_PTR_NONNULL.load(Ordering::SeqCst));
        assert_eq!(hub.metrics().direct_sources, 1);
        // The transferred source is PENDING until the LoadExt ACK opens it.
        assert!(
            hub.note_loaded_and_open("app-1", "webview", "session-1"),
            "ACK opens the attached source"
        );
        drop(handle);
    }

    #[test]
    fn failed_attach_revokes_the_source_and_rejects_the_load() {
        static ATTACH_CALLS: AtomicUsize = AtomicUsize::new(0);
        unsafe extern "C" fn failing_attach(
            _instance: *mut c_void,
            _port: ExtEventPortV1,
        ) -> ExtResultCode {
            ATTACH_CALLS.fetch_add(1, Ordering::SeqCst);
            EXT_ERR_REJECTED
        }

        let hub = test_hub();
        let request = load_request("webview");
        let error = probe_and_attach(
            &hub,
            &request,
            reserved_source(&hub),
            Some(failing_attach),
            ptr::null_mut(),
            stub_take_error,
            stub_free_string,
        )
        .unwrap_err();

        assert!(error.to_string().contains("attach"), "{error}");
        assert_eq!(ATTACH_CALLS.load(Ordering::SeqCst), 1);
        // The source is REVOKED, never left openable after a failed load,
        // and the current mapping never switched to it: a still-alive old
        // generation would keep delivering (B4 law).
        assert!(
            hub.current_source("app-1", "webview").is_none(),
            "a failed load must not pollute the current mapping"
        );
        assert!(!hub.note_loaded_and_open("app-1", "webview", "session-1"));
    }

    #[test]
    fn explicit_unsupported_attach_rejects_without_a_silent_fallback() {
        unsafe extern "C" fn unsupported_attach(
            _instance: *mut c_void,
            _port: ExtEventPortV1,
        ) -> ExtResultCode {
            EXT_ERR_UNSUPPORTED
        }

        let hub = test_hub();
        let request = load_request("webview");
        let error = probe_and_attach(
            &hub,
            &request,
            reserved_source(&hub),
            Some(unsupported_attach),
            ptr::null_mut(),
            stub_take_error,
            stub_free_string,
        )
        .unwrap_err();

        // Phase 1 manifests declare no legacy fallback, so an explicit
        // unsupported attach rejects the load instead of downgrading.
        let ExtensionError::Detailed { category, .. } = &error else {
            panic!("expected structured rejection, got: {error}");
        };
        assert_eq!(category, EVENT_PORT_UNSUPPORTED_CATEGORY);
    }

    #[test]
    fn malformed_ports_reject_as_event_port_abi_incompatible() {
        let hub = test_hub();
        let handle = hub
            .reserve_source("app-1".to_string(), "webview".to_string())
            .expect("source slot");
        let valid = handle.port();
        assert!(validate_port(&valid).is_ok());

        let mut bad_abi = valid;
        bad_abi.abi_version = EXT_EVENT_PORT_ABI_V1 + 1;
        assert!(matches!(
            validate_port(&bad_abi),
            Err(PortValidationError::AbiVersion(actual)) if actual == EXT_EVENT_PORT_ABI_V1 + 1
        ));

        let mut bad_size = valid;
        bad_size.struct_size = 0;
        assert!(matches!(
            validate_port(&bad_size),
            Err(PortValidationError::StructSize(0))
        ));

        let mut null_data = valid;
        null_data.port_data = ptr::null_mut();
        assert!(matches!(
            validate_port(&null_data),
            Err(PortValidationError::NullPortData)
        ));
        drop(handle);
    }

    #[test]
    fn source_limit_rejects_before_init_opens_any_instance() {
        static INIT_CALLS: AtomicUsize = AtomicUsize::new(0);
        static DEINIT_CALLS: AtomicUsize = AtomicUsize::new(0);
        unsafe extern "C" fn counting_init(
            _context: *const ExtContext,
            out_instance: *mut *mut c_void,
        ) -> ExtResultCode {
            INIT_CALLS.fetch_add(1, Ordering::SeqCst);
            *out_instance = 0x1 as *mut c_void;
            EXT_OK
        }
        unsafe extern "C" fn counting_deinit(_instance: *mut c_void) {
            DEINIT_CALLS.fetch_add(1, Ordering::SeqCst);
        }

        let hub = test_hub();
        for index in 0..crate::event_hub::EVENT_HUB_MAX_SOURCES {
            hub.reserve_source("app-1".to_string(), format!("gen{index}"))
                .expect("source slot");
        }

        let request = load_request("webview");
        let context = stub_context();
        let error = unsafe {
            init_and_attach(
                &hub,
                &request,
                &context,
                counting_init,
                counting_deinit,
                None,
                stub_take_error,
                stub_free_string,
            )
        }
        .unwrap_err();

        let ExtensionError::Detailed { category, message, .. } = &error else {
            panic!("expected structured rejection, got: {error}");
        };
        assert_eq!(category, EVENT_PORT_SOURCE_LIMIT_CATEGORY);
        assert!(message.contains("must be restarted"));
        assert_eq!(
            INIT_CALLS.load(Ordering::SeqCst),
            0,
            "no instance is opened after the limit"
        );
        assert_eq!(DEINIT_CALLS.load(Ordering::SeqCst), 0);
        assert!(hub.current_source("app-1", "webview").is_none());
    }

    /// D19 final review leak law: after a successful `init`, any attach
    /// failure must deterministically call the extension's `deinit` exactly
    /// once -- the `DynamicExtensionInstance` wrapper (whose `Drop` owns that
    /// call on the success path) is never constructed for a failed load.
    #[test]
    fn attach_failure_after_init_deinits_the_instance_exactly_once() {
        const INSTANCE_SENTINEL: usize = 0xBEEF;
        static INIT_CALLS: AtomicUsize = AtomicUsize::new(0);
        static ATTACH_CALLS: AtomicUsize = AtomicUsize::new(0);
        static DEINIT_CALLS: AtomicUsize = AtomicUsize::new(0);
        static DEINIT_SAW_INSTANCE: AtomicBool = AtomicBool::new(false);

        unsafe extern "C" fn counting_init(
            _context: *const ExtContext,
            out_instance: *mut *mut c_void,
        ) -> ExtResultCode {
            INIT_CALLS.fetch_add(1, Ordering::SeqCst);
            *out_instance = INSTANCE_SENTINEL as *mut c_void;
            EXT_OK
        }
        unsafe extern "C" fn failing_attach(
            _instance: *mut c_void,
            _port: ExtEventPortV1,
        ) -> ExtResultCode {
            ATTACH_CALLS.fetch_add(1, Ordering::SeqCst);
            EXT_ERR_REJECTED
        }
        unsafe extern "C" fn counting_deinit(instance: *mut c_void) {
            DEINIT_CALLS.fetch_add(1, Ordering::SeqCst);
            DEINIT_SAW_INSTANCE.store(instance as usize == INSTANCE_SENTINEL, Ordering::SeqCst);
        }

        let hub = test_hub();
        let request = load_request("webview");
        let context = stub_context();
        let error = unsafe {
            init_and_attach(
                &hub,
                &request,
                &context,
                counting_init,
                counting_deinit,
                Some(failing_attach),
                stub_take_error,
                stub_free_string,
            )
        }
        .unwrap_err();

        // The structured attach failure is preserved through the deinit path.
        assert!(error.to_string().contains("attach"), "{error}");
        assert_eq!(INIT_CALLS.load(Ordering::SeqCst), 1);
        assert_eq!(ATTACH_CALLS.load(Ordering::SeqCst), 1);
        assert_eq!(
            DEINIT_CALLS.load(Ordering::SeqCst),
            1,
            "exactly one deterministic deinit -- no native instance leaks"
        );
        assert!(
            DEINIT_SAW_INSTANCE.load(Ordering::SeqCst),
            "deinit received the initialized instance"
        );
        // The reserved source was revoked: not openable and not current.
        assert!(!hub.note_loaded_and_open("app-1", "webview", "session-1"));
        assert!(hub.current_source("app-1", "webview").is_none());
    }

    /// An `init` failure creates no instance: there is nothing to deinit,
    /// but the reserved source must be revoked so it can never be opened.
    #[test]
    fn init_failure_revokes_the_reserved_source_without_deinit() {
        static INIT_CALLS: AtomicUsize = AtomicUsize::new(0);
        static DEINIT_CALLS: AtomicUsize = AtomicUsize::new(0);
        unsafe extern "C" fn failing_init(
            _context: *const ExtContext,
            _out_instance: *mut *mut c_void,
        ) -> ExtResultCode {
            INIT_CALLS.fetch_add(1, Ordering::SeqCst);
            EXT_ERR_INTERNAL
        }
        unsafe extern "C" fn counting_deinit(_instance: *mut c_void) {
            DEINIT_CALLS.fetch_add(1, Ordering::SeqCst);
        }

        let hub = test_hub();
        let request = load_request("webview");
        let context = stub_context();
        let error = unsafe {
            init_and_attach(
                &hub,
                &request,
                &context,
                failing_init,
                counting_deinit,
                None,
                stub_take_error,
                stub_free_string,
            )
        }
        .unwrap_err();

        assert!(
            error.to_string().contains("internal error"),
            "init failure surfaces through the structured result: {error}"
        );
        assert_eq!(INIT_CALLS.load(Ordering::SeqCst), 1);
        assert_eq!(
            DEINIT_CALLS.load(Ordering::SeqCst),
            0,
            "init produced no instance; deinit must not run"
        );
        // The reserved source was revoked: the pending candidate is not
        // openable and nothing is current for the failed load.
        assert!(!hub.note_loaded_and_open("app-1", "webview", "session-1"));
        assert!(hub.current_source("app-1", "webview").is_none());
    }

    /// On the success path the helper must NOT deinit: the constructed
    /// `DynamicExtensionInstance`'s `Drop` owns revoke-before-deinit for the
    /// rest of the instance lifetime.
    #[test]
    fn successful_init_and_attach_leaves_deinit_to_the_instance_drop() {
        static INIT_CALLS: AtomicUsize = AtomicUsize::new(0);
        static DEINIT_CALLS: AtomicUsize = AtomicUsize::new(0);
        unsafe extern "C" fn counting_init(
            _context: *const ExtContext,
            out_instance: *mut *mut c_void,
        ) -> ExtResultCode {
            INIT_CALLS.fetch_add(1, Ordering::SeqCst);
            *out_instance = 0x1 as *mut c_void;
            EXT_OK
        }
        unsafe extern "C" fn counting_deinit(_instance: *mut c_void) {
            DEINIT_CALLS.fetch_add(1, Ordering::SeqCst);
        }
        unsafe extern "C" fn ok_attach(
            _instance: *mut c_void,
            _port: ExtEventPortV1,
        ) -> ExtResultCode {
            EXT_OK
        }

        let hub = test_hub();
        let request = load_request("webview");
        let context = stub_context();
        let (_instance, source, capability) = unsafe {
            init_and_attach(
                &hub,
                &request,
                &context,
                counting_init,
                counting_deinit,
                Some(ok_attach),
                stub_take_error,
                stub_free_string,
            )
        }
        .expect("successful load");

        assert_eq!(capability, PortCapability::DirectEventPort);
        assert_eq!(INIT_CALLS.load(Ordering::SeqCst), 1);
        assert_eq!(
            DEINIT_CALLS.load(Ordering::SeqCst),
            0,
            "the wrapper's Drop owns deinit on the success path"
        );
        // Dropping the source handle only revokes the EventPort source.
        drop(source);
        assert_eq!(DEINIT_CALLS.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn validates_required_symbols_as_a_single_abi_gate() {
        assert!(
            validate_required_extension_symbols(REQUIRED_EXTENSION_SYMBOLS.iter().copied()).is_ok()
        );

        let missing = validate_required_extension_symbols([
            EXT_SYMBOL_ABI_VERSION,
            EXT_SYMBOL_INIT,
        ])
        .unwrap_err();

        assert!(missing.contains(&EXT_SYMBOL_SESSION_CLOSED));
        assert!(missing.contains(&EXT_SYMBOL_DEINIT));
        assert!(missing.contains(&"opentray_ext_manifest"));
        assert!(missing.contains(&"opentray_ext_take_error"));
        // The V1 command symbol is no longer an unconditional requirement:
        // it left the base set for the four-cell matrix.
        assert!(!REQUIRED_EXTENSION_SYMBOLS.contains(&EXT_SYMBOL_COMMAND));
    }

    /// The four-cell command-surface matrix (R6 P1-4 frozen): V2-only loads
    /// with full capability, V1-only loads always-Immediate, both prefers
    /// V2, neither is an `abi_incompatible` rejection.
    #[test]
    fn command_surface_matrix_resolves_the_four_cells() {
        let base = REQUIRED_EXTENSION_SYMBOLS.to_vec();

        let v2_only = validate_extension_symbols(
            base.iter()
                .copied()
                .chain([EXT_SYMBOL_COMMAND_V2]),
        );
        assert_eq!(v2_only, SymbolGate::Admitted(CommandSurfaceCell::V2Only));

        let v1_only = validate_extension_symbols(
            base.iter()
                .copied()
                .chain([EXT_SYMBOL_COMMAND]),
        );
        assert_eq!(v1_only, SymbolGate::Admitted(CommandSurfaceCell::V1Only));

        let both = validate_extension_symbols(
            base.iter()
                .copied()
                .chain([EXT_SYMBOL_COMMAND, EXT_SYMBOL_COMMAND_V2]),
        );
        assert_eq!(both, SymbolGate::Admitted(CommandSurfaceCell::BothUseV2));

        let neither = validate_extension_symbols(base.iter().copied());
        assert_eq!(neither, SymbolGate::MissingCommandSurface);

        // Diagnostic labels land in the load log as frozen.
        assert_eq!(CommandSurfaceCell::V2Only.diagnostic_label(), "v2");
        assert_eq!(CommandSurfaceCell::BothUseV2.diagnostic_label(), "v2");
        assert_eq!(CommandSurfaceCell::V1Only.diagnostic_label(), "no-deferred");
        assert_eq!(CommandSurfaceCell::None.diagnostic_label(), "missing");
    }

    // -- V2 disposition decision table (task 2.2, stub FFI form) -----------
    //
    // The stubs stand in for a real extension library: each writes one
    // frozen disposition answer into the host-seeded struct, exactly as a
    // native V2 command entry would.

    fn v2_host() -> opentray_core::UnsupportedExtensionHostContext {
        opentray_core::UnsupportedExtensionHostContext
    }

    fn envelope_json() -> CString {
        CString::new(
            serde_json::to_vec(&opentray_spec::ExtensionEnvelope {
                scope: opentray_spec::ExtensionScope {
                    app_id: "app-1".to_string(),
                    tray_id: Some("tray-1".to_string()),
                    ext: "dialog".to_string(),
                },
                command_scope: None,
                data: serde_json::json!({ "type": "messageDialog" }),
            })
            .expect("envelope json"),
        )
        .expect("no nul byte")
    }

    unsafe extern "C" fn freeing_stub_free_string(
        ptr: *mut std::ffi::c_char,
        _len: usize,
    ) {
        if !ptr.is_null() {
            drop(unsafe { CString::from_raw(ptr) });
        }
    }

    fn write_events_json(out_events: *mut ExtOwnedBytes, envelopes: &serde_json::Value) {
        let json = serde_json::to_vec(envelopes).expect("events json");
        let value = CString::new(json).expect("no nul");
        let len = value.as_bytes().len();
        unsafe {
            *out_events = ExtOwnedBytes {
                ptr: value.into_raw(),
                len,
            };
        }
    }

    static SEEDED_TAG: AtomicU32 = AtomicU32::new(u32::MAX);
    static SEEDED_HANDLE: AtomicU64 = AtomicU64::new(0);

    unsafe extern "C" fn probe_and_immediate(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        out_events: *mut ExtOwnedBytes,
        out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        // Observe the host-seeded handle delivery, then answer Immediate.
        SEEDED_TAG.store((*out_disposition).tag, Ordering::SeqCst);
        SEEDED_HANDLE.store((*out_disposition).operation_handle(), Ordering::SeqCst);
        *out_disposition = ExtCommandDispositionV1::immediate();
        write_events_json(
            out_events,
            &serde_json::json!([{
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "dialog" },
                "data": { "type": "recorded" }
            }]),
        );
        EXT_OK
    }

    #[test]
    fn immediate_disposition_reads_the_seeded_handle_and_returns_events() {
        let issued_handle = 0x1234_5678_9abc_def0u64;
        let outcome = dispatch_command_v2(
            "dialog",
            probe_and_immediate,
            0x1 as *mut c_void,
            &envelope_json(),
            issued_handle,
            &mut v2_host(),
            stub_take_error,
            freeing_stub_free_string,
        )
        .expect("immediate dispatch");

        // The extension received the handle through the pre-seeded Deferred
        // disposition (one-way, single-use delivery).
        assert_eq!(SEEDED_TAG.load(Ordering::SeqCst), EXT_COMMAND_DISPOSITION_TAG_DEFERRED);
        assert_eq!(SEEDED_HANDLE.load(Ordering::SeqCst), issued_handle);

        let V2DispatchOutcome::Immediate(output) = outcome else {
            panic!("expected immediate outcome");
        };
        let events = read_owned_events(
            "dialog",
            output,
            freeing_stub_free_string,
            None,
        )
        .expect("events parse");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].data["type"], "recorded");
    }

    unsafe extern "C" fn deferred_no_events(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        _out_events: *mut ExtOwnedBytes,
        _out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        // Leaves the host-seeded Deferred disposition untouched.
        EXT_OK
    }

    #[test]
    fn deferred_disposition_with_empty_out_events_defers() {
        let outcome = dispatch_command_v2(
            "dialog",
            deferred_no_events,
            0x1 as *mut c_void,
            &envelope_json(),
            0xfeed,
            &mut v2_host(),
            stub_take_error,
            freeing_stub_free_string,
        )
        .expect("deferred dispatch");
        assert!(matches!(outcome, V2DispatchOutcome::Deferred));
    }

    // -- Non-null zero-length ownership cleanup (review P2) ------------------

    static NON_NULL_FREES: AtomicUsize = AtomicUsize::new(0);

    /// Counts `free_string` calls for non-null pointers. Every path below
    /// hands the stub a dangling-but-non-null pointer with length zero: the
    /// host must free it WITHOUT ever dereferencing it (no read touches a
    /// zero-length owned buffer), so the stub never reads through the
    /// pointer and cannot fault.
    unsafe extern "C" fn counting_free_string(
        ptr: *mut std::ffi::c_char,
        _len: usize,
    ) {
        if !ptr.is_null() {
            NON_NULL_FREES.fetch_add(1, Ordering::SeqCst);
        }
    }

    fn zero_length_owned_bytes() -> ExtOwnedBytes {
        ExtOwnedBytes {
            ptr: 0x1 as *mut std::ffi::c_char,
            len: 0,
        }
    }

    #[test]
    fn non_null_zero_length_event_buffers_are_still_freed() {
        NON_NULL_FREES.store(0, Ordering::SeqCst);
        let events = read_owned_events(
            "dialog",
            zero_length_owned_bytes(),
            counting_free_string,
            None,
        )
        .expect("zero-length events parse as empty");
        assert!(events.is_empty());
        assert_eq!(
            NON_NULL_FREES.load(Ordering::SeqCst),
            1,
            "a non-null zero-length owned allocation is freed, not leaked"
        );
    }

    #[test]
    fn non_null_zero_length_error_buffers_are_freed_before_rejecting() {
        NON_NULL_FREES.store(0, Ordering::SeqCst);
        let result: Result<ExtensionErrorDetail, _> = unsafe {
            read_owned_json(zero_length_owned_bytes(), counting_free_string, "extension error")
        };
        assert!(result.is_err(), "no JSON in a zero-length buffer");
        assert_eq!(
            NON_NULL_FREES.load(Ordering::SeqCst),
            1,
            "the rejection path still releases the owned buffer"
        );
    }

    unsafe extern "C" fn deferred_with_zero_length_events(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        out_events: *mut ExtOwnedBytes,
        _out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        // Defers AND leaves a non-null zero-length owned buffer behind: the
        // host must free it while still deferring.
        unsafe { *out_events = zero_length_owned_bytes() };
        EXT_OK
    }

    #[test]
    fn deferred_with_non_null_zero_length_out_events_frees_the_buffer() {
        NON_NULL_FREES.store(0, Ordering::SeqCst);
        let outcome = dispatch_command_v2(
            "dialog",
            deferred_with_zero_length_events,
            0x1 as *mut c_void,
            &envelope_json(),
            0xfeed,
            &mut v2_host(),
            stub_take_error,
            counting_free_string,
        )
        .expect("deferred dispatch");
        assert!(matches!(outcome, V2DispatchOutcome::Deferred));
        assert_eq!(
            NON_NULL_FREES.load(Ordering::SeqCst),
            1,
            "the non-null zero-length buffer is released on the deferred path"
        );
    }

    unsafe extern "C" fn deferred_with_events(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        out_events: *mut ExtOwnedBytes,
        _out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        // Protocol violation: defers AND writes out_events. The host must
        // free the buffer and deliver nothing, while the command still
        // defers.
        write_events_json(
            out_events,
            &serde_json::json!([{
                "scope": { "appId": "app-1", "trayId": "tray-1", "ext": "dialog" },
                "data": { "type": "must-not-deliver" }
            }]),
        );
        EXT_OK
    }

    #[test]
    fn deferred_with_non_empty_out_events_drops_the_events() {
        let outcome = dispatch_command_v2(
            "dialog",
            deferred_with_events,
            0x1 as *mut c_void,
            &envelope_json(),
            0xfeed,
            &mut v2_host(),
            stub_take_error,
            freeing_stub_free_string,
        )
        .expect("deferred dispatch despite the violation");
        assert!(
            matches!(outcome, V2DispatchOutcome::Deferred),
            "the command still defers; the events are dropped with a diagnostic"
        );
    }

    unsafe extern "C" fn immediate_with_leftover_value(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        out_events: *mut ExtOwnedBytes,
        out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        // Dual-output attempt: tags Immediate but leaves the handle in the
        // value union.
        *out_disposition = ExtCommandDispositionV1::deferred(0xdead);
        (*out_disposition).tag = EXT_COMMAND_DISPOSITION_TAG_IMMEDIATE;
        write_events_json(out_events, &serde_json::json!([]));
        EXT_OK
    }

    #[test]
    fn immediate_with_non_zero_value_is_the_dual_output_rejection() {
        let error = dispatch_command_v2(
            "dialog",
            immediate_with_leftover_value,
            0x1 as *mut c_void,
            &envelope_json(),
            0xfeed,
            &mut v2_host(),
            stub_take_error,
            freeing_stub_free_string,
        )
        .unwrap_err();
        let ExtensionError::Detailed { category, message, .. } = &error else {
            panic!("expected typed rejection, got: {error}");
        };
        assert_eq!(category, ABI_INCOMPATIBLE_CATEGORY);
        assert!(message.contains("disposition matrix"), "{message}");
    }

    unsafe extern "C" fn unknown_tag(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        _out_events: *mut ExtOwnedBytes,
        out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        (*out_disposition).tag = 7;
        EXT_OK
    }

    #[test]
    fn unknown_disposition_tag_rejects_without_guessing() {
        let error = dispatch_command_v2(
            "dialog",
            unknown_tag,
            0x1 as *mut c_void,
            &envelope_json(),
            0xfeed,
            &mut v2_host(),
            stub_take_error,
            stub_free_string,
        )
        .unwrap_err();
        let ExtensionError::Detailed { category, message, .. } = &error else {
            panic!("expected typed rejection, got: {error}");
        };
        assert_eq!(category, ABI_INCOMPATIBLE_CATEGORY);
        assert!(message.contains("unknown disposition tag 7"), "{message}");
    }

    unsafe extern "C" fn nonzero_reserved(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        _out_events: *mut ExtOwnedBytes,
        out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        (*out_disposition).reserved = 1;
        EXT_OK
    }

    #[test]
    fn nonzero_reserved_field_rejects_without_guessing() {
        let error = dispatch_command_v2(
            "dialog",
            nonzero_reserved,
            0x1 as *mut c_void,
            &envelope_json(),
            0xfeed,
            &mut v2_host(),
            stub_take_error,
            stub_free_string,
        )
        .unwrap_err();
        let ExtensionError::Detailed { category, message, .. } = &error else {
            panic!("expected typed rejection, got: {error}");
        };
        assert_eq!(category, ABI_INCOMPATIBLE_CATEGORY);
        assert!(message.contains("reserved"), "{message}");
    }

    unsafe extern "C" fn forged_handle_echo(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        _out_events: *mut ExtOwnedBytes,
        out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        *out_disposition = ExtCommandDispositionV1::deferred(0x0bad_f00d);
        EXT_OK
    }

    #[test]
    fn deferred_with_self_forged_handle_is_a_typed_rejection() {
        let error = dispatch_command_v2(
            "dialog",
            forged_handle_echo,
            0x1 as *mut c_void,
            &envelope_json(),
            0xfeed,
            &mut v2_host(),
            stub_take_error,
            stub_free_string,
        )
        .unwrap_err();
        let ExtensionError::Detailed { category, message, .. } = &error else {
            panic!("expected typed rejection, got: {error}");
        };
        assert_eq!(category, ABI_INCOMPATIBLE_CATEGORY);
        assert!(message.contains("instead of the issued"), "{message}");
    }

    unsafe extern "C" fn failing_v2_command(
        _instance: *mut c_void,
        _context: *const ExtHostContext,
        _envelope: ExtBytes,
        _out_events: *mut ExtOwnedBytes,
        _out_disposition: *mut ExtCommandDispositionV1,
    ) -> ExtResultCode {
        EXT_ERR_INTERNAL
    }

    #[test]
    fn v2_call_failure_surfaces_the_structured_result_error() {
        let error = dispatch_command_v2(
            "dialog",
            failing_v2_command,
            0x1 as *mut c_void,
            &envelope_json(),
            0xfeed,
            &mut v2_host(),
            stub_take_error,
            stub_free_string,
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("internal error"),
            "result-code failure surfaces through the structured path: {error}"
        );
    }

    // -- DeferredPort attach matrix (task 2.2, EventPort stub form) --------

    static ATTACH_CALLS: AtomicUsize = AtomicUsize::new(0);
    static CAPTURED_PORT_DATA: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    unsafe extern "C" fn ok_deferred_attach(
        _instance: *mut c_void,
        port: opentray_spec::ExtDeferredPortV1,
    ) -> ExtResultCode {
        ATTACH_CALLS.fetch_add(1, Ordering::SeqCst);
        // By-value law: the extension copies only port_data; the struct
        // address is not retained beyond the call.
        CAPTURED_PORT_DATA.store(port.port_data as usize, Ordering::SeqCst);
        EXT_OK
    }

    /// Attach-teardown fixture: the port state addressed by the copied
    /// `port_data` outlives the by-value struct handed into attach -- the
    /// extension may never keep the struct pointer, and the host state stays
    /// live after attach returns.
    #[test]
    fn deferred_port_attach_is_by_value_and_state_outlives_the_struct() {
        let registry = operations_registry();
        let hub = test_deferred_hub(&registry);
        let request = load_request("dialog");

        let handle = attach_deferred_port(
            &hub,
            &request,
            0x1 as *mut c_void,
            ok_deferred_attach,
            stub_take_error,
            stub_free_string,
        )
        .expect("attach");

        assert_eq!(ATTACH_CALLS.load(Ordering::SeqCst), 1);
        let captured = CAPTURED_PORT_DATA.load(Ordering::SeqCst) as *mut c_void;
        assert!(!captured.is_null());

        // The copy taken inside attach (before this fn returned) still
        // addresses live state: the LoadExt ACK opens the channel and the
        // lifecycle revoke closes it again.
        assert!(hub.open_port("app-1", "dialog", "session-1"));
        assert!(handle.revoke());
        assert!(!handle.revoke(), "revoke is idempotent");
    }

    #[test]
    fn failed_deferred_attach_rejects_and_revokes_the_port() {
        unsafe extern "C" fn failing_deferred_attach(
            _instance: *mut c_void,
            _port: opentray_spec::ExtDeferredPortV1,
        ) -> ExtResultCode {
            EXT_ERR_REJECTED
        }

        let registry = operations_registry();
        let hub = test_deferred_hub(&registry);
        let request = load_request("dialog");

        let error = attach_deferred_port(
            &hub,
            &request,
            0x1 as *mut c_void,
            failing_deferred_attach,
            stub_take_error,
            stub_free_string,
        )
        .unwrap_err();
        assert!(error.to_string().contains("attach"), "{error}");
        // The failed load leaves no openable port behind.
        assert!(!hub.open_port("app-1", "dialog", "session-1"));
    }

    // -- Identity chain (task 2.3, design design section 6.4) -----------------------------

    #[test]
    fn expected_sha256_gates_the_library_bytes_before_dlopen() {
        let root = std::env::temp_dir().join(format!(
            "opentray-ext-sha-{}-{}",
            std::process::id(),
            SEEDED_HANDLE.load(Ordering::SeqCst),
        ));
        std::fs::create_dir_all(&root).unwrap();
        let library = root.join("libopentray_ext_dialog.dylib");
        std::fs::write(&library, b"artifact-bytes").unwrap();
        let sha = format!("{:x}", Sha256::digest(b"artifact-bytes"));

        let mut request = load_request("dialog");
        request.path = library.to_string_lossy().into_owned();

        // Absent expectation: no gate, load proceeds.
        assert!(verify_library_sha256(&library, &request).is_ok());

        // Matching expectation (case-insensitive hex): admitted.
        request.expected_identity.sha256 = Some(sha.clone());
        assert!(verify_library_sha256(&library, &request).is_ok());
        request.expected_identity.sha256 = Some(sha.to_uppercase());
        assert!(verify_library_sha256(&library, &request).is_ok());

        // Mismatching bytes (real byte replacement, not a JSON claim): typed
        // artifact-identity rejection naming both hashes.
        std::fs::write(&library, b"swapped-bytes").unwrap();
        let error = verify_library_sha256(&library, &request).unwrap_err();
        let ExtensionError::Detailed { category, message, .. } = &error else {
            panic!("expected typed rejection, got: {error}");
        };
        assert_eq!(category, ARTIFACT_IDENTITY_MISMATCH_CATEGORY);
        assert!(message.contains(&sha.to_uppercase()), "{message}");
        let swapped_sha = format!("{:x}", Sha256::digest(b"swapped-bytes"));
        assert!(
            message.contains(&swapped_sha),
            "the rejection names the swapped-file hash: {message}"
        );
        assert!(message.contains("path="), "{message}");

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn expected_build_identity_gates_the_native_manifest() {
        let mut expected = expected_extension_identity("dialog");
        expected.build_identity = Some("build-42".to_string());

        let matching = opentray_spec::EmbeddedExtensionManifest {
            extension_name: "dialog".to_string(),
            abi_version: EXT_ABI_VERSION,
            artifact_set_version: "current".to_string(),
            contract_fingerprint: "current-contract".to_string(),
            target: expected.target.clone(),
            build_identity: "build-42".to_string(),
        };
        assert!(validate_extension_manifest(&expected, &matching).is_ok());

        let skewed = opentray_spec::EmbeddedExtensionManifest {
            build_identity: "build-41".to_string(),
            ..matching
        };
        let error = validate_extension_manifest(&expected, &skewed).unwrap_err();
        assert!(
            error.to_string().contains("build-41") && error.to_string().contains("build-42"),
            "evidence carries both identities: {error}"
        );
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
        // The exact-request contract is about absolute paths, and
        // `Path::is_absolute` is platform truth: a POSIX `/...` literal is
        // rooted but not absolute on Windows (no drive prefix), so the
        // fixture builds a path that is absolute on the running host
        // (Windows real-machine batch C evidence).
        let exact = if cfg!(windows) {
            PathBuf::from(r"C:\facade\current\opentray_ext_webview.dll")
        } else {
            PathBuf::from("/facade/current/libopentray_ext_webview.dylib")
        };
        let discovery = ExtensionDiscovery::for_test(
            Some(PathBuf::from("/home/me")),
            vec![PathBuf::from("/diagnostic/libopentray_ext_webview.dylib")],
        );
        let request = ExtensionLoadRequest {
            app_id: "app-1".to_string(),
            name: "webview".to_string(),
            path: exact.to_string_lossy().into_owned(),
            expected_identity: expected_extension_identity("webview"),
            mount_id: None,
        };

        assert_eq!(discovery.candidates(&request), vec![exact]);
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
        // Separator-agnostic home-candidate assertion: Path::join emits `\` on
        // Windows, so compare components instead of the literal POSIX prefix
        // (real-machine batch B evidence).
        assert!(candidates.iter().any(|path| path
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .windows(3)
            .any(|window| window == [".opentray", "extensions", "webview"])));
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
                    details: None,
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
    fn candidate_error_categories_use_only_spec_statuses() {
        let categories = [
            candidate_error_category(&ExtensionError::NotFound("missing".to_string())),
            candidate_error_category(&ExtensionError::Rejected("invalid manifest".to_string())),
            candidate_error_category(&ExtensionError::Detailed {
                category: "abi_incompatible".to_string(),
                message: "extension missing symbol init".to_string(),
                details: None,
            }),
            candidate_error_category(&ExtensionError::Detailed {
                category: "artifact_identity_mismatch".to_string(),
                message: "old".to_string(),
                details: None,
            }),
            candidate_error_category(&ExtensionError::Unsupported(
                "extension missing symbol is only text".to_string(),
            )),
        ];

        assert_eq!(
            categories,
            [
                "missing",
                "unreadable",
                "abi-incompatible",
                "identity-incompatible",
                "unreadable",
            ]
        );
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
                details: None,
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
