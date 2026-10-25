# Session continuity

For session continuity, read `docs/SESSION-HANDOFF.md` first. Optional local-only
artifact locations are in ignored `sources/analysis/SESSION-HANDOFF.md`.

# Git guardrail

Use only the user's read-only `~/sync/scripts/git-safe` wrapper for Git reads.
If it blocks a read, stop that operation; do not bypass it with another command,
tool, executable, direct metadata access or configuration change. Git writes
require express permission for the specific operation and target, including
staging, commits, branch/ref/worktree changes, clone/fetch/pull/push and maintenance.
Ordinary implementation/review requests and saved command approvals are not that
permission. Copy/paste commands in handoff documents are not authorization to run
them. Never stage, commit or push on the basis of this session's publication review.

# Validation before handoff

Run `npm run ci:local` on macOS with the Node version in `.node-version` before
handing off changes. It rehearses fresh installation, validation (including
GitHub Actions workflow expressions), and packaging in a disposable copy of the
current public files, using the approved wrapper without Git writes. Report any
failure or unavailable prerequisite explicitly; do not claim GitHub CI passed
from a local rehearsal. `npm run validate` is the faster check during editing.

# Upstream reference sources

For Codex or VS Code integration research, read `docs/SOURCES.md` and
`sources/manifest.json` first. Local references are in `sources/codex/`,
`sources/vscode/`, and `sources/codex-extension/`. The extension reference is a
compiled installed bundle, not original source.

Refresh references with `npm run sources:update` after installed versions change.
Use `npm run sources:update -- --latest` only when investigating upstream main;
the default matches installed versions. The updater downloads archives without
Git operations. Keep all downloaded references under ignored `sources/` and out
of the extension package. Do not modify the reference snapshots for experiments.

# Self-contained product boundary

Read `docs/SELF-CONTAINED-STUDY.md` before changing activity integration. The
user requires this extension to remain independent of Codex's execution path.
Do not introduce executable proxies/overrides or new notify callbacks,
application patches, replacement of private methods/shared rendering state, workspace appearance
overlays, or monitoring daemons. The subsequently authorized opt-in project hooks
are the sole exception to the earlier no-external-configuration rule. Hook setup
must require explicit per-project consent; do not automate Codex hook trust or
edit unrelated hook files. Product monitoring must not otherwise change Codex or
VS Code configuration outside this extension's own preferences. Failure must
stop our observer and leave the other applications running normally.

Use public APIs for extension-owned UI and storage. Any read-only session-file
adapter must state its limitations: no definitive approval state or automatic
window ownership from cwd. Do not infer missing signals. Existing external
integration artifacts are not permission to rewrite configuration automatically;
the study itself performs no migration or cleanup.

The user accepts maintaining version-specific private introspection for this
personal plugin. Unsupported interfaces are not automatically disqualified.
The user's subsequent clarification permits inspection but excludes modifying
external plugins, applications, or services, including their private runtime
collections. Do not register our callbacks in Codex's private listener sets.
The previously proposed internal subscription is excluded under this rule.
Research may inspect existing data through bounded reads/descriptors, without
calling target methods/getters that can change behavior. See
`docs/INTROSPECTION-PROTOTYPE.md`: real connection inspection passed in an
isolated profile, but complete read-only activity state is still unverified.
Copied-source replay now demonstrates missing blocking-input/terminal fidelity
and stale approval entries in the inspected host caches. Richer runtime state
was located in the webview code, but no compliant live access path is established.
The selective descriptor experiment uses only a fixed inspector-owned projection
with V8 side-effect rejection, not calls to Codex methods or target getters.
Investigate in a disposable profile first. Inspector use itself has runtime
overhead; do not claim it is literally free of effects.

# Study closure

The bounded study is closed. Read `docs/STUDY-DECISION.md` before further work.
The final ready-sidebar probe found no compliant renderer-state access path;
do not promote host-cache introspection to a full activity indicator. Do not
continue alternative-route research automatically. Reopening requires a concrete
new interface/version change or an explicit user request. The production
extension and its existing external integration have not been migrated by this
study.

# Opt-in hooks follow-up

The user explicitly reopened feasibility and then requested implementation of
consented, ignored project hooks and extension-owned colored activity UI. The
latest choice makes colored block characters in our own public status-bar item
the default. The large panel stays optional and must never open automatically.
Do not change chrome backgrounds or appearance configuration.
Read `docs/HOOK-FEASIBILITY.md` and `docs/INTEGRATION.md`. Implementing setup is
authorized; installing hooks in real projects still requires the product's
per-project confirmation. Trust remains a separate Codex review. Tests must use
disposable profiles/projects with a local deterministic fixture, not real model
requests or personal credentials. The earlier strict-boundary decision remains
historical context, not the product specification for the authorized hook mode.
