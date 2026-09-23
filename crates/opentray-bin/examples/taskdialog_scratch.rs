//! Ephemeral win32 diagnostic (2026-09-22 broker dialog acceptance): bisect
//! the TaskDialogIndirect E_INVALIDARG (0x80070057) that the real broker hits
//! on every message dialog. This example binary embeds the broker's
//! RT_MANIFEST through opentray-bin's build.rs, so the process-default
//! activation context resolves comctl32 v6 exactly like the broker's
//! capability probe.
//!
//! Cases run through windows-sys's own frozen TASKDIALOGCONFIG (packed(1),
//! with dwCommonButtons) in CHILD processes: a case that presents blocks
//! inside the modal, so the parent treats "child still alive after 3 s" as
//! PRESENTED and reaps it. Cases that fail print the HRESULT and exit.
//!
//! This is a diagnostic, not product code; delete after the defect is
//! closed and the finding is recorded in the change evidence.

use std::cell::Cell;
use std::process::{Command, Stdio};

use windows_sys::core::{HRESULT, PCWSTR};
use windows_sys::Win32::Foundation::{E_INVALIDARG, S_OK};
use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows_sys::Win32::UI::Controls::{
    InitCommonControlsEx, INITCOMMONCONTROLSEX, ICC_STANDARD_CLASSES, ICC_WIN95_CLASSES,
    TASKDIALOGCONFIG, TASKDIALOGCONFIG_0, TASKDIALOGCONFIG_1, TASKDIALOG_BUTTON,
    TDF_ALLOW_DIALOG_CANCELLATION, TDF_SIZE_TO_CONTENT, TD_INFORMATION_ICON, TaskDialogIndirect,
};

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

thread_local! {
    static CREATED: Cell<bool> = const { Cell::new(false) };
}

unsafe extern "system" fn scratch_callback(
    _hwnd: windows_sys::Win32::Foundation::HWND,
    msg: u32,
    _wparam: usize,
    _lparam: isize,
    _ref: isize,
) -> HRESULT {
    const TDN_CREATED: u32 = 0;
    if msg == TDN_CREATED {
        CREATED.with(|created| created.set(true));
    }
    S_OK
}

fn main() {
    let case = std::env::args().nth(1);
    match case.as_deref() {
        Some(name) => run_case(name),
        None => drive(),
    }
}

fn drive() {
    let cases = [
        ("min", "cbSize + main instruction + 1 button; no flags/icon/callback"),
        ("ico", "min + TD_INFORMATION_ICON"),
        ("stc", "min + TDF_SIZE_TO_CONTENT"),
        ("flags", "min + both crate flags (no icon)"),
        (
            "crate",
            "exact crate shape: both flags, icon sentinel, button id 100, callback",
        ),
        ("crate-sta", "crate shape on a COINIT_APARTMENTTHREADED thread"),
        ("ifd-main", "IFileOpenDialog::Show on the main thread (STA)"),
        (
            "ifd-sta",
            "IFileOpenDialog::Show on an STA worker with a message-only window",
        ),
        ("ifd-winit", "picker on STA worker + winit owner loop on the main thread"),
        ("ifd-tray", "picker on STA worker + registered tray icon"),
        (
            "ifd-env",
            "picker on STA worker + winit owner loop + tray icon (broker mirror)",
        ),
        (
            "ifd-filters",
            "picker + SetFileTypes with PRODUCT buffer lifetime (freed before Show)",
        ),
        (
            "ifd-filters-alive",
            "picker + SetFileTypes with buffers alive across Show (control arm)",
        ),
        (
            "ifd-prod-seq",
            "literal product sequence: CoCreate -> cast IFileDialog -> SetOptions -> cast IModalWindow -> Show",
        ),
        (
            "ifd-after-class",
            "picker after a dead thread registered a private window class (OnceLock-stale shape)",
        ),
        (
            "ifd-cast-only",
            "prod-seq minus IModalWindow cast: Show on the cast IFileDialog + NOCHANGEDIR",
        ),
        (
            "ifd-nochange-only",
            "prod-seq minus NOCHANGEDIR: casts + Show via IModalWindow, 2 base flags",
        ),
    ];
    let exe = std::env::current_exe().expect("current exe");
    for (name, description) in cases {
        let mut child = Command::new(&exe)
            .arg(name)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn case child");
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(3000);
        loop {
            match child.try_wait().expect("try_wait") {
                Some(status) => {
                    println!("{name:<10} EXITED {status} <- {description}");
                    break;
                }
                None if std::time::Instant::now() >= deadline => {
                    let _ = child.kill();
                    println!("{name:<10} PRESENTED (blocked in modal 3s) <- {description}");
                    break;
                }
                None => std::thread::sleep(std::time::Duration::from_millis(50)),
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
}

fn run_case(name: &str) {
    // Mirror the broker's capability probe: resolve v6 + initialize once.
    let icc = INITCOMMONCONTROLSEX {
        dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32,
        dwICC: ICC_WIN95_CLASSES | ICC_STANDARD_CLASSES,
    };
    if unsafe { InitCommonControlsEx(&icc) } == 0 {
        println!("{name}: InitCommonControlsEx FAILED");
        return;
    }

    if name == "ifd-winit" || name == "ifd-tray" || name == "ifd-env" {
        run_env_case(name);
        return;
    }

    if name == "crate-sta" || name == "ifd-sta" {        let owned_name = name.to_string();
        let handle = std::thread::spawn(move || {
            unsafe {
                CoInitializeEx(
                    std::ptr::null(),
                    COINIT_APARTMENTTHREADED as u32,
                )
            };
            if owned_name == "ifd-sta" {
                create_message_only_window();
            }
            present(&owned_name)
        });
        let hr = handle.join().expect("sta thread");
        report(name, hr);
    } else {
        if name.starts_with("ifd-") {
            unsafe {
                CoInitializeEx(
                    std::ptr::null(),
                    COINIT_APARTMENTTHREADED as u32,
                )
            };
        }
        let hr = present(name);
        report(name, hr);
    }
}

/// Worker-thread mirror: a message-only window exists before the modal
/// call, exactly like the product's STA worker dispatcher.
fn create_message_only_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, HWND_MESSAGE, WS_OVERLAPPEDWINDOW,
    };
    let class: Vec<u16> = "STATIC".encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let hwnd = CreateWindowExW(
            0,
            class.as_ptr(),
            std::ptr::null(),
            WS_OVERLAPPEDWINDOW,
            0,
            0,
            10,
            10,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            std::ptr::null_mut() as _,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            println!("ifd-sta: message-only window creation FAILED");
        }
    }
}

/// Broker-mirror environment cases: the picker runs on an STA worker while
/// the main thread runs a winit owner loop and/or a registered tray icon,
/// matching the failing in-broker shape case by case.
fn run_env_case(name: &str) {
    use std::sync::atomic::{AtomicBool, Ordering};

    let with_tray = name == "ifd-tray" || name == "ifd-env";
    let with_loop = name == "ifd-winit" || name == "ifd-env";

    let picker_done = std::sync::Arc::new(AtomicBool::new(false));
    let picker = {
        let picker_done = std::sync::Arc::clone(&picker_done);
        std::thread::spawn(move || {
            unsafe {
                CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32)
            };
            create_message_only_window();
            let hr = present_file_dialog();
            picker_done.store(true, Ordering::SeqCst);
            hr
        })
    };

    if with_tray {
        match tray_icon::TrayIconBuilder::new()
            .with_tooltip("scratch tray")
            .with_icon(
                tray_icon::Icon::from_rgba(vec![255u8; 16 * 16 * 4], 16, 16)
                    .expect("scratch icon"),
            )
            .build()
        {
            Ok(_tray) => println!("{name}: tray icon registered"),
            Err(error) => println!("{name}: tray icon FAILED {error:?}"),
        }
    }

    if with_loop {
        use winit::event::Event;
        use winit::event_loop::{ControlFlow, EventLoop};
        let event_loop = EventLoop::builder().build().expect("winit loop");
        event_loop.set_control_flow(ControlFlow::WaitUntil(
            std::time::Instant::now() + std::time::Duration::from_millis(200),
        ));
        println!("{name}: winit owner loop running");
        let loop_done = std::sync::Arc::clone(&picker_done);
        event_loop.run(move |event: Event<()>, elwt| {
            if let Event::NewEvents(winit::event::StartCause::ResumeTimeReached {
                ..
            }) = event
            {
                if loop_done.load(Ordering::SeqCst) {
                    elwt.exit();
                } else {
                    elwt.set_control_flow(ControlFlow::WaitUntil(
                        std::time::Instant::now() + std::time::Duration::from_millis(200),
                    ));
                }
            }
        });
        println!("{name}: winit loop exited");
    } else {
        let hr = picker.join().expect("picker thread");
        report(name, hr);
    }
}

/// IFileDialog leg: present the common File Open dialog through the same
/// `windows` crate COM family the product extension uses.
/// Filter-lifetime discriminators: replicate the product's `configure`
/// shape — wide buffers built in a helper frame, `SetFileTypes` called, the
/// frame returning — versus a control arm whose buffers stay alive across
/// `Show`.
fn present_file_dialog_filters(buffers_alive: bool) -> i32 {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_NOCHANGEDIR, FOS_PATHMUSTEXIST};

    /// Mirrors the product's `configure`: the buffers live (and die) inside
    /// this frame, exactly one SetFileTypes call's worth.
    fn configure_product_lifetime(dialog: &IFileOpenDialog) {
        let name = wide("Text");
        let pattern = wide("*.txt;*.md");
        let specs = [COMDLG_FILTERSPEC {
            pszName: PCWSTR(name.as_ptr()),
            pszSpec: PCWSTR(pattern.as_ptr()),
        }];
        unsafe { dialog.SetFileTypes(&specs).expect("SetFileTypes") };
    }

    let dialog: IFileOpenDialog =
        match unsafe { CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER) } {
            Ok(dialog) => dialog,
            Err(error) => {
                println!("filters: CoCreateInstance FAILED {error:?}");
                return -1;
            }
        };
    unsafe {
        dialog
            .SetOptions(FOS_PATHMUSTEXIST | FOS_FILEMUSTEXIST | FOS_NOCHANGEDIR)
            .expect("SetOptions")
    };
    if buffers_alive {
        let name = wide("Text");
        let pattern = wide("*.txt;*.md");
        let specs = [COMDLG_FILTERSPEC {
            pszName: PCWSTR(name.as_ptr()),
            pszSpec: PCWSTR(pattern.as_ptr()),
        }];
        unsafe { dialog.SetFileTypes(&specs).expect("SetFileTypes") };
        println!("filters: entering Show (buffers ALIVE)");
        let hr = unsafe { dialog.Show(None) };
        println!("filters: Show returned {hr:?}");
        0
    } else {
        configure_product_lifetime(&dialog);
        println!("filters: entering Show (product lifetime: buffers FREED)");
        let hr = unsafe { dialog.Show(None) };
        println!("filters: Show returned {hr:?}");
        0
    }
}

/// The literal product call sequence with two toggles: `via_modal` calls
/// Show through the IModalWindow cast (product shape) versus the cast
/// IFileDialog; `no_changedir` adds FOS_NOCHANGEDIR (product shape).
fn present_product_sequence(via_modal: bool, no_changedir: bool) -> i32 {
    use windows::core::Interface;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileDialog, IFileOpenDialog, IModalWindow, FOS_FILEMUSTEXIST,
        FOS_NOCHANGEDIR, FOS_PATHMUSTEXIST,
    };
    let open: IFileOpenDialog =
        match unsafe { CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER) } {
            Ok(dialog) => dialog,
            Err(error) => {
                println!("prod-seq: CoCreateInstance FAILED {error:?}");
                return -1;
            }
        };
    let dialog: IFileDialog = match open.cast() {
        Ok(dialog) => dialog,
        Err(error) => {
            println!("prod-seq: IFileDialog cast FAILED {error:?}");
            return -1;
        }
    };
    let flags = FOS_PATHMUSTEXIST | FOS_FILEMUSTEXIST
        | if no_changedir { FOS_NOCHANGEDIR } else { Default::default() };
    if let Err(error) = unsafe { dialog.SetOptions(flags) } {
        println!("prod-seq: SetOptions FAILED {error:?}");
        return -1;
    }
    println!(
        "prod-seq: entering Show (via_modal={via_modal}, no_changedir={no_changedir})"
    );
    let show = if via_modal {
        let modal: IModalWindow = match dialog.cast() {
            Ok(modal) => modal,
            Err(error) => {
                println!("prod-seq: IModalWindow cast FAILED {error:?}");
                return -1;
            }
        };
        unsafe { modal.Show(None) }
    } else {
        unsafe { dialog.Show(None) }
    };
    match show {
        Ok(()) => {
            println!("prod-seq: Show OK");
            0
        }
        Err(error) => {
            println!("prod-seq: Show FAILED {error:?}");
            -1
        }
    }
}

/// No-op window proc for the dead-thread class registration arm.
unsafe extern "system" fn scratch_defwndproc(
    hwnd: windows_sys::Win32::Foundation::HWND,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn present_file_dialog() -> i32 {
    use windows::core::Interface;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FILEMUSTEXIST, FOS_PATHMUSTEXIST,
        SIGDN_FILESYSPATH,
    };
    let dialog: IFileOpenDialog =
        match unsafe { CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER) } {
            Ok(dialog) => dialog,
            Err(error) => {
                println!("ifd: CoCreateInstance FAILED {error:?}");
                return -1;
            }
        };
    if let Err(error) = unsafe { dialog.SetOptions(FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST) } {
        println!("ifd: SetOptions FAILED {error:?}");
        return -1;
    }
    println!("ifd: entering Show");
    match unsafe { dialog.Show(None) } {
        Ok(()) => {
            match unsafe { dialog.GetResult() } {
                Ok(result) => {
                    let path = unsafe { result.GetDisplayName(SIGDN_FILESYSPATH) };
                    let shown = path.map(|p| unsafe { p.to_string() });
                    println!("ifd: Show OK, picked {shown:?}");
                }
                Err(_) => println!("ifd: Show OK, GetResult none (cancel shape)"),
            }
            0
        }
        Err(error) => {
            println!("ifd: Show FAILED {error:?}");
            -1
        }
    }
}

fn report(name: &str, hr: i32) {
    let verdict = if hr == S_OK {
        "S_OK"
    } else if hr == E_INVALIDARG {
        "E_INVALIDARG"
    } else {
        "other"
    };
    let created = CREATED.with(|cell| cell.get());
    println!("{name}: hr={hr:#010x} created={} ({verdict})", created);
}

fn present(name: &str) -> i32 {
    if name == "ifd-main" || name == "ifd-sta" {
        return present_file_dialog();
    }
    if name == "ifd-filters" || name == "ifd-filters-alive" {
        return present_file_dialog_filters(name == "ifd-filters-alive");
    }
    if name == "ifd-prod-seq" || name == "ifd-after-class" {
        return present_product_sequence(true, true);
    }
    if name == "ifd-cast-only" {
        return present_product_sequence(false, true);
    }
    if name == "ifd-nochange-only" {
        return present_product_sequence(true, false);
    }
    let main = wide("scratch main instruction");
    let content = wide("scratch content");
    let ok = wide("OK");
    let button = TASKDIALOG_BUTTON {
        nButtonID: 100,
        pszButtonText: ok.as_ptr(),
    };
    let mut flags: i32 = 0;
    let mut icon: PCWSTR = std::ptr::null();
    match name {
        "min" => {}
        "ico" => icon = TD_INFORMATION_ICON,
        "stc" => flags |= TDF_SIZE_TO_CONTENT,
        "flags" => flags |= TDF_SIZE_TO_CONTENT | TDF_ALLOW_DIALOG_CANCELLATION,
        "crate" | "crate-sta" => {
            flags |= TDF_SIZE_TO_CONTENT | TDF_ALLOW_DIALOG_CANCELLATION;
            icon = TD_INFORMATION_ICON;
        }
        _ => unreachable!("unknown case"),
    }
    let config = TASKDIALOGCONFIG {
        cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
        hwndParent: std::ptr::null_mut(),
        hInstance: std::ptr::null_mut(),
        dwFlags: flags,
        dwCommonButtons: 0,
        pszWindowTitle: std::ptr::null(),
        Anonymous1: TASKDIALOGCONFIG_0 {
            pszMainIcon: icon as _,
        },
        pszMainInstruction: main.as_ptr(),
        pszContent: content.as_ptr(),
        cButtons: 1,
        pButtons: &button,
        nDefaultButton: 100,
        cRadioButtons: 0,
        pRadioButtons: std::ptr::null(),
        nDefaultRadioButton: 0,
        pszVerificationText: std::ptr::null(),
        pszExpandedInformation: std::ptr::null(),
        pszExpandedControlText: std::ptr::null(),
        pszCollapsedControlText: std::ptr::null(),
        Anonymous2: TASKDIALOGCONFIG_1 {
            pszFooterIcon: std::ptr::null(),
        },
        pszFooter: std::ptr::null(),
        pfCallback: if name == "crate-sta" {
            Some(scratch_callback)
        } else {
            None
        },
        lpCallbackData: 0,
        cxWidth: 0,
    };
    let mut selected: i32 = 0;
    let mut verification: i32 = 0;
    unsafe {
        TaskDialogIndirect(
            &config,
            &mut selected,
            std::ptr::null_mut(),
            &mut verification,
        )
    }
}
