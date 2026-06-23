import AppKit
import Foundation

final class BadgeDockHelper: NSObject, NSApplicationDelegate {
    private let dockTitle = ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_TITLE"]
        ?? "OpenTray Badge"
    private let dockIconName = ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_ICON_NAME"]
        ?? "bell.badge"
    private let dockIconPath = ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_ICON_PATH"]
    private let helperLog = argumentValue("--log-path") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_LOG"]
    private let clickSignalPath = argumentValue("--click-signal") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_CLICK_SIGNAL"]
    private let quitSignalPath = argumentValue("--quit-signal") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_QUIT_SIGNAL"]
    private let quitNotifyPath = argumentValue("--quit-notify") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_QUIT_NOTIFY"]
    private let stateDir = argumentValue("--state-dir") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_STATE_DIR"]
    private let stateBadgePath = argumentValue("--badge-path") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_BADGE_PATH"]
    private let stateTitlePath = argumentValue("--title-path") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_TITLE_PATH"]
    private let stateIconNamePath = argumentValue("--icon-path") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_ICON_NAME_PATH"]
    private let forceMultiOpen = CommandLine.arguments.contains("--force-multi-open")
    private var lifecycleTimer: Timer?
    private var stateTimer: Timer?
    private var cachedDockTitle: String
    private var cachedDockBadge: String?
    private var cachedDockIconName: String
    private var cachedDockIconPath: String?
    private var renderedSignature: String = ""

    override init() {
        self.cachedDockTitle = argumentValue("--title") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_TITLE"] ?? "OpenTray Badge"
        self.cachedDockBadge = argumentValue("--badge") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_BADGE"]
        self.cachedDockIconName = argumentValue("--icon-name") ?? ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_ICON_NAME"] ?? "bell.badge"
        self.cachedDockIconPath = ProcessInfo.processInfo.environment["OPENTRAY_BADGE_DOCK_ICON_PATH"]
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.applicationIconImage = placeholderDockIcon()
        applyDockBadge(cachedDockBadge)
        log("launched title=\(cachedDockTitle)")
        startLifecycleWatch()
        startStateWatch()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        log("dock-reopen")
        signalDockClick()
        sender.activate(ignoringOtherApps: true)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        signalDockQuitNotify()
    }

    private func resolveDockIcon() -> NSImage? {
        if let cachedDockIconPath, !cachedDockIconPath.isEmpty {
            return NSImage(contentsOfFile: cachedDockIconPath)
        }
        return NSImage(systemSymbolName: cachedDockIconName, accessibilityDescription: cachedDockTitle)
    }

    private func applyDockBadge(_ badge: String?) {
        guard let badge, !badge.isEmpty else {
            NSApp.dockTile.badgeLabel = nil
            return
        }
        NSApp.dockTile.badgeLabel = badge
    }

    private func signalDockClick() {
        guard let clickSignalPath, !clickSignalPath.isEmpty else {
            return
        }
        let payload = "\(Date().timeIntervalSince1970)\n"
        try? payload.write(toFile: clickSignalPath, atomically: true, encoding: .utf8)
    }

    private func startLifecycleWatch() {
        guard let quitSignalPath, !quitSignalPath.isEmpty else {
            return
        }
        if forceMultiOpen {
            return
        }
        lifecycleTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] timer in
            guard let self else {
                timer.invalidate()
                return
            }
            if FileManager.default.fileExists(atPath: quitSignalPath) {
                timer.invalidate()
                NSApp.terminate(self)
            }
        }
    }

    private func startStateWatch() {
        guard let stateDir, !stateDir.isEmpty else {
            return
        }
        stateTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            self?.refreshDockState()
        }
    }

    private func refreshDockState() {
        var changed = false
        if let stateBadgePath, let badge = readTrimmedFile(stateBadgePath) {
            cachedDockBadge = badge.isEmpty ? nil : badge
            changed = true
        }
        if let stateTitlePath, let title = readTrimmedFile(stateTitlePath), !title.isEmpty {
            cachedDockTitle = title
            changed = true
        }
        if let stateIconNamePath, let iconName = readTrimmedFile(stateIconNamePath), !iconName.isEmpty {
            cachedDockIconName = iconName
            changed = true
        }
        if changed {
            updateDockTile()
        }
    }

    private func readTrimmedFile(_ path: String) -> String? {
        guard FileManager.default.fileExists(atPath: path) else {
            return nil
        }
        return (try? String(contentsOfFile: path, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func updateDockTile() {
        let signature = [cachedDockTitle, cachedDockBadge ?? "", cachedDockIconName, cachedDockIconPath ?? ""].joined(separator: "|")
        guard signature != renderedSignature else {
            return
        }
        renderedSignature = signature
        applyDockBadge(cachedDockBadge)
        NSApplication.shared.applicationIconImage = resolveDockIcon() ?? placeholderDockIcon()
        NSApplication.shared.dockTile.display()
    }

    private func placeholderDockIcon() -> NSImage {
        let image = NSImage(size: NSSize(width: 64, height: 64))
        image.lockFocus()
        NSColor.clear.set()
        NSBezierPath(rect: NSRect(x: 0, y: 0, width: 64, height: 64)).fill()
        image.unlockFocus()
        return image
    }

    private func signalDockQuitNotify() {
        guard let quitNotifyPath, !quitNotifyPath.isEmpty else {
            return
        }
        let payload = "\(Date().timeIntervalSince1970)\n"
        try? payload.write(toFile: quitNotifyPath, atomically: true, encoding: .utf8)
    }

    private func log(_ message: String) {
        NSLog("OpenTray badge helper: %@", message)
        if let helperLog {
            try? "\(message)\n".appendToFile(atPath: helperLog)
        }
    }
}

private extension String {
    func appendToFile(atPath path: String) throws {
        let url = URL(fileURLWithPath: path)
        let existing = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        try (existing + self).write(to: url, atomically: true, encoding: .utf8)
    }
}

private func argumentValue(_ name: String) -> String? {
    let arguments = CommandLine.arguments
    for index in 0..<arguments.count {
        if arguments[index] == name, index + 1 < arguments.count {
            return arguments[index + 1]
        }
    }
    return nil
}

let delegate = BadgeDockHelper()
NSApplication.shared.delegate = delegate
NSApplication.shared.setActivationPolicy(.regular)
NSApplication.shared.run()
