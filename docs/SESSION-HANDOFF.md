# Session handoff

Updated October 24, 2026. Read this with `AGENTS.md` before resuming. The user is
ending the session; do not assume the copy/paste Git commands have been executed.

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

Version **0.4.1** introduced the strip; **0.4.2** is the current packaged follow-up.
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

The latest publication review is limited to the current uncommitted hook-label
follow-up, not history or unrelated files. There were no staged changes. The
reviewed set contains 13 changed tracked files, including this handoff and the
root `.gitignore`. The sole initially untracked file, `.codex/.gitignore`, contains
only generated local ignore rules; it is now explicitly ignored at the root.
The existing local hook/helper files remain untouched and ignored. `.vscodeignore`
excludes all `.codex/**` content from packages, and the rebuilt 0.4.2 VSIX was
checked to contain no local `.codex/` files. The earlier intermediate package
included local hook files and was replaced by this corrected build; do not use
older packages as publication artifacts without separately inspecting them.

No credentials, secret keys, personal contact details or machine-specific home
paths were found in the reviewed additions or initially untracked file. The
existing public extension identity and synthetic test fixture names are
intentional. Build output, downloaded references and local logs remain ignored.
This is a review of the current changes, not a certification of the repository's
existing contents or history.

No Git staging, commit, push, fetch, history scan, ref change or cleanup was
authorized or performed. All Git reads must use the user's `git-safe` wrapper;
never fall back to direct Git. A previous wrapper restriction blocked branch
name inspection; this review does not retry or bypass it. The suggested push
uses `HEAD` rather than an unverified branch name.

Copy/paste commands for the reviewed files, from repository root:

```sh
git add -- .gitignore .vscodeignore README.md \
  docs/INTEGRATION.md docs/SESSION-HANDOFF.md install.sh \
  package.json package-lock.json scripts/test-activity-vscode.js \
  src/activity-view.js src/extension.js src/project-hooks.js test/activity.test.js
git commit -m "Label Codex activity hooks and clarify trust setup"
git push -u origin HEAD
```

These commands were not executed by the agent. New changes after this review
require a fresh review; do not infer that the user copied or ran these commands.
Never publish raw local logs, reference bundles, home-path manifests or diagnostics.
