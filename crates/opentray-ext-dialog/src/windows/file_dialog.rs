//! IFileOpenDialog / IFileSaveDialog surface (add-ext-dialog design
//! sections 1.1/2.2/3, task 3.3).
//!
//! Every COM object is created, configured, shown, and released on the
//! owning STA worker thread. The dismissal path never touches a COM
//! surface: the dispatcher close posts `WM_CLOSE` to the thread's
//! non-dispatcher windows (see `close_file_dialog_on_worker_thread` in
//! `worker.rs`, batch E P0), the dialog's own pump ends `Show` with
//! `ERROR_CANCELLED`, and the existing cancel branch below settles the
//! terminal — so no interface pointer is ever published or reentered
//! from the modal pump.
//!
//! Documented win32 projection degradations (kept visible, never silent):
//! - `showsHidden` follows the Explorer "hidden items" setting: the Vista+
//!   common dialog has no `FOS_*` flag for hidden items.
//! - `createDirectories` is always-true in the common save panel (the
//!   switch is accepted and ignored; design section 3).
//! - `multiple` is only read for `pickFile` (the shared option set keeps
//!   one field); pickers that cannot multi-select never set the flag.
//!
//! Entry evidence for `IFileDialog::Show` is entering the call itself —
//! the API has no prior presentation signal, and the design freezes that
//! honesty (never claim presentation before the call).

use std::sync::atomic::Ordering;
use std::sync::Arc;

use opentray_spec::ExtOperationPayload;
use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CLSCTX_INPROC_SERVER,
};
use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
use windows::Win32::UI::Shell::{
    FileOpenDialog, FileSaveDialog, IFileDialog, IFileOpenDialog, IFileSaveDialog, IModalWindow,
    IShellItem, IShellItemArray, SHCreateItemFromParsingName, FILEOPENDIALOGOPTIONS,
    FOS_ALLOWMULTISELECT, FOS_DONTADDTORECENT, FOS_FILEMUSTEXIST, FOS_NOCHANGEDIR,
    FOS_OVERWRITEPROMPT, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, FOS_STRICTFILETYPES,
    SIGDN_FILESYSPATH,
};

use super::ffi::{take_wide_string, HRESULT_ERROR_CANCELLED};
use super::worker::{DialogTarget, WorkerShared};
use crate::options::error_code;
use crate::options::{
    terminal, CommonPickOptions, DialogFileFilter, PickDirectoryOptions, PickFileOptions,
    SavePickOptions,
};
use crate::state::{canonicalize_existing, canonicalize_save_leaf, split_default_path, typed_error};

/// One configured picker to run. Constructed from the parsed command; the
/// discriminant already carries the win32 namespace of its verb.
pub(super) enum PickSurface {
    OpenFile(PickFileOptions),
    OpenDirectory(PickDirectoryOptions),
    Save(SavePickOptions),
}

impl PickSurface {
    pub(super) fn common(&self) -> &CommonPickOptions {
        match self {
            Self::OpenFile(options) => &options.common,
            Self::OpenDirectory(options) => &options.common,
            Self::Save(options) => &options.common,
        }
    }

    fn base_options(&self) -> FILEOPENDIALOGOPTIONS {
        let mut flags = FILEOPENDIALOGOPTIONS(0);
        match self {
            Self::OpenFile(_) => {
                flags |= FOS_PATHMUSTEXIST | FOS_FILEMUSTEXIST;
                if matches!(self, Self::OpenFile(options) if options.multiple) {
                    flags |= FOS_ALLOWMULTISELECT;
                }
            }
            Self::OpenDirectory(_) => {
                flags |= FOS_PICKFOLDERS | FOS_PATHMUSTEXIST;
            }
            Self::Save(_) => {
                flags |= FOS_OVERWRITEPROMPT;
            }
        }
        flags |= FOS_NOCHANGEDIR;
        if !self.add_to_recent() {
            flags |= FOS_DONTADDTORECENT;
        }
        if matches!(self, Self::Save(options) if options.win32.strict_file_types) {
            flags |= FOS_STRICTFILETYPES;
        }
        flags
    }

    fn add_to_recent(&self) -> bool {
        match self {
            Self::OpenFile(options) => options.win32.add_to_recent,
            Self::OpenDirectory(options) => options.win32.add_to_recent,
            Self::Save(options) => options.win32.add_to_recent,
        }
    }
}

/// Runs one picker to completion on the worker thread.
pub(super) fn show_pick(
    surface: &PickSurface,
    shared: &Arc<WorkerShared>,
) -> Result<ExtOperationPayload, opentray_spec::TypedExtensionError> {
    // A close that raced construction collapses into the cancel branch
    // without entering Show (no entry signal, no Accepted).
    if shared.close_requested.load(Ordering::Acquire) {
        return Ok(ExtOperationPayload::Result {
            value: terminal::picker_canceled(),
        });
    }

    match surface {
        PickSurface::OpenFile(options) => show_open_dialog(surface, options.multiple, shared),
        PickSurface::OpenDirectory(_) => show_open_dialog(surface, false, shared),
        PickSurface::Save(options) => show_save_dialog(surface, options, shared),
    }
}

fn show_open_dialog(
    surface: &PickSurface,
    multiple: bool,
    shared: &Arc<WorkerShared>,
) -> Result<ExtOperationPayload, opentray_spec::TypedExtensionError> {
    // SAFETY: COM is initialized STA on this worker thread; the class id and
    // context are constants; the returned interface is owned and released by
    // the wrapper.
    let open: IFileOpenDialog =
        unsafe { CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER) }
            .map_err(construction_failure)?;
    // `Interface::cast` (QueryInterface) is safe in the windows 0.61
    // binding: it returns a Result and releases on failure.
    let dialog: IFileDialog = open.cast().map_err(construction_failure)?;

    configure(&dialog, surface)?;

    run_show_and_extract(&dialog, shared, || {
        // SAFETY: the dialog confirmed; GetResults/GetResult are valid now.
        if multiple {
            let results: IShellItemArray = unsafe { open.GetResults() }
                .map_err(post_entry_failure)?;
            let count = unsafe { results.GetCount() }.map_err(post_entry_failure)?;
            let mut paths = Vec::with_capacity(count as usize);
            for index in 0..count {
                let item: IShellItem = unsafe { results.GetItemAt(index) }
                    .map_err(post_entry_failure)?;
                paths.push(display_path(&item)?);
            }
            if paths.is_empty() {
                // A confirmed multiple selection carries at least one entry
                // (design section 1.2); an empty result collapses to the
                // cancel branch.
                Ok(ExtOperationPayload::Result {
                    value: terminal::picker_canceled(),
                })
            } else {
                Ok(ExtOperationPayload::Result {
                    value: terminal::pick_file_paths(paths),
                })
            }
        } else {
            let item: IShellItem = unsafe { dialog.GetResult() }.map_err(post_entry_failure)?;
            let path = display_path(&item)?;
            Ok(ExtOperationPayload::Result {
                value: terminal::pick_single_path(path),
            })
        }
    })
}

fn show_save_dialog(
    surface: &PickSurface,
    options: &SavePickOptions,
    shared: &Arc<WorkerShared>,
) -> Result<ExtOperationPayload, opentray_spec::TypedExtensionError> {
    // SAFETY: STA on this thread; constants; wrapper owns the release.
    let save: IFileSaveDialog =
        unsafe { CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER) }
            .map_err(construction_failure)?;
    // `Interface::cast` (ancestor QueryInterface), safe in the 0.61 binding.
    let dialog: IFileDialog = save.cast().map_err(construction_failure)?;

    configure(&dialog, surface)?;
    if let Some(extension) = &options.win32.default_extension {
        // SAFETY: live interface; the HSTRING outlives the call.
        unsafe { dialog.SetDefaultExtension(&HSTRING::from(extension.as_str())) }
            .map_err(construction_failure)?;
    }

    run_show_and_extract(&dialog, shared, || {
        // SAFETY: confirmed dialog; GetResult is valid now.
        let item: IShellItem = unsafe { dialog.GetResult() }.map_err(post_entry_failure)?;
        let path = display_path(&item)?;
        // The save leaf need not exist: canonicalize the parent, rejoin.
        Ok(ExtOperationPayload::Result {
            value: terminal::pick_single_path(canonicalize_save_leaf(&path)),
        })
    })
}

/// Applies the shared + win32 namespace options to one dialog.
fn configure(
    dialog: &IFileDialog,
    surface: &PickSurface,
) -> Result<(), opentray_spec::TypedExtensionError> {
    let common = surface.common();

    // Options first: base flags + additions.
    // SAFETY: live interface on this thread.
    unsafe { dialog.SetOptions(surface.base_options()) }.map_err(construction_failure)?;

    // Filters: an absent/empty list leaves the "all files" default; specs
    // are `*.ext;*.ext2` patterns from the bare extension list. The wide
    // buffers live in this frame and outlive the SetFileTypes call.
    let filter_list = common
        .filters
        .as_ref()
        .filter(|list| !list.is_empty() && list.iter().all(|filter| !filter.extensions.is_empty()));
    if let Some(filters) = filter_list {
        let names: Vec<Vec<u16>> = filters.iter().map(filter_spec_name).collect();
        let patterns: Vec<Vec<u16>> = filters.iter().map(filter_spec_pattern).collect();
        let specs: Vec<COMDLG_FILTERSPEC> = names
            .iter()
            .zip(patterns.iter())
            .map(|(name, pattern)| COMDLG_FILTERSPEC {
                pszName: PCWSTR(name.as_ptr()),
                pszSpec: PCWSTR(pattern.as_ptr()),
            })
            .collect();
        // SAFETY: the slice references the `names`/`patterns` buffers above,
        // which outlive this call.
        unsafe { dialog.SetFileTypes(&specs) }.map_err(construction_failure)?;
        // defaultFilterIndex preselects the group (API is 1-based). An
        // out-of-range index is a facade-validation leak: ignored, never
        // fatal.
        if let PickSurface::Save(options) = surface {
            if let Some(index) = options.default_filter_index {
                if index < filters.len() {
                    // SAFETY: live interface; 1-based index within range.
                    unsafe { dialog.SetFileTypeIndex(index as u32 + 1) }
                        .map_err(construction_failure)?;
                }
            }
        }
    }

    if let Some(title) = &common.title {
        // SAFETY: live interface; HSTRING outlives the call.
        unsafe { dialog.SetTitle(&HSTRING::from(title.as_str())) }.map_err(construction_failure)?;
    }
    if let Some(label) = &common.file_name_label {
        // SAFETY: live interface; HSTRING outlives the call.
        unsafe { dialog.SetFileNameLabel(&HSTRING::from(label.as_str())) }
            .map_err(construction_failure)?;
    }
    let ok_label = match surface {
        PickSurface::OpenFile(options) => options.win32.ok_button_label.as_deref(),
        PickSurface::Save(options) => options.win32.ok_button_label.as_deref(),
        PickSurface::OpenDirectory(_) => None,
    };
    if let Some(label) = ok_label {
        // SAFETY: live interface.
        unsafe { dialog.SetOkButtonLabel(&HSTRING::from(label)) }
            .map_err(construction_failure)?;
    }

    // Default path: directory (and the save leaf).
    let (directory, file_name) =
        split_default_path(common.default_path.as_deref().unwrap_or(""));
    if let Some(directory) = directory {
        // SAFETY: parsing-name creation on this STA thread; null bind
        // context; the item is owned by the wrapper.
        let item: IShellItem =
            unsafe { SHCreateItemFromParsingName(&HSTRING::from(directory.as_str()), None) }
                .map_err(|_| {
                    typed_error(
                        error_code::PRESENTATION_FAILED,
                        format!("the defaultPath directory {directory:?} could not be opened"),
                    )
                })?;
        // SAFETY: live item and dialog on this thread.
        unsafe { dialog.SetFolder(&item) }.map_err(construction_failure)?;
    }
    if let Some(file_name) = file_name {
        // SAFETY: live interface.
        unsafe { dialog.SetFileName(&HSTRING::from(file_name.as_str())) }
            .map_err(construction_failure)?;
    }
    Ok(())
}

/// Runs `Show` (the modal) after publishing the close target and firing the
/// entry handshake, then extracts the payload through `extract`.
fn run_show_and_extract(
    dialog: &IFileDialog,
    shared: &Arc<WorkerShared>,
    extract: impl FnOnce() -> Result<ExtOperationPayload, opentray_spec::TypedExtensionError>,
) -> Result<ExtOperationPayload, opentray_spec::TypedExtensionError> {
    // The dismissal target: no COM surface is published (batch E P0) —
    // the close path posts `WM_CLOSE` to the thread's windows instead.
    *shared.target.lock().unwrap_or_else(|error| error.into_inner()) = DialogTarget::FileDialog;

    // The IModalWindow cast precedes entry (design section 5.3: entering
    // the Show call is the evidence): its failure is a PRE-entry failure —
    // the worker never claimed Accepted, so run_worker's transaction
    // delivers the typed error through the entry handshake and never
    // submits a terminal.
    let modal: IModalWindow = match dialog.cast() {
        Ok(modal) => modal,
        Err(error) => {
            *shared.target.lock().unwrap_or_else(|error| error.into_inner()) =
                DialogTarget::None;
            return Err(construction_failure(error));
        }
    };

    // Entry evidence: entering the Show call (no prior presentation signal
    // exists for IFileDialog — design section 5.3). Records the entered
    // state that gates every later terminal decision.
    let handshake_alive = shared.send_entry_entered("IFileDialog::Show-entry");

    // SAFETY: the modal call runs on the owning STA thread.
    let show = unsafe { modal.Show(None) };

    *shared.target.lock().unwrap_or_else(|error| error.into_inner()) = DialogTarget::None;

    if !handshake_alive {
        // The host side already answered (pre-Accept timeout): finish
        // silently without a terminal.
        return Ok(ExtOperationPayload::Result {
            value: terminal::picker_canceled(),
        });
    }

    match show {
        Ok(()) => extract(),
        Err(error) if error.code().0 == HRESULT_ERROR_CANCELLED => {
            // User dismissal (title bar/ESC/system close): the picker null
            // branch (design section 1.2).
            Ok(ExtOperationPayload::Result {
                value: terminal::picker_canceled(),
            })
        }
        Err(error) => Err(post_entry_failure(error)),
    }
}

/// Reads one item's absolute filesystem path and canonicalizes it.
fn display_path(item: &IShellItem) -> Result<String, opentray_spec::TypedExtensionError> {
    // SAFETY: live item; the returned PWSTR is freed by the helper.
    let raw = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }.map_err(post_entry_failure)?;
    // `windows`-core PWSTR (newtype) -> the raw pointer the helper takes.
    // SAFETY: the PWSTR is CoTaskMem-allocated by the shell and freed by
    // the helper exactly once.
    let path = unsafe { take_wide_string(raw.0) };
    if path.is_empty() {
        return Err(typed_error(
            error_code::DISMISSAL_UNAVAILABLE,
            "the confirmed selection reported no filesystem path",
        ));
    }
    Ok(canonicalize_existing(&path))
}

fn construction_failure(error: windows::core::Error) -> opentray_spec::TypedExtensionError {
    typed_error(
        error_code::PRESENTATION_FAILED,
        format!("the native file dialog could not be constructed: {}", error),
    )
}

fn post_entry_failure(error: windows::core::Error) -> opentray_spec::TypedExtensionError {
    typed_error(
        error_code::PRESENTATION_FAILED,
        format!("the native file dialog failed after presentation: {}", error),
    )
}

// ---------------------------------------------------------------------------
// Filter pattern helpers
// ---------------------------------------------------------------------------

/// Renders one filter's display name as a null-terminated UTF-16 buffer.
fn filter_spec_name(filter: &DialogFileFilter) -> Vec<u16> {
    let mut buffer = filter.name.encode_utf16().collect::<Vec<u16>>();
    buffer.push(0);
    buffer
}

/// Renders one filter's extension list as the `*.ext;*.ext2` pattern
/// buffer (`COMDLG_FILTERSPEC` semantics).
fn filter_spec_pattern(filter: &DialogFileFilter) -> Vec<u16> {
    let pattern = if filter.extensions.is_empty() {
        // Defense in depth: the facade rejects empty extension groups, but
        // the renderer stays total — a lone glob instead of an empty spec
        // string (an empty COMDLG_FILTERSPEC pattern is meaningless).
        "*.".to_string()
    } else {
        filter
            .extensions
            .iter()
            .map(|extension| format!("*.{extension}"))
            .collect::<Vec<_>>()
            .join(";")
    };
    let mut buffer = pattern.encode_utf16().collect::<Vec<u16>>();
    buffer.push(0);
    buffer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_patterns_are_bare_extension_glob_lists() {
        let filter = DialogFileFilter {
            name: "Text".to_string(),
            extensions: vec!["txt".to_string(), "md".to_string()],
        };
        let pattern = filter_spec_pattern(&filter);
        let text: String = String::from_utf16_lossy(&pattern[..pattern.len() - 1]);
        assert_eq!(text, "*.txt;*.md");
    }

    #[test]
    fn empty_extension_group_renders_a_lone_glob() {
        // The facade rejects empty extension groups; defense in depth keeps
        // the renderer total anyway.
        let filter = DialogFileFilter {
            name: "All".to_string(),
            extensions: vec![],
        };
        let pattern = filter_spec_pattern(&filter);
        let text: String = String::from_utf16_lossy(&pattern[..pattern.len() - 1]);
        assert_eq!(text, "*.");
    }
}
