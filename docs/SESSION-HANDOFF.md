# Session handoff

Updated October 24, 2026. Read this with `AGENTS.md` before resuming. The user is
ending the session; do not assume the copy/paste Git commands have been executed.

## Current product decision

Version **0.4.1** is implemented and packaged. The user approved a wide colored
strip in our own existing public status-bar item, using block characters and
foreground color. The default is 24 characters, configurable from 8 to 48.
It consumes status-bar width but no editor height. The large panel is optional,
starts hidden and never opens on setup or incoming events. The user approved the
strip preview in `research/mockups/status-bar-strip.html`.

The earlier large-panel mockup was superseded because it took too much editor
space. Do not reintroduce automatic panel opening, theme/chrome color changes,
private rendering mutations, proxies, executable overrides or monitoring daemons.
This decision and the subsequently authorized project-hook mode supersede the
original strict configuration-free study recommendations.

## Integration implemented

- Explicit per-project confirmation installs seven asynchronous command hooks
  and a standalone helper. Node.js 18+ is detected or selected by our own setting.
- New project hook/helper files are ignored locally. Existing unrelated hook
  files, edited installations and symlinked installation paths are refused.
- Codex project/hook trust is separate. The product never grants trust or writes
  Codex user configuration automatically. The user reviews trust in Codex and
  starts a new chat afterward.
- The helper writes metadata only while a receiver lease exists, with silent
  neutral exits and no approval decisions or model-visible output. Missing or
  hung observers must not stop Codex.
- Project/thread routing, bounded event storage, at most 128 turns and 64 tracked
  transcript paths. Completed conversations stop transcript polling. Unconfirmed
  activity becomes unknown after two minutes without a fresh signal.
- Blue indicates observed activity; amber indicates an attention request, not
  definitive human waiting. Purple requires a matching persisted terminal record.
  Failed and interrupted outcomes remain distinct. Late hook events cannot
  override confirmed outcomes; a delayed tool start cannot clear its approval.
- Unread outcomes persist until acknowledged by default. Clicking purple
  acknowledges; blue/amber opens Codex. `codexActivity.autoAcknowledge` defaults
  false. `codexActivity.beaconWidth` controls strip width.

Production entry points: `src/extension.js`, `src/status-presenter.js`,
`src/project-hooks.js`, `src/activity-helper.js`, `src/activity-events.js`,
`src/activity-state.js`, `src/activity-view.js`. Details are in `docs/INTEGRATION.md`.
Older completion modules remain for legacy compatibility/cleanup tests; startup
does not install or migrate their notify integration. Legacy removal commands
require their own explicit confirmation.

## Validation already completed

- `npm run validate`: **30 tests passed**, plus syntax, lint, formatting and
  public-file checks.
- `npm run test:vscode`: actual installed VS Code and official Codex extension
  in a disposable profile, deterministic localhost fixture, no personal credentials
  or real model requests. Blue, purple, failed, recovered-helper and amber states
  passed. The strip worked with the panel closed; the panel opened on request.
- `npm run package`: built ignored `dist/codex-activity-status-0.4.1.vsix`.
- `git-safe diff --check` passed. No Git writes were performed in this session.

The extension was **not installed in the normal user profile** during this work.
No project hooks were installed in ordinary projects and no ordinary Codex
configuration was changed. The old 0.3 notify integration may still exist;
verify only when relevant and never clean it up automatically.

Next product step is installation of the packaged build, reload, per-project hook
setup, native trust review and a real task. **Mission Control visibility at the
user's usual thumbnail scale still needs a visual check**: the existing status
bar has a fixed height. Exact waiting state and automatic exclusive ownership
between two windows on the same project remain unsupported claims.

## References and closed research

Read `docs/SOURCES.md` and ignored `sources/manifest.json` before upstream research.
`npm run sources:update` refreshes installed-version archives without Git writes;
`--latest` is only for intentional upstream-main investigation. Installed Codex
extension reference is a compiled bundle, not original source. Downloads and
machine-specific manifests stay under ignored `sources/` and out of the VSIX.

The private-introspection study is closed: real read-only connection access was
demonstrated, but sufficient reliable state was not. Do not reopen it
automatically. Historical reports are `docs/STUDY-DECISION.md`,
`docs/SELF-CONTAINED-STUDY.md`, `docs/INTROSPECTION-PROTOTYPE.md` and
`docs/HOOK-FEASIBILITY.md`. Research and mockup code under `research/` is excluded
from the VSIX; do not promote it to production by accident.

## Publication review and Git boundary

The user requested a review limited to current staged/unstaged/untracked changes,
not history or unrelated files, followed by copy/paste add/commit/push commands.
There were no staged changes at review start. No credentials or personal contact
details were found in the reviewed additions/new files. Public extension identity,
upstream versions/hashes, generic filesystem paths and synthetic fixtures remain
intentional. Root ignore rules also protect project-local installed hooks/helpers.
The final reviewed set contains 48 changed files, including this handoff; the
final scan found no credential/contact/home-path matches. Retained long strings
were upstream URLs, public version hashes and Markdown table separators.

No Git staging, commit, push, fetch, history scan, ref change or cleanup was
authorized or performed. All Git reads must use the user's `git-safe` wrapper;
never fall back to direct Git. The wrapper blocked `branch --show-current`, so
the suggested push uses `HEAD` rather than an unverified branch name. Do not
attempt to bypass that restriction or infer execution of the suggested commands.

Copy/paste commands supplied for the reviewed working tree, from repository root:

```sh
git add -- .
git commit -m "Add opt-in Codex activity hooks and status-bar beacon"
git push -u origin HEAD
```

These commands were not executed by the agent. New changes made after this review
must be reviewed before treating the same broad add command as publication-ready.

Local artifact locations and review metadata can be retained in ignored
`sources/analysis/SESSION-HANDOFF.md`; never publish raw local logs, downloaded
extension bundles, source manifests containing home paths, or diagnostics.
