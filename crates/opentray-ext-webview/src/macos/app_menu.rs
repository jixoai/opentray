use objc2::{rc::Retained, runtime::Sel, sel, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSEventModifierFlags, NSMenu, NSMenuItem};
use objc2_foundation::NSString;

pub(super) fn ensure_standard_edit_menu(app: &NSApplication, mtm: MainThreadMarker) {
    if let Some(main_menu) = app.mainMenu() {
        append_edit_menu_if_missing(&main_menu, mtm);
        return;
    }

    let main_menu = NSMenu::new(mtm);
    let app_menu = NSMenu::new(mtm);
    let app_item = NSMenuItem::new(mtm);
    app_item.setTitle(&NSString::from_str("OpenTray"));
    app_item.setSubmenu(Some(&app_menu));
    main_menu.addItem(&app_item);
    append_edit_menu_if_missing(&main_menu, mtm);
    app.setMainMenu(Some(&main_menu));
}

fn append_edit_menu_if_missing(main_menu: &NSMenu, mtm: MainThreadMarker) {
    if main_menu
        .itemWithTitle(&NSString::from_str("Edit"))
        .is_some()
    {
        return;
    }
    let edit_menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str("Edit"));
    append_edit_item(
        &edit_menu,
        mtm,
        "Undo",
        sel!(undo:),
        "z",
        NSEventModifierFlags::Command,
    );
    append_edit_item(
        &edit_menu,
        mtm,
        "Redo",
        sel!(redo:),
        "Z",
        NSEventModifierFlags::Command | NSEventModifierFlags::Shift,
    );
    edit_menu.addItem(&NSMenuItem::separatorItem(mtm));
    append_edit_item(
        &edit_menu,
        mtm,
        "Cut",
        sel!(cut:),
        "x",
        NSEventModifierFlags::Command,
    );
    append_edit_item(
        &edit_menu,
        mtm,
        "Copy",
        sel!(copy:),
        "c",
        NSEventModifierFlags::Command,
    );
    append_edit_item(
        &edit_menu,
        mtm,
        "Paste",
        sel!(paste:),
        "v",
        NSEventModifierFlags::Command,
    );
    append_edit_item(
        &edit_menu,
        mtm,
        "Select All",
        sel!(selectAll:),
        "a",
        NSEventModifierFlags::Command,
    );

    let edit_item = NSMenuItem::new(mtm);
    edit_item.setTitle(&NSString::from_str("Edit"));
    edit_item.setSubmenu(Some(&edit_menu));
    main_menu.addItem(&edit_item);
}

fn append_edit_item(
    menu: &NSMenu,
    mtm: MainThreadMarker,
    title: &str,
    action: Sel,
    key: &str,
    modifiers: NSEventModifierFlags,
) -> Retained<NSMenuItem> {
    let item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &NSString::from_str(title),
            Some(action),
            &NSString::from_str(key),
        )
    };
    item.setKeyEquivalentModifierMask(modifiers);
    menu.addItem(&item);
    item
}
