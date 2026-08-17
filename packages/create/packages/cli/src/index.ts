// @create-opentray/cli — yargs command tree for create-opentray.
//
// Public surface: buildRootCommands/dispatchCli (embedding + the published
// bin), plus the flag compiler, skill access, and output contract pieces the
// create-opentray package reuses.

export { dispatchCli, buildRootCommands, type CliContext } from "./commands";
export { compileDesiredConfig, parseEnvEntry, parseWindowSpec, type CreateFlagOptions } from "./options";
export {
  listSkillFiles,
  readSkillFile,
  resolveSkillRoot,
  validateSkillPath,
  type SkillListEntry,
  type SkillRoot,
} from "./skill";
export {
  consoleStreams,
  emitOutcome,
  emitProgress,
  exitCodeFor,
  type CliOutcome,
  type CliStreams,
  type TypedFailure,
  type TypedSuccess,
} from "./output";
