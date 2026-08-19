# generated-app-entry Specification

## Purpose
TBD - created by archiving change create-no-first-launch-force-terminal. Update Purpose after archive.
## Requirements
### Requirement: The entry SHALL run the command through a PTY unconditionally

Every generated application SHALL depend on a prebuilt native PTY package and SHALL spawn the recorded command through a pseudo-terminal regardless of shell options, matching the wizard preview's TTY environment. A PTY-module load failure SHALL degrade to pipe transport, SHALL log the degradation to `app.log`, and SHALL NOT fail the entry. The shell host (static UI + PTY ring + port state) SHALL be scaffolded unconditionally.

#### Scenario: Plain-mode command sees a TTY

- **GIVEN** a generated app with no shell options enabled
- **WHEN** the entry spawns the recorded command
- **THEN** the command SHALL observe a pseudo-terminal on stdio
- **AND** its output SHALL be captured into the PTY ring and `app.log`

#### Scenario: PTY dependency unavailable

- **GIVEN** the native PTY module fails to load
- **WHEN** the entry starts
- **THEN** the command SHALL run through pipes with a degradation notice in `app.log`

### Requirement: Service discovery SHALL be continuous with no time limit

The entry SHALL NOT block startup on service discovery. A single adaptive monitor SHALL sniff the command's owned listening ports for the entry's whole lifetime, SHALL accept dynamic and multiple ports, and SHALL open one window per HTTP-verified port. The polling interval SHALL be cost-bounded: near 1s when state is changing, backing off to at most 5s when quiet or when system load is high, returning to the fast cadence on any state change. The monitor SHALL NOT create hidden high-frequency (>=2Hz) polling.

#### Scenario: Slow command eventually serves

- **GIVEN** a command whose service appears minutes after start
- **WHEN** the entry keeps running
- **THEN** the monitor SHALL keep sniffing without failing the entry
- **AND** the service window SHALL open when the port verifies

#### Scenario: Random port is adopted

- **GIVEN** a command that listens on an ephemeral port (port 0)
- **WHEN** the monitor verifies the owned listener over HTTP
- **THEN** the window SHALL target that exact port
- **AND** a second verified port SHALL get its own window

#### Scenario: Quiet system backs off

- **GIVEN** no port-state changes for multiple consecutive monitor ticks
- **WHEN** the monitor schedules its next tick
- **THEN** the interval SHALL back off toward 5s
- **AND** any observed state change SHALL return it to the fast cadence

### Requirement: Abnormal command exit SHALL force-reveal the terminal window

The terminal window SHALL be a first-class component of every generated app. The `showTerminal` option SHALL control only its initial visibility. The command's exit SHALL be treated as abnormal when the exit code is non-zero OR the command exits before any service has been verified. On abnormal exit the entry SHALL reveal the terminal window regardless of configuration — creating and showing it on demand, or making an existing one visible and focusing it — and the terminal surface SHALL replay the retained PTY output plus the exit status. Normal exit after at least one verified service SHALL NOT force the window.

#### Scenario: Hidden terminal pops on crash

- **GIVEN** a generated app with `showTerminal: false` whose command exits with code 1
- **WHEN** the exit is observed
- **THEN** the terminal window SHALL appear focused
- **AND** it SHALL show the command output history and the exit code

#### Scenario: Exit before any service

- **GIVEN** a command that exits with code 0 before any verified service appeared
- **WHEN** the exit is observed
- **THEN** the terminal window SHALL be force-revealed as abnormal

#### Scenario: Graceful exit after service stays quiet

- **GIVEN** a command that exits with code 0 after at least one service was verified
- **WHEN** the exit is observed
- **THEN** the terminal window SHALL NOT be force-revealed

### Requirement: Command teardown SHALL sweep the whole process tree

Killing the command (quit path or teardown) SHALL terminate the entire descendant tree, not only the direct child: POSIX pipe fallbacks SHALL spawn into an owned process group and signal the group; PTY paths SHALL kill the pty child and sweep descendants by parent-PID walk. The sweep SHALL escalate from SIGTERM through a bounded grace period to SIGKILL. Wizard-side preview teardown SHALL apply the same tree-sweep rigor so no preview survivor can hold a service port.

#### Scenario: Quit leaves no descendants

- **GIVEN** a running command that spawned a server child
- **WHEN** the user quits the generated app
- **THEN** no descendant of the command SHALL remain alive

#### Scenario: Preview kill releases the port

- **GIVEN** a wizard preview whose command tree holds a service port
- **WHEN** generation stops the preview
- **THEN** the whole preview command tree SHALL be terminated before generation proceeds

### Requirement: Entry startup failures SHALL persist to app.log

The entry SHALL wrap its whole startup in a top-level error boundary. Any startup failure (including tray/session creation errors) SHALL append the error message and stack to `app.log` before exiting non-zero. No startup failure SHALL be silent.

#### Scenario: SDK failure leaves a trace

- **GIVEN** a generated app whose tray creation throws
- **WHEN** the entry exits
- **THEN** `app.log` SHALL contain the error message and stack
- **AND** the process exit code SHALL be non-zero

