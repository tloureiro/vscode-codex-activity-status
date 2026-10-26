# Session handoff

Updated October 26, 2026. Read with `AGENTS.md` before resuming.

## Current product

Version **0.4.5** preserves global sound hooks during repair and cleanup.
Version 0.4.4 incorrectly classified the bare Stop/Sosumi sound command as an
owned legacy hook and removed it. That recognition signature is now removed.
Tests cover both sound commands and trust records in TOML/JSON, including cleanup
alongside owned legacy handlers and the combined repair flow. Never treat a bare
sound command as evidence of extension ownership.

The palette retains **five** entries:
Repair or Set Up, Show Panel, Acknowledge, Choose Project or Conversation, and
Show Diagnostics. `src/repair.js` handles consented installation/update, missing
owned-file recovery, recognized legacy notify/TOML/JSON activity/proxy cleanup, and
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

Validation: macOS with Node 22.23.4, all **43 tests**, syntax, lint, formatting,
workflow expressions, public-file checks, fresh dependency installation and VSIX
packaging passed through `npm run ci:local`. The final sandboxed rehearsal could
not resolve GitHub for actionlint; the network-enabled rerun passed.
The deterministic disposable-profile VS Code fixture also passed working,
finished, failed, helper-recovery and attention states. It additionally verified
global Stop and PermissionRequest hooks alongside the seven project hooks, and
global Stop with our helper missing, using deterministic file markers rather
than audio. It used no personal
credentials or real model requests. Native maintenance dialogs are covered by
controller tests, not automated clicks in the live fixture.

The current build is `dist/codex-activity-status-0.4.5.vsix` (about 29 KB), with
five palette contributions and only production code/media, README and package
metadata. Developer reports, AGENTS.md, research and local project integrations
are excluded. README documentation links point to the repository.
Reload VS Code to activate the fix; the already-loaded 0.4.4 code can still
remove Sosumi if repair runs before reload.
Real project hook updates still require the product's own confirmation.

Existing project hooks do not need repair for this change. If a global sound
hook was already removed, restore its definition and review its trust in Codex
settings → Hooks, then start a new chat. Repair must preserve both global sound
hooks and their existing trust records.

Run `npm run ci:local` on macOS with Node 22 before handing off further changes.
Local CI rehearsal is not a GitHub CI result.

No Git writes were performed or authorized. Read-only Git operations must use
`~/sync/scripts/git-safe`. Implementation requests do not authorize staging,
commits, refs, fetch/pull/push or worktrees. The earlier publication review does
not cover this revision; no copy/paste publication commands are carried forward.
