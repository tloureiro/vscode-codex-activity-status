# Validation and manual verification

The 0.2.0 presenter uses independent padded status items. Earlier evidence for the full-bar adapter and independent appearance prototype is historical; it does not validate this presenter.

Verified October 20, 2026 on VS Code 1.142.0: all 66 unit/integration tests,
all four theme palettes, the actual official Codex connection, empty-window
support, upgrade recovery, setup after reload, and two windows sharing the exact
same workspace settings target passed. [Sanitized production evidence](evidence/status-item-production.json)
records rendered samples and lifecycle checks.

## Automated coverage

| Command                                                          | Coverage                                                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`                                               | Syntax, lint, formatting, public-file hygiene, state/protocol/routing tests, private capability guards, cleanup, and legacy migration                      |
| `npm run package`                                                | Locally installable VSIX with development files excluded                                                                                                   |
| `npm run test:vscode`                                            | Rendered blue/amber/purple and foregrounds in four themes, acknowledgement, programmatic edits, disable, child association, and unchanged project settings |
| `ACTIVITY_WITH_OFFICIAL=1 ACTIVITY_FOLDER=1 npm run test:vscode` | Actual official Codex app-server association plus controlled activity in an ordinary folder                                                                |
| `ACTIVITY_MIGRATION=1 npm run test:vscode`                       | Startup restores a seeded full-bar journal and preserves original user colors                                                                              |
| `ACTIVITY_EMPTY=1 npm run test:vscode`                           | Indicator in an empty window without an appearance settings target                                                                                         |
| `ACTIVITY_SETUP=1 npm run test:vscode`                           | Setup and reconnect after reload in the same disposable profile/folder, without project settings creation                                                  |
| `ACTIVITY_MULTI_WINDOW=1 npm run test:vscode`                    | Two disposable profiles opening the exact same saved workspace, independent rendered colors/acknowledgement and native focus return                        |

Unit tests retain the former adapter's JSONC/user-edit/watchdog checks for upgrade recovery. Migration tests verify clean projects remain untouched, legacy and current journal recovery, waiting for older live owners, and retaining invalid-JSONC journals. Presenter tests verify fixed theme defaults, warning/error capability checks, loss/replacement of the private map, foreign registration protection, and removal of only owned entries. State and protocol tests cover blocking versus asynchronous input, multiple threads, delayed/duplicate events, cancellation/failure/disconnect, UTF-8 framing, and authenticated routing/diagnostics.

Desktop tests create temporary profiles/projects and an empty `CODEX_HOME`; they use no personal chats or credentials. Renderer debugging only inspects disposable test windows and does not implement the indicator. The official-extension test starts a real app-server but sends no authenticated model request. Setup testing restarts a host because Reload Window closes VS Code's CLI runner; it does not prove continuous UI-window identity. Test timing is observational, not a physical repaint guarantee.

## Manual checks

- Start work in A with B idle: only A's item turns blue. Trigger a blocking request: amber persists through focus changes until resolved.
- Finish while A is unfocused: purple persists until returning to A. Finish while focused: purple waits for a supported editor selection change or explicit acknowledgement.
- Run concurrent chats: amber/blue takes priority while unread counts remain in the tooltip. Starting another request in a completed thread supersedes its unread state.
- Disable automatic acknowledgement: focus and editor interactions preserve purple until explicit acknowledgement/new work in that thread.
- Switch dark/light/high-contrast themes: the default palette remains constant. Disable or disconnect: the item loses its background and padding. Title and full status-bar backgrounds remain unchanged throughout.
- Open two windows on the same workspace settings: independent tasks retain independent item backgrounds. Acknowledging either window leaves the other unchanged.
- Upgrade an older active window: its full-bar overlay is recovered, preserving user settings. Reload all older monitored windows so a surviving older build cannot reapply its overlay.
- Remove the bridge and verify the previous `chatgpt.cliExecutable` setting returns.

## Limits

Custom backgrounds depend on a private VS Code implementation field and can break after an update. Capability loss retains a normal activity label and explains the limitation in diagnostics/tooltip; it never falls back to project settings writes.

Authenticated model-driven approvals/cancellations, future official extension/VS Code updates, Intel macOS, and physical interaction/readability require additional manual verification. Native title-bar styling is no longer part of the implementation. The original independent full-bar prototype remains available only as historical development material.
