# Validation and manual verification

Validation environment: macOS on Apple Silicon, VS Code 1.142.0, official Codex IDE extension 26.1007.21434, and bundled Codex CLI 0.162.0-alpha.17.2.

## Automated coverage

| Command                                        | Coverage                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`                             | Syntax, ESLint, formatting, public-file hygiene, and 42 unit/integration tests                                                                      |
| `npm run package`                              | Build a locally installable VSIX with development files excluded                                                                                    |
| `npm run test:vscode`                          | Real configuration APIs, fixture lifecycle events, child-process association, state priority, acknowledgement, user customizations, and restoration |
| `ACTIVITY_MULTI_WINDOW=1 npm run test:vscode`  | Two simultaneous project windows, independent routing, actual rendered blue/purple/amber, focus acknowledgement, and restoration                    |
| `ACTIVITY_WITH_OFFICIAL=1 npm run test:vscode` | Real official Codex app-server connection through the bridge, with subsequent controlled fixture transitions                                        |
| `ACTIVITY_SETUP=1 npm run test:vscode`         | Setup in an existing single-folder window and connection/restoration after restart                                                                  |
| `npm run prototype:appearance`                 | Independent appearance implementation; 62 rendered checks across Dark Modern and Light Modern; shared-settings negative test                        |

`npm test` covers state priority and per-window/per-thread independence; blocking input and approval resolution; exclusion of asynchronous questions; duplicate/delayed lifecycle events; cancellations, failures, and disconnects; bounded UTF-8 JSON parsing; authenticated local routing; exact byte relay and child exit status; shared settings ownership; color contrast and validation; preservation of user edits and theme overrides; JSONC recovery; and watchdog recovery after parent IPC loss. Diagnostics tests verify live snapshots, authentication, unchanged unread/activity state, and rejection of injected activity on diagnostic connections.

Desktop tests create temporary profiles/projects and an empty `CODEX_HOME`; they do not use personal chats or credentials. The official-extension test starts its real app-server but sends no authenticated model request. Setup testing restarts a host in the same temporary profile/folder because VS Code closes its CLI test runner on Reload Window; this is not continuous UI-window identity verification. GUI and Unix-socket tests need an environment that permits those operations.

The optional native focus fixture can be compiled with `swiftc test/focus-app.swift -o /tmp/codex-activity-focus-app` and enabled with `ACTIVITY_FOCUS_APP=/tmp/codex-activity-focus-app ACTIVITY_MULTI_WINDOW=1 npm run test:vscode`. It exercises returning to a different project window from another application. Tests use VS Code's Focus Window command rather than synthetic physical mouse clicks.

## Evidence and interpretation

Sanitized results are stored in [evidence](evidence/). See the [architecture review](ARCHITECTURE-REVIEW.md) for the independent prototype, screenshots, and scope constraints. Raw logs and temporary profile paths are not committed.

The rendering regression verifies `statusBar.inactiveBackground`: without that override, the active color can remain correct in settings while an unfocused window renders its theme's inactive background. Current checks read the actual rendered blue, purple, and amber backgrounds before and after focus changes. State assertions also ensure focusing another window does not acknowledge completion or resolve approval.

Timing measurements in saved evidence are observations of asynchronous settings application, not physical repaint guarantees. An existing extension host must reload after installing new code, including same-version replacements.

## Limits and remaining verification

The independent prototype excludes production IPC and crash recovery; it is not an installable replacement for the extension. Authenticated end-to-end Codex approvals, cancellations, updates to the official extension, Intel macOS, native title-bar behavior, and physical input/rendering behavior across other themes remain separate verification work.

Two windows sharing the exact same appearance settings file cannot be independently colored by this settings-based adapter. Monitored participants pause full-bar colors and retain separate activity labels. Unmonitored duplicates may still display shared file changes. Different projects/worktrees and distinct saved workspace settings files can be independent.

## Practical A–N procedure

Install/setup as described in the README. Use your existing windows A and B with different projects/worktrees (or distinct saved workspace settings files), with both visible. Start with default automatic acknowledgement enabled; use `surface: both` when testing title colors. For N, use two windows sharing the exact settings file and verify the explicit limitation. A third ordinary window C can verify lack of unrelated changes.

| Case | Action                                                                                                   | Expected                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Ask Codex in A for a task long enough to inspect; leave B idle                                           | A blue, B/C unchanged                                                                                                                               |
| B    | Focus B before A successfully finishes                                                                   | A muted purple, B unchanged                                                                                                                         |
| C    | Return to A using mouse or keyboard window switching                                                     | Only A’s unread completion clears                                                                                                                   |
| D    | Switch away/back while A still works                                                                     | A stays blue                                                                                                                                        |
| E    | Cause a genuine sandbox/network/tool approval in A; switch focus                                         | A amber until the request resolves, including while unfocused                                                                                       |
| F    | Accept or decline the request                                                                            | A follows actual continued/completed/interrupted state                                                                                              |
| G    | Keep A focused through completion; then change a text-editor selection with keyboard/mouse               | Purple appears initially and clears on that next supported interaction; workspace edits, webview clicks, and mouse movement alone do not count      |
| H    | Start two chats in A; finish one while another runs or waits                                             | Blue/amber wins; tooltip retains unread count                                                                                                       |
| I    | Submit a new request in the completed chat before acknowledging                                          | Processing supersedes that chat’s old unread state immediately                                                                                      |
| J    | Cancel a turn, induce a failure, or stop/restart the app-server                                          | No new purple completion; interruption/failure or disconnected state is explained secondarily                                                       |
| K    | Change color and surface while highlighting; try invalid JSON color values                               | Current state persists; valid colors apply live; invalid values fall back                                                                           |
| L    | Set an unrelated custom color; change an owned color while active; acknowledge/disable                   | Latest user settings survive; only the overlay is removed                                                                                           |
| M    | Switch focus with blue/amber/purple visible                                                              | Status-bar signal remains; custom title’s inactive background matches active background                                                             |
| N    | Open the same appearance settings file in two monitored windows, if VS Code permits; run different tasks | Both pause full-bar colors and explain shared workspace; activity/acknowledgement remain per window. Closing a participant permits colors to resume |

Also check:

- Set `autoAcknowledge: false`, focus and interact: purple persists until explicit acknowledgement/new same-thread request.
- Reload during an active turn: restore/reconcile live activity without manufacturing unread completion. Close a window during activity and reopen the same folder/workspace: no historical success replay.
- Change theme during each state and acknowledge: the chosen theme and original theme-scoped overrides return.
- Disable monitoring in Settings while blue/amber: original appearance returns. Re-enable: active proxy state reconciles on reconnect.
- For crash recovery, use only a disposable test profile/workspace. Terminate its extension host while highlighted and allow the helper to restore; do not kill unrelated VS Code processes.
- Run removal before uninstalling and verify the previous `chatgpt.cliExecutable` setting returns.
