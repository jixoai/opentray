# broker-daemon delta (walkthrough round)

## ADDED Requirements

### Requirement: Broker SHALL exclude itself from App Nap for its whole lifetime

The Darwin broker is a detached, non-LaunchServices process; once idle, macOS App Naps it and suspends every WKWebView's loads, timers, and network until a Dock activation revives the app. The broker SHALL assert one process activity (`NSProcessInfo.beginActivityWithOptions`, `UserInitiatedAllowingIdleSystemSleep`) at startup and hold it for its entire lifetime — a tray broker with live sessions is inherently user-facing. Display sleep stays available.

#### Scenario: Detached broker keeps serving after going idle

- **GIVEN** a broker spawned directly by an SDK entry (never launched through LaunchServices)
- **WHEN** the process would otherwise go idle and no Dock activation ever happens
- **THEN** webview pages keep loading, their timers keep firing, and tray commands keep executing without any user interaction.
