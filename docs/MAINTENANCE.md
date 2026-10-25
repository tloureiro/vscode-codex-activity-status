# Command and artifact review

Reviewed October 25, 2026 for version 0.4.4. The palette now contributes five
commands, down from twelve. `src/repair.js` is the shared setup, repair, update,
removal and legacy-cleanup entry point. Saved keybindings can still call old
command IDs; those aliases contribute no palette entries.

## Removed

- `src/setup.js`: unreachable completion-only setup and startup migration flow.
- `src/notifier.js`, `src/completion-events.js`, `src/completion-state.js`: obsolete
  completion-only producer, watcher and reducer. Current activity has its own
  helper, receiver and state reducer.
- Notify installation/migration code in `src/integration.js`: retained only the
  removal adapter and recognition signatures needed to clean older installations.
- `test/setup.test.js`, `test/completion.test.js`: tests of removed behavior.
  Current setup/repair and legacy-removal coverage replaces them.
- `scripts/test-vscode.js`, `test/vscode-smoke.js`: disconnected smoke test for
  the superseded completion runtime. `npm run test:vscode` uses the activity fixture.
- `research/mockups/activity-panel.html`: superseded large-panel concept.
  The approved status-bar-strip preview remains.
- Deprecated `codexCompletion.*` settings and the unused finished-color
  contribution: the activity implementation did not read them.
- Seven ignored VSIX builds for versions 0.1.0 through 0.4.3: superseded generated
  packages; the current source can reproduce a new package.
- The accumulated session handoff and old publication commands: replaced by the
  current implementation, validation and remaining-limitations handoff.
- Developer documentation and `AGENTS.md` from VSIX contents: retained in the
  repository but excluded from the installed extension package.

## Retained after review

| Area                                                    | Reason                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src/`, `media/`                                        | Reachable production activity, UI, installer, repair and legacy-removal code                                            |
| Current `test/`, `scripts/`                             | Validation, packaging hygiene, source refresh and deterministic live tests                                              |
| `research/hooks/`                                       | Reproducible feasibility fixture; its RPC client is also used by the live activity test                                 |
| `research/introspection/`, `test/introspection.test.js` | Closed study evidence and bounded-reader regression checks; excluded from production packaging                          |
| `research/mockups/status-bar-strip.html`                | Approved design reference for the implemented strip                                                                     |
| Study/source/feasibility documentation                  | Architecture constraints and provenance still referenced by AGENTS.md; historical conclusions remain marked as such     |
| `sources/` (ignored)                                    | Reference snapshots, provenance and private local evidence; required by source-based/live checks and excluded from VSIX |
| `.codex/` (ignored)                                     | Existing project integration; real hook updates/removal still require the product's per-project confirmation            |
| `.vscode/` (ignored)                                    | Existing local editor settings; no obsolete extension-generated preference was established                              |
| `node_modules/` (ignored)                               | Current development dependencies and validator cache; disposable and excluded from VSIX                                 |
| Root config, workflow, license and installer            | Current build, checks, publication metadata and user installation path                                                  |

This is a file/reachability and artifact-purpose review, not a new privacy audit
of repository history or ignored reference contents. No installed extension,
real project hooks, personal Codex configuration or Git metadata were changed.
