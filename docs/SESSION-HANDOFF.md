# Session handoff

Updated October 25, 2026. Read with `AGENTS.md` before resuming.

## Current product

Version **0.4.4** consolidates twelve command palette entries into **five**:
Repair or Set Up, Show Panel, Acknowledge, Choose Project or Conversation, and
Show Diagnostics. `src/repair.js` handles consented installation/update, missing
owned-file recovery, recognized legacy notify/TOML/JSON/sound/proxy cleanup, and
project removal. Old command IDs remain callable for saved keybindings without
palette contributions. Legacy-only cleanup works without a project.

No startup migration occurs. Repair prepares read-only plans, asks for explicit
per-project consent and rechecks files before writes. Edited or unowned files
require manual review. Codex hook trust remains separate. Local enablement lives
in VS Code workspace storage; setup does not write workspace settings. See
[INTEGRATION.md](INTEGRATION.md) for behavior and limitations and
[MAINTENANCE.md](MAINTENANCE.md) for the complete artifact review and removals.

The default remains a 24-character colored strip in our own public status-bar
item, configurable from 8 to 48. The optional large panel starts hidden and never
opens automatically. Do not change chrome appearance, executable paths, private
listeners or shared rendering state. The only executable-setting write retained
is restoration of an owned legacy proxy after explicit cleanup consent.

Hook signals are project/thread observations, not definitive waiting state or
exclusive window ownership. Existing session records confirm terminal outcomes.
Unread outcomes persist until acknowledged by default. Mission Control visibility
at the user's usual thumbnail scale still needs a visual check.

## Study and artifact boundary

The private-introspection study remains closed. Read
[STUDY-DECISION.md](STUDY-DECISION.md) before any further research. The authorized
hook implementation follows [HOOK-FEASIBILITY.md](HOOK-FEASIBILITY.md).
Read [SOURCES.md](SOURCES.md) and ignored `sources/manifest.json` before upstream
research. Keep downloaded references and private reports under ignored `sources/`.
Do not modify snapshots or reopen alternate-route research automatically.

Unused completion-only runtime/setup/tests and the superseded panel mockup have
been removed. `src/integration.js` now supports legacy removal only. Research
fixtures remain for reproducibility and live-test dependencies; they are excluded
from VSIX. Existing ignored project hooks and local editor settings were preserved.

## Validation and delivery

Validation: macOS with Node 22.23.4, all **41 tests**, syntax, lint, formatting,
workflow expressions, public-file checks, fresh dependency installation and VSIX
packaging passed through `npm run ci:local`. A sandboxed attempt could not resolve
GitHub for the pinned workflow validator; the network-enabled rerun passed.
The deterministic disposable-profile VS Code fixture also passed working,
finished, failed, helper-recovery and attention states. It used no personal
credentials or real model requests. Native maintenance dialogs are covered by
controller tests, not automated clicks in the live fixture.

The current build is `dist/codex-activity-status-0.4.4.vsix` (about 29 KB), with
five palette contributions and only production code/media, README and package
metadata. Developer reports, AGENTS.md, research and local project integrations
are excluded. README documentation links point to the repository. Seven older
VSIX builds were removed. The package has not been installed in the normal
profile; install it and reload VS Code to see the reduced command palette.
Real project hook updates still require the product's own confirmation.

Run `npm run ci:local` on macOS with Node 22 before handing off further changes.
Local CI rehearsal is not a GitHub CI result.

No Git writes were performed or authorized. Read-only Git operations must use
`~/sync/scripts/git-safe`. Implementation requests do not authorize staging,
commits, refs, fetch/pull/push or worktrees. The earlier publication review does
not cover this revision; no copy/paste publication commands are carried forward.
