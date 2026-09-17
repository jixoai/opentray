//! TaskDialog surface and MessageBox fallback for message dialogs
//! (add-ext-dialog design sections 1.1/2.2/3/5.3).
//!
//! Projection decisions (frozen):
//! - `message` maps to the TaskDialog main instruction; `detail` maps to
//!   the content body (design section 3's win32 column).
//! - Command links encode their per-button note as the second line of the
//!   button text (`heading\nnote`), the documented TaskDialog command-link
//!   form; `buttonHints` are index-aligned.
//! - `TDN_CREATED` is the presentation evidence: the Accepted handshake
//!   fires there, never at call time (design section 5.3's honest
//!   semantics).
//! - MessageBox fallback (no comctl32 v6): fixed platform button sets map
//!   BY POSITION (OK→0; OK/Cancel; Yes/No/Cancel), custom labels are not
//!   expressible, the suppression checkbox cannot render (`suppressed`
//!   reports false), and footer/expander/commandLink requests never reach
//!   this path — the host rejects them as typed
//!   `dialog_capability_unavailable` before spawning a worker.
//!
//! Every function here runs on the owning STA worker thread only.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use opentray_spec::ExtOperationPayload;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDNO, IDOK, IDYES, MB_DEFBUTTON2, MB_DEFBUTTON3, MB_ICONERROR, MB_ICONINFORMATION,
    MB_ICONWARNING, MB_OK, MB_OKCANCEL, MB_YESNOCANCEL, MESSAGEBOX_STYLE,
};

use super::capability::TaskDialogSurface;
use super::ffi::{
    wide, TaskDialogButton, TaskDialogConfig, CUSTOM_BUTTON_ID_BASE, IDCANCEL, S_OK, TDN_CREATED,
    TDF_ALLOW_CANCELLATION, TDF_EXPANDED_BY_DEFAULT, TDF_SIZE_TO_CONTENT, TDF_USE_COMMAND_LINKS,
    TD_ERROR_ICON, TD_INFORMATION_ICON, TD_WARNING_ICON,
};
use super::worker::{DialogTarget, WorkerShared};
use crate::options::error_code;
use crate::options::{
    terminal, ButtonStyle, DialogSeverity, MessageDialogOptions, MessageDialogResult,
    Win32MessageNamespace,
};
use crate::state::typed_error;

/// Runs one message dialog through TaskDialogIndirect. The entry handshake
/// (`Entered`) fires from the `TDN_CREATED` callback.
pub(super) fn show_task_dialog(
    options: &MessageDialogOptions,
    ns: &Win32MessageNamespace,
    shared: &Arc<WorkerShared>,
    surface: TaskDialogSurface,
) -> Result<ExtOperationPayload, opentray_spec::TypedExtensionError> {
    debug_assert!(
        super::capability::probe_task_dialog_surface().is_some(),
        "the TaskDialog path requires the probed comctl32 v6 surface"
    );

    // A close that raced construction collapses into the dismissal branch
    // without entering the modal (no entry signal, no Accepted).
    if shared.close_requested.load(Ordering::Acquire) {
        return Ok(dismissal_payload(options));
    }

    // Wide strings outlive the call; every config pointer references one of
    // these buffers.
    let main_instruction = wide(&options.message);
    let content = options.detail.as_deref().map(wide);
    let footer = ns.footer.as_deref().map(wide);
    let verification = options.suppression_label.as_deref().map(wide);
    let expanded_information = ns
        .expander
        .as_ref()
        .map(|expander| wide(&expander.expanded_information));
    let expanded_control_text = ns
        .expander
        .as_ref()
        .and_then(|expander| expander.label.as_deref())
        .map(wide);

    let command_links = ns.button_style == ButtonStyle::CommandLink;
    let mut button_texts: Vec<Vec<u16>> = Vec::with_capacity(options.buttons.len());
    for (index, label) in options.buttons.iter().enumerate() {
        let mut text = label.clone();
        if command_links {
            if let Some(Some(hint)) = ns.button_hints.get(index) {
                // The documented command-link two-line form: heading\nnote.
                text.push('\n');
                text.push_str(hint);
            }
        }
        button_texts.push(wide(&text));
    }
    let buttons: Vec<TaskDialogButton> = button_texts
        .iter()
        .enumerate()
        .map(|(index, text)| TaskDialogButton {
            n_button_id: CUSTOM_BUTTON_ID_BASE + index as i32,
            psz_button_text: text.as_ptr(),
        })
        .collect();

    let mut flags = TDF_SIZE_TO_CONTENT;
    if ns.allow_cancel_on_close {
        // P0-6: every closable dialog enables cancellation by default.
        flags |= TDF_ALLOW_CANCELLATION;
    }
    if command_links {
        flags |= TDF_USE_COMMAND_LINKS;
    }
    if ns
        .expander
        .as_ref()
        .is_some_and(|expander| expander.expanded_by_default)
    {
        flags |= TDF_EXPANDED_BY_DEFAULT;
    }

    let config = TaskDialogConfig {
        cb_size: std::mem::size_of::<TaskDialogConfig>() as u32,
        hwnd_parent: std::ptr::null_mut(),
        h_instance: std::ptr::null_mut(),
        dw_flags: flags,
        psz_window_title: std::ptr::null(),
        main_icon: match options.severity {
            DialogSeverity::Info => TD_INFORMATION_ICON,
            DialogSeverity::Warning => TD_WARNING_ICON,
            DialogSeverity::Error => TD_ERROR_ICON,
        },
        psz_main_instruction: main_instruction.as_ptr(),
        psz_content: content.as_deref().map_or(std::ptr::null(), |buffer| {
            buffer.as_ptr()
        }),
        c_buttons: buttons.len() as u32,
        p_buttons: buttons.as_ptr(),
        n_default_button: CUSTOM_BUTTON_ID_BASE + options.default_id.unwrap_or(0) as i32,
        c_radio_buttons: 0,
        p_radio_buttons: std::ptr::null(),
        n_default_radio_button: 0,
        psz_verification_text: verification
            .as_deref()
            .map_or(std::ptr::null(), |buffer| buffer.as_ptr()),
        psz_expanded_information: expanded_information
            .as_deref()
            .map_or(std::ptr::null(), |buffer| buffer.as_ptr()),
        psz_expanded_control_text: expanded_control_text
            .as_deref()
            .map_or(std::ptr::null(), |buffer| buffer.as_ptr()),
        // The collapsed control text carries the expander label in its
        // collapsed state (the shared `label` field).
        psz_collapsed_control_text: expanded_control_text
            .as_deref()
            .map_or(std::ptr::null(), |buffer| buffer.as_ptr()),
        footer_icon: std::ptr::null(),
        psz_footer: footer
            .as_deref()
            .map_or(std::ptr::null(), |buffer| buffer.as_ptr()),
        pf_callback: Some(task_dialog_callback),
        // One cloned Arc reference for the callback; reclaimed after the
        // modal call returns.
        lp_callback_data: Arc::into_raw(shared.clone()) as isize,
        cx_width: 0,
    };

    let mut selected_button: i32 = 0;
    let mut verification_checked: i32 = 0;
    // SAFETY: every config pointer references the wide buffers above, which
    // outlive the call; the callback data points at a live Arc reference.
    let hr = unsafe {
        surface.indirect(
            &config,
            &mut selected_button,
            std::ptr::null_mut(),
            &mut verification_checked,
        )
    };
    // Reclaim the callback's Arc reference.
    drop(unsafe { Arc::from_raw(config.lp_callback_data as *const WorkerShared) });

    if hr != S_OK {
        if shared.dialog_hwnd.load(Ordering::Acquire) == 0 {
            // Failed before TDN_CREATED: the entry handshake never fired —
            // report it as a pre-Accept failure so the command answers with
            // the synchronous typed error path.
            let _ = shared.send_entry(super::worker::EntryOutcome::Failed {
                error: typed_error(
                    error_code::PRESENTATION_FAILED,
                    format!("TaskDialogIndirect failed before creation: {hr:#010x}"),
                ),
            });
        }
        // After TDN_CREATED the failure is post-Accepted: a terminal error.
        return Err(typed_error(
            error_code::PRESENTATION_FAILED,
            format!("TaskDialogIndirect failed: {hr:#010x}"),
        ));
    }

    let response = if selected_button == IDCANCEL {
        // Title-bar X / ESC / any forced dismissal lands here: the P0-6
        // mapping (cancelId, or button 0).
        options.cancel_id.unwrap_or(0)
    } else {
        let index = selected_button - CUSTOM_BUTTON_ID_BASE;
        usize::try_from(index)
            .ok()
            .filter(|index| *index < options.buttons.len())
            .unwrap_or_else(|| options.cancel_id.unwrap_or(0))
    };
    let suppressed = verification_checked != 0;
    Ok(ExtOperationPayload::Result {
        value: terminal::message_result(MessageDialogResult {
            response,
            suppressed,
        }),
    })
}

/// The `TDN_CREATED` callback: publishes the dialog HWND, registers the
/// close target, and fires the Accepted handshake (`Entered` with the
/// `TDN_CREATED` evidence — the frozen presentation proof).
unsafe extern "system" fn task_dialog_callback(
    hwnd: HWND,
    notification: u32,
    _wparam: usize,
    _lparam: isize,
    ref_data: isize,
) -> i32 {
    let shared = unsafe { &*(ref_data as *const WorkerShared) };
    if notification == TDN_CREATED {
        shared.dialog_hwnd.store(hwnd as isize, Ordering::Release);
        *shared.target.lock().unwrap_or_else(|error| error.into_inner()) =
            DialogTarget::TaskDialog { hwnd };
        let _ = shared.send_entry(super::worker::EntryOutcome::Entered {
            evidence: "TDN_CREATED",
        });
    }
    S_OK
}

/// Runs one message dialog through the MessageBox fallback. The caller
/// guarantees the request is MessageBox-expressible (at most three buttons,
/// no commandLink/expander/footer — those rejected earlier with typed
/// `dialog_capability_unavailable`).
pub(super) fn show_message_box(
    options: &MessageDialogOptions,
    shared: &Arc<WorkerShared>,
) -> Result<ExtOperationPayload, opentray_spec::TypedExtensionError> {
    debug_assert!(options.buttons.len() <= 3, "caller gates the button count");
    if shared.close_requested.load(Ordering::Acquire) {
        return Ok(dismissal_payload(options));
    }

    let mut text = options.message.clone();
    if let Some(detail) = &options.detail {
        text.push_str("\n\n");
        text.push_str(detail);
    }
    let text_wide = wide(&text);
    let mut style: MESSAGEBOX_STYLE = match options.buttons.len() {
        1 => MB_OK,
        2 => MB_OKCANCEL,
        _ => MB_YESNOCANCEL,
    };
    style |= match options.severity {
        DialogSeverity::Info => MB_ICONINFORMATION,
        DialogSeverity::Warning => MB_ICONWARNING,
        DialogSeverity::Error => MB_ICONERROR,
    };
    match options.default_id {
        Some(1) => style |= MB_DEFBUTTON2,
        Some(2) => style |= MB_DEFBUTTON3,
        _ => {}
    }

    *shared.target.lock().unwrap_or_else(|error| error.into_inner()) = DialogTarget::MessageBox;
    // Entry evidence for MessageBoxW is entering the call itself (no
    // creation callback exists).
    let handshake_alive =
        shared.send_entry(super::worker::EntryOutcome::Entered {
            evidence: "MessageBox-entry",
        });
    // SAFETY: the wide buffers live across the call; null caption maps to
    // the platform default title bar.
    let result = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text_wide.as_ptr(),
            std::ptr::null(),
            style,
        )
    };
    *shared.target.lock().unwrap_or_else(|error| error.into_inner()) = DialogTarget::None;

    if !handshake_alive {
        // The host side is gone (pre-Accept timeout already answered):
        // finish silently. The payload value is irrelevant.
        return Ok(dismissal_payload(options));
    }

    let response = match result {
        IDOK => 0,
        IDYES => 0,
        IDNO => 1,
        // IDCANCEL (and any unresolvable code): the dismissal branch.
        _ => options.cancel_id.unwrap_or(0),
    };
    // MessageBox cannot render the suppression checkbox: the honest report
    // is `false` (documented degradation for the fallback path).
    Ok(ExtOperationPayload::Result {
        value: terminal::message_result(MessageDialogResult {
            response,
            suppressed: false,
        }),
    })
}

/// The dismissal payload shared by every forced-close path (P0-6).
fn dismissal_payload(options: &MessageDialogOptions) -> ExtOperationPayload {
    ExtOperationPayload::Result {
        value: terminal::message_result(MessageDialogResult {
            response: options.cancel_id.unwrap_or(0),
            suppressed: false,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_box_position_map_keeps_three_button_sets() {
        // The fixed sets are positional: 1 -> OK, 2 -> OK/Cancel,
        // 3 -> Yes/No/Cancel. The constants here only pin the frozen Win32
        // values used by the mapping.
        assert_eq!(IDOK, 1);
        assert_eq!(IDYES, 6);
        assert_eq!(IDNO, 7);
        assert_eq!(super::super::ffi::IDCANCEL, 2);
    }
}
