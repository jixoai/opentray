# consumer-skills Specification

## Purpose
TBD - created by archiving change tray-dynamic-state-and-webview-placement-kit. Update Purpose after archive.
## Requirements
### Requirement: Consumer skills SHALL teach scenario composition instead of DOM mutation

The OpenTray consumer skill SHALL guide users through common scenario decisions and API composition. It SHALL NOT recommend auto-injecting drag areas, rewriting user HTML, or prescribing fixed CSS recipes as platform law.

#### Scenario: Frameless panel guidance preserves user UI ownership

- **GIVEN** a user asks for a frameless or overlay WebView panel
- **WHEN** the skill provides guidance
- **THEN** it explains that the user should deliberately bind native drag APIs such as overlay/app-region drag where appropriate
- **AND** it does not tell the agent to silently mutate the user's HTML.

### Requirement: Consumer skills SHALL publish scenario examples for common OpenTray apps

The OpenTray consumer skill SHALL include scenario cards with decision reasoning and concise source snippets that cover common usage: normal tray status, dynamic tray state, tray-launched WebView, tray-anchored lightweight panel, frameless glass utility, overlay native controls, screen corner widget, and top island/native framed window.

#### Scenario: Lightweight panel guidance explains scroll tradeoff

- **GIVEN** a user wants a compact tray panel
- **WHEN** the skill gives guidance
- **THEN** it explains that card-like panels should usually avoid root `html/body` scrollbars
- **AND** it frames responsive sizing or deliberate internal scrolling as product decisions rather than mandatory CSS.

