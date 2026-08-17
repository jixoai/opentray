// Orthogonal intents (maintained 2026-07-22; original user request: publish the
// create-opentray initializer as a reusable package):
// 1. Expose the wizard programmatic surface for embedding and tests.
// 2. Re-export the pure derivation helpers consumers may reuse.
// Compromise: the bin entry stays separate so `npx create-opentray` never loads
// the programmatic surface twice.

export { createWizardSession, type WizardSession, type WizardEvent, type WizardFormValues, type WizardState } from "./wizard";
export { createWizardServer, isAuthorized, isLoopbackHost, type WizardServerHandle } from "./server";
export { tokenizeCommandLine, type TokenizeResult } from "@create-opentray/core";
export {
  deriveDefaultAppId,
  deriveDefaultAppName,
  isValidAppId,
  toProjectDirectoryName,
} from "@create-opentray/core";
export {
  createPortDiscovery,
  parseLsofPorts,
  parseNetstatPorts,
  parsePowerShellPorts,
  serviceUrl,
  verifyHttpService,
  waitForTcpPort,
  type DiscoveredService,
} from "@create-opentray/core";
export {
  extractFaviconCandidates,
  extractTitle,
  faviconCandidateSize,
  rankFaviconCandidates,
  resolveFaviconUrl,
  scrapeService,
  type FaviconCandidate,
  type ScrapeResult,
} from "@create-opentray/core";
export { resolveLaunchVector, resolveOnPath, parseShebangInterpreter, type LaunchVector } from "@create-opentray/core";
export {
  detectPackageManager,
  expectedDarwinBundlePath,
  isDirectoryOccupied,
  materialize,
  type MaterializeContext,
  type MaterializeInput,
  type MaterializeLogEvent,
  type MaterializeResult,
} from "@create-opentray/core";
export { openMaterializedApp, pinningHint } from "@create-opentray/core";
export {
  writeScaffold,
  type ScaffoldAppConfig,
  type ScaffoldOptions,
  type ScaffoldResult,
} from "@create-opentray/core";
export { parseWizardCli, main as runWizardMain, type WizardCliOptions } from "./bin";
