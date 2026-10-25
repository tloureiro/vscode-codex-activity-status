# Session handoff

Updated October 25, 2026. Read this with `AGENTS.md` before resuming. The user is
ending the session; do not assume the copy/paste Git commands have been executed.

## Generated project files follow-up

Version **0.4.3** fixes two paths that left extension metadata visible to Git.
The installed 0.4.2 hook setup wrote `codexActivity.enabled: true` to workspace
settings when monitoring was disabled, potentially creating `.vscode/settings.json`
or editing a `.code-workspace` file. Setup now stores consented local enablement
in VS Code `workspaceState`; it survives reload, and a subsequent explicit
`codexActivity.enabled` configuration change clears that override.

The generated `.codex/.gitignore` now ignores itself as well as `hooks.json` and
`codex-activity/`. Older installations lacking this rule report an update requirement;
planning and startup do not rewrite them. Unrelated ignore text and Codex files
are preserved. Existing real-project integrations were left unchanged. Specific
local observations are recorded only in the ignored local handoff.

Validation: Node 22.23.4 on macOS, all **34 tests**, syntax, lint, formatting,
workflow and public-file checks, fresh `npm ci`, and VSIX packaging passed via
`npm run ci:local`. The first sandboxed rehearsal could not resolve GitHub for
the validator download; the approved network-enabled rerun passed. A disposable
installation under this repository also passed actual `git-safe` ignore/status
checks: all generated files ignored, unrelated Codex configuration visible, and
removal leaves no generated untracked ignore file. Disabled-setup coverage checks
cancellation, consent, reload and later explicit disabling without preference
writes. The GUI fixture was not rerun for this change. Local rehearsal is not a
GitHub CI result. The 0.4.3 package has not been installed in the normal profile;
existing projects still need the normal explicit hook-update confirmation.
No Git writes were performed. The current publication review and copy/paste
commands are recorded below.

## Local CI validation follow-up

The user requested local checks to avoid repeated GitHub failures. The latest
failed run started no jobs. Local actionlint reproduced an invalid `runner.temp`
expression in job-level `env`; the workflow now derives the manifest path inside
a step from `$RUNNER_TEMP` and exports it with `$GITHUB_ENV`.

`npm run validate` now includes pinned, checksum-verified actionlint 1.7.12.
`npm run ci:local` uses the approved wrapper to copy current public candidates,
including uncommitted/untracked changes, into a disposable directory and runs the
CI sequence: snapshot, fresh `npm ci`, validation, packaging. Both CI and the
rehearsal use Node 22 from `.node-version`; the local default was Node 24, so this
session used a temporary standalone Node 22.23.4 runtime. The rehearsal requires
macOS and network access for fresh dependencies and the validator download.
Successful copies are removed; failed copies remain local for inspection.

Validation: the fresh Node 22 rehearsal passed all **32 tests**, syntax, lint,
formatting, workflow expressions, public-file checks and VSIX packaging. A
negative fixture confirmed that the new checker rejects the original invalid
expression. `AGENTS.md` now requires this rehearsal before future handoffs.
The live VS Code fixture was not rerun for these CI-only changes. This is local
verification; the updated workflow has not run on GitHub. No Git writes were
performed. The older publication review and copy/paste commands below do not
cover these new changes.

## Hook review labels follow-up

Version **0.4.2** adds descriptive `statusMessage` labels to all seven project hooks,
so Codex's review dialog identifies each as “Codex Activity — …” with its event.
Setup, status messages and README now direct VS Code users to Codex settings →
Hooks. Existing owned installations without labels report an update requirement;
the normal per-project confirmation remains required and startup never rewrites them.
Changed definitions may need approval again in Codex.
Packaging also excludes `.codex/**` so locally installed project hooks, runtime
paths and ownership metadata never enter the VSIX.

Validation: `npm run validate` passed with **31 tests**, including an upgrade from
unlabelled hooks without writes during planning. `npm run test:vscode` passed with
the deterministic local fixture; it also verifies that the installed Codex runtime's
`hooks/list` exposes all seven labels consumed by the review UI. This checks the
runtime data; the native review dialog itself was not visually automated.

The updated package is `dist/codex-activity-status-0.4.2.vsix`. This follow-up has
not installed it in the normal profile, updated real project hooks or granted
Codex trust. Install the package, reload VS Code, run **Codex Activity: Install or
Update Project Hooks**, confirm the project update, and review the labelled hooks
in Codex. No Git writes were performed. The existing untracked `.codex/` content
was present before this follow-up and was left unchanged.

## Current product decision

Version **0.4.1** introduced the strip; **0.4.3** is the current packaged follow-up.
The user approved a wide colored
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

October 25, 2026: the user requested a public-release privacy review limited to
current staged, unstaged and untracked changes. The reviewed set is the nine
modified tracked files listed in the command below. There are no staged or
unignored untracked files. No history or unrelated source files were audited.

A project-specific observation in the new handoff text was moved to ignored
`sources/analysis/SESSION-HANDOFF.md`. No credentials, secret keys, personal
contact details, machine-specific paths, private service endpoints or temporary
research artifacts were found in the remaining changed content. The existing
public extension identity and synthetic test data are intentional. Existing root
ignore rules cover local hooks, workspace settings, references, build output,
environment files and logs; no root `.gitignore` update was needed. The new
project-installer self-ignore rule is part of the reviewed fix.

The 0.4.3 VSIX excludes local `.codex/` and `.vscode/` files. The final Node 22
macOS `npm run ci:local` rehearsal passed all 34 tests, validation and packaging.
This is local verification, not a GitHub CI result; the GUI fixture was not rerun.
The installed normal-profile version remains 0.4.2. Installing 0.4.3, reloading
VS Code and confirming each project's hook update remain future product actions;
this review did not install hooks, grant trust or clean up existing project files.

No staging, commit, push, fetch, history scan, ref change or Git cleanup was
performed or authorized. The commands below are for the user to copy and paste.
Do not infer that they were executed, and do not execute them in a future session
without express permission for the specific operation and target. All Git reads
must use the approved `git-safe` wrapper. No branch-name inspection was attempted;
the push uses the current `HEAD` and existing `origin` remote.

From the repository root, for this reviewed change set only:

```sh
git add -- README.md docs/INTEGRATION.md docs/SESSION-HANDOFF.md \
  package.json package-lock.json src/extension.js src/project-hooks.js \
  test/activity-setup.test.js test/activity.test.js
git commit -m "Keep project hook installation metadata local"
git push -u origin HEAD
```

New changes after this review require a fresh review. This review covers current
changes only and does not certify repository history or existing contents.
Never publish raw local logs, reference bundles, home-path manifests or diagnostics.
