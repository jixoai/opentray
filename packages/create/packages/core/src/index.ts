// @create-opentray/core — adapter-neutral create-opentray Core.
//
// Orthogonal intents (maintained 2026-08-18; original user request: split the
// browser-wizard-shaped create-opentray into one shared headless Core plus CLI
// and WebUI adapters — governed by openspec change unify-create-opentray-core):
// 1. Own the v1 configuration authority, registration layout, and lifecycle.
// 2. Own process/port observation, preview execution, and metadata enrichment.
// 3. Own icon sampling intent, developer-mode mapping, and export planning.
// 4. Stay free of React, yargs, and browser runtime dependencies.

export {
  deriveDefaultAppId,
  deriveDefaultAppName,
  isValidAppId,
  toProjectDirectoryName,
} from "./app-id";
export {
  resolveLaunchVector,
  resolveOnPath,
  parseShebangInterpreter,
  type LaunchVector,
  type ResolveLaunchVectorOptions,
} from "./launch-vector";
export { tokenizeCommandLine, type TokenizeResult } from "./tokenize";
export {
  collectProcessTreePids,
  createPortDiscovery,
  ensureLoopbackNoProxy,
  listListeningPortOwners,
  listListeningPorts,
  parseLsofPortOwners,
  parseLsofPorts,
  parseNetstatPortOwners,
  parseNetstatPorts,
  parsePowerShellPorts,
  runCapture,
  serviceUrl,
  tcpProbe,
  verifyHttpService,
  waitForTcpPort,
  type DiscoveredService,
  type ListenerOwners,
  type ListenersRunner,
  type PortDiscoveryOptions,
  type PortDiscoverySession,
} from "./port-scan";
export {
  scrapeService,
  writeGlyphIconTemp,
  extractTitle,
  extractFaviconCandidates,
  faviconCandidateSize,
  rankFaviconCandidates,
  resolveFaviconUrl,
  type FaviconCandidate,
  type IconVariant as ScrapedIconVariant,
  type ScrapeResult,
  type ScrapedIcon,
} from "./scrape";
export {
  APP_ICON_CANVAS,
  FOREGROUND_SCALE_DEFAULT,
  MACOS_CONTENT_SIZE,
  ICON_BACKGROUNDS,
  autoBackground,
  composeAppIcon,
  compositionCacheKey,
  foregroundCoverage,
  foregroundLuminance,
  foregroundStats,
  type IconBackground,
} from "./icon-compose";
export { toPngBuffer as decodeIco } from "./icon-codec";
export {
  startCommandRun,
  type CommandRun,
  type CommandRunEvent,
  type CommandRunOptions,
  type CommandRunTerminalSize,
} from "./command-run";
export { openMaterializedApp, pinningHint } from "./open-app";
export {
  attempt,
  err,
  isCreateError,
  ok,
  type CreateError,
  type CreateErrorCode,
  type Result,
} from "./errors";
export {
  CONFIG_FILENAME,
  CONFIG_SCHEMA_VERSION,
  DEFAULT_ICON_SCALE,
  DEFAULT_WINDOW,
  ICON_SCALE_MAX,
  ICON_SCALE_MIN,
  isContainedPath,
  parseCreateConfig,
  sameIdentity,
  serializeCreateConfig,
  type CommandConfig,
  type CreateConfigV1,
  type IconBackgroundName,
  type IconResourceRef,
  type IconsConfig,
  type ImageFormat,
  type PackageManagerName,
  type ResourceSource,
  type WindowConfig,
} from "./config";
export {
  APP_DIRNAME,
  REGISTRY_ROOT_SEGMENTS,
  listRegistrations,
  loadRegistration,
  readRegistrationRecord,
  registryRoot,
  registrationKey,
  registrationPaths,
  type RegistrationPaths,
  type RegistrationRecord,
  type RegistrationStatus,
} from "./registry";
export {
  findCreateEntry,
  listCreateEntries,
  readWizardProjectConfig,
  readWizardProjectIcon,
  uninstallWizardProject,
  type CreateRootEntry,
  type WizardProjectConfig,
  type WizardProjectIcon,
  type WizardUninstallOptions,
  type WizardUninstallResult,
} from "./scan";
export { createDirectoryLink, linkCapabilities, type LinkCapabilities } from "./links";
export {
  detectImageFormat,
  importResource,
  parseDataImageUrl,
  readResourceBytes,
  type IconRole,
  type ImportResourceOptions,
  type ImportedResource,
  type ParsedDataUrl,
  type ResourceInput,
} from "./resources";
export {
  RUNTIME_FILENAME,
  clearRuntimeRecord,
  inspectProcess,
  killProcessTree,
  newRuntimeToken,
  readProcessStartEpochMs,
  readRuntimeRecord,
  writeRuntimeRecord,
  type ProcessState,
  type RuntimeRecord,
} from "./runtime-record";
export {
  applyCreate,
  planCreate,
  stopRunningApp,
  uninstallApp,
  type ApplyOptions,
  type ApplyResult,
  type DesiredState,
  type LifecyclePlan,
  type PlanEffect,
  type PlanOptions,
  type StopOptions,
  type UninstallOptions,
  type UninstallResult,
} from "./lifecycle";
export {
  bareOrQuotePosix,
  buildExportPlan,
  buildScriptExport,
  embeddedFromRef,
  formatPosixCommandLine,
  quotePosix,
  quotePowerShell,
  reviewEnvironment,
  type EmbeddedResource,
  type ExportPlan,
  type ExportPlanInput,
  type ExportReview,
  type ExportShell,
} from "./export";
export {
  detectPackageManager,
  expectedDarwinBundlePath,
  isDirectoryOccupied,
  materialize,
  materializePayload,
  runPackageManagerInstall,
  type MaterializeContext,
  type MaterializeInput,
  type MaterializeLogEvent,
  type MaterializeResult,
  type PayloadPhaseResult,
  type RunInstallOptions,
} from "./materialize";
export {
  writeScaffold,
  SCAFFOLD_MARKER_FILES,
  createEntrySource,
  createShellServerSource,
  type ScaffoldAppConfig,
  type ScaffoldOptions,
  type ScaffoldResult,
} from "./scaffold";
