## ADDED Requirements

### Requirement: Sharing SHALL work from frozen parameters before generation

The wizard confirm panel SHALL offer a share action next to the create action. Sharing SHALL build the export from the CURRENT frozen wizard state — resolved launch vector, identity, options, and icon sources — without running the command and without materializing anything. The share artifacts SHALL be the existing export forms: a single-line create command and self-contained sh/ps1 scripts with embedded icon bytes, each copyable to the clipboard and downloadable.

#### Scenario: Share before creating

- **GIVEN** a frozen wizard confirmation whose command has never run in this session
- **WHEN** the user clicks 分享 and picks a script format
- **THEN** the generated script SHALL contain the resolved command vector and identity flags
- **AND** nothing SHALL have been written to the create root

#### Scenario: Uploaded icon travels inside the script

- **GIVEN** a frozen confirmation whose app icon is an uploaded temporary file
- **WHEN** the user shares a script
- **THEN** the icon bytes SHALL be embedded and reconstructed by the script
- **AND** the shared artifact SHALL not reference the wizard machine's temporary paths

### Requirement: Listed applications SHALL share through the same export kernel

Every listed application — wizard or registered — SHALL offer a share action producing command-line and sh/ps1 exports through the shared export kernel. For wizard projects the export SHALL derive from the wizard config projection, using the project's generated icon asset as the stable icon source. Environment acknowledgement SHALL apply uniformly, and environment values SHALL never be echoed into ordinary output.

#### Scenario: Share a wizard project from the list

- **GIVEN** a listed wizard application
- **WHEN** the user shares it as a shell script
- **THEN** the script SHALL recreate the application with the same identity, command vector, and icon

#### Scenario: Env acknowledgement is uniform

- **GIVEN** an application whose command configures environment entries
- **WHEN** the user shares without acknowledging the environment
- **THEN** the share SHALL be refused with the env acknowledgement requirement
- **AND** the values SHALL not appear in any surfaced message
