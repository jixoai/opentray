use std::{cell::RefCell, rc::Rc};

use url::Url;

use crate::{WebviewNativeApiPolicy, WebviewNativeApiSource, WebviewShowSettings};

use super::{NavigatorWindowBridge, PageCapabilityAccess, PageSourceState};

pub(super) fn resolve_page_access(
    show_settings: &WebviewShowSettings,
    page_source: &PageSourceState,
) -> PageCapabilityAccess {
    let title_sync_requested = show_settings.window.sync.title.page_to_native
        || show_settings.window.sync.title.native_to_page;
    let icon_sync_requested = show_settings.window.sync.icon.page_to_native
        || show_settings.window.sync.icon.native_to_page;
    let permission_manager =
        policy_allows(
            &show_settings.native_api_policy,
            Some(
                show_settings
                    .permission_manager_policy
                    .default_src
                    .as_slice(),
            ),
            page_source,
        ) || exact_remote_permission_manager_origin_allows(show_settings, page_source);
    let window = show_settings.navigator_window.enabled
        && policy_allows(
            &show_settings.native_api_policy,
            show_settings.native_api_policy.window.as_deref(),
            page_source,
        );
    let screen = show_settings.navigator_screen.enabled
        && policy_allows(
            &show_settings.native_api_policy,
            show_settings.native_api_policy.screen.as_deref(),
            page_source,
        );
    // Tray geometry is page-visible only through the explicit tray capability family.
    let tray = show_settings.navigator_tray.enabled
        && policy_allows(
            &show_settings.native_api_policy,
            show_settings.native_api_policy.tray.as_deref(),
            page_source,
        );
    PageCapabilityAccess {
        window,
        screen,
        tray,
        window_globals: show_settings.navigator_window.bind_window_globals
            && window
            && policy_allows(
                &show_settings.native_api_policy,
                show_settings.native_api_policy.window_globals.as_deref(),
                page_source,
            ),
        screen_globals: show_settings.navigator_screen.bind_screen_globals
            && screen
            && policy_allows(
                &show_settings.native_api_policy,
                show_settings.native_api_policy.screen_globals.as_deref(),
                page_source,
            ),
        title_sync: title_sync_requested
            && policy_allows(
                &show_settings.native_api_policy,
                show_settings.native_api_policy.title_sync.as_deref(),
                page_source,
            ),
        icon_sync: icon_sync_requested
            && policy_allows(
                &show_settings.native_api_policy,
                show_settings.native_api_policy.icon_sync.as_deref(),
                page_source,
            ),
        permission_manager,
    }
}

pub(super) fn resolve_page_access_from_bridge(
    bridge: &NavigatorWindowBridge,
) -> PageCapabilityAccess {
    let title_sync_requested =
        bridge.metadata.sync_title.page_to_native || bridge.metadata.sync_title.native_to_page;
    let icon_sync_requested =
        bridge.metadata.sync_icon.page_to_native || bridge.metadata.sync_icon.native_to_page;
    let permission_manager = policy_allows(
        &bridge.native_api_policy,
        Some(bridge.permission_manager_policy.default_src.as_slice()),
        &bridge.page_source,
    ) || exact_remote_permission_manager_origin_allows_bridge(bridge);
    let window = bridge.navigator_window.enabled
        && policy_allows(
            &bridge.native_api_policy,
            bridge.native_api_policy.window.as_deref(),
            &bridge.page_source,
        );
    let screen = bridge.navigator_screen.enabled
        && policy_allows(
            &bridge.native_api_policy,
            bridge.native_api_policy.screen.as_deref(),
            &bridge.page_source,
        );
    // Tray geometry is page-visible only through the explicit tray capability family.
    let tray = bridge.navigator_tray.enabled
        && policy_allows(
            &bridge.native_api_policy,
            bridge.native_api_policy.tray.as_deref(),
            &bridge.page_source,
        );
    PageCapabilityAccess {
        window,
        screen,
        tray,
        window_globals: bridge.navigator_window.bind_window_globals
            && window
            && policy_allows(
                &bridge.native_api_policy,
                bridge.native_api_policy.window_globals.as_deref(),
                &bridge.page_source,
            ),
        screen_globals: bridge.navigator_screen.bind_screen_globals
            && screen
            && policy_allows(
                &bridge.native_api_policy,
                bridge.native_api_policy.screen_globals.as_deref(),
                &bridge.page_source,
            ),
        title_sync: title_sync_requested
            && policy_allows(
                &bridge.native_api_policy,
                bridge.native_api_policy.title_sync.as_deref(),
                &bridge.page_source,
            ),
        icon_sync: icon_sync_requested
            && policy_allows(
                &bridge.native_api_policy,
                bridge.native_api_policy.icon_sync.as_deref(),
                &bridge.page_source,
            ),
        permission_manager,
    }
}

fn exact_remote_permission_manager_origin_allows(
    show_settings: &WebviewShowSettings,
    page_source: &PageSourceState,
) -> bool {
    let ResolvedPageSource::Remote {
        origin: Some(origin),
    } = classify_page_source(page_source)
    else {
        return false;
    };
    show_settings
        .permission_manager_policy
        .remote_origins
        .iter()
        .any(|allowed| allowed == &origin)
}

fn exact_remote_permission_manager_origin_allows_bridge(bridge: &NavigatorWindowBridge) -> bool {
    let ResolvedPageSource::Remote {
        origin: Some(origin),
    } = classify_page_source(&bridge.page_source)
    else {
        return false;
    };
    bridge
        .permission_manager_policy
        .remote_origins
        .iter()
        .any(|allowed| allowed == &origin)
}

pub(super) fn update_page_access_for_url(bridge: &Rc<RefCell<NavigatorWindowBridge>>, url: &str) {
    let mut state = bridge.borrow_mut();
    let keep_host_html =
        state.page_source.host_html && state.page_source.url.is_none() && url == "about:blank";
    state.page_source.host_html = keep_host_html;
    state.page_source.url = Some(url.to_string());
    state.page_access = resolve_page_access_from_bridge(&state);
}

fn policy_allows(
    policy: &WebviewNativeApiPolicy,
    directive: Option<&[WebviewNativeApiSource]>,
    page_source: &PageSourceState,
) -> bool {
    let rules = directive.unwrap_or(&policy.default_src);
    let source = classify_page_source(page_source);
    let mut matched = false;
    for rule in rules {
        matched |= match_source_rule(rule, &source);
    }
    matched
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ResolvedPageSource {
    Local,
    Remote { origin: Option<String> },
}

fn classify_page_source(page_source: &PageSourceState) -> ResolvedPageSource {
    if page_source.host_html {
        return ResolvedPageSource::Local;
    }
    let Some(url_text) = page_source.url.as_deref() else {
        return ResolvedPageSource::Local;
    };
    let Ok(url) = Url::parse(url_text) else {
        return ResolvedPageSource::Remote { origin: None };
    };
    match url.scheme() {
        "file" | "data" | "about" => ResolvedPageSource::Local,
        "http" | "https" => {
            let host = url.host_str().unwrap_or_default();
            if is_loopback_host(host) {
                ResolvedPageSource::Local
            } else {
                ResolvedPageSource::Remote {
                    origin: Some(url.origin().ascii_serialization()),
                }
            }
        }
        _ => ResolvedPageSource::Remote { origin: None },
    }
}

fn match_source_rule(rule: &WebviewNativeApiSource, source: &ResolvedPageSource) -> bool {
    match rule {
        WebviewNativeApiSource::None => false,
        WebviewNativeApiSource::Any => true,
        WebviewNativeApiSource::Local => matches!(source, ResolvedPageSource::Local),
        WebviewNativeApiSource::Remote => matches!(source, ResolvedPageSource::Remote { .. }),
        WebviewNativeApiSource::Origin(expected) => matches!(
            source,
            ResolvedPageSource::Remote {
                origin: Some(actual)
            } if actual == expected
        ),
    }
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}
