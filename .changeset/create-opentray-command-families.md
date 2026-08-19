---
"create-opentray": minor
---

# create-opentray: command families for the wizard (add-create-command-family)

## Command family authoring in one input row

- The wizard command field is now a single-row input group: a family selector prefix (official ecosystem brand marks as vendored monochrome SVG; pencil glyph for custom) plus the command body. Custom keeps the free-form input; every other family (npm: npx/pnpx/bunx/yarn dlx/nubx/deno run/vpx, go run, rust cargo install, python uvx/pipx run, .NET dnx) renders a read-only command surface that opens a structured form dialog (runner, package/module/crate/tool id, version, arguments; rust adds the run binary and an install reference line). Confirm writes the command string back; cancel discards the whole dialog session (button/X/overlay/ESC alike), and drafts survive in-dialog family switching without polluting server state.
- Dialog session model: opening freezes a cancel snapshot; unconfirmed edits stay session-local; server family projections (reload/reconnect/draft restart) always refresh the committed cache and merge into an unedited open session (plan D11a).
- No built-in preset command chips ship in production (prototypes were test-only).

## Family-aware default appId

- Recognized families derive a runner-normalized identity (pre-option subcommand segments + normalized package name; rust identity is the run binary; python `.`/`_` normalize to `-`; `@scope`/`@version`/`npm:` prefixes and path tails are stripped) joined with a fixed ecosystem tail: `npx @deepseek-ai/dsh@latest web` → `web.dsh.npmjs`, `go run rsc.io/fortune@latest` → `fortune.golang`, rust ripgrep/rg → `rg.rust`. The same package yields the same appId across runners of one family; custom commands keep the existing derivation unchanged.

## npm env preset as an explicit projection of the user env list

- `npm_config_yes=true` (skip the npx/pnpx first-run install confirmation) is no longer injected implicitly: the user env entry list is the single source of truth. The dialog preset control is a live two-way projection — enabling writes the entry, removing deletes it, manual edits outside sync back instantly (last duplicate wins, matching the spawn/export overlay). The command-row indicator icon lights exactly when the entry exists.
- `cargo install …` is never executed by the wizard: commands whose resolved executable (realpath-normalized, case-insensitive, `.exe`-stripped) is cargo and whose argv contains a standalone `install` token are refused with guidance toward the rust form — a deliberately conservative rule that over-refuses rare non-install invocations instead of parsing cargo's option grammar.
- Argument fidelity: parsed args are re-serialized with POSIX symmetric quoting (whitespace/metachar tokens quoted) so tokenize(build(parse(cmd))) is token-for-token identical; the webui mirror tokenizer now uses the same `shell-quote` version as core, and value-bearing runner flags (e.g. `deno run --config <path>`) fall back verbatim to custom instead of reinterpreting a flag value as the package name.
