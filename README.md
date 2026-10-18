# Codex Window Activity

Steady, full status-bar and optional title-bar colors for Codex **in the VS Code window you already use**. Setup does not open a new window, replace your workspace, or create a workspace wrapper.

This is an experimental local macOS integration with the official OpenAI Codex IDE extension. It observes that extension’s existing app-server connection through its development-only `chatgpt.cliExecutable` setting. This setting affects the current VS Code profile; setup preserves existing custom executable overrides.

## Install and start

```sh
./install.sh
```

The installer installs locked build dependencies, checks/packages the current source, and force-installs the VSIX, including same-version replacements. Node.js 22.22+ and npm are required. It finds `code` on PATH or the standard macOS installation. Use `./install.sh --profile Work` for another profile, or set `CODEX_ACTIVITY_CODE_BIN` to choose the VS Code CLI. To build without installing, run `npm ci` followed by `npm run package`, then install the generated VSIX from `dist/` with **Extensions: Install from VSIX…**. Generated packages are not committed.

1. Install the official OpenAI Codex extension.
2. Install this extension and run **Developer: Reload Window**.
3. Choose **Set Up Activity Colors** in the notification, click **Codex: Set Up Colors**, or run **Codex Activity: Set Up Activity Colors**.
4. If setup offers **Reload Window**, use it to restart an already-running Codex connection. Continue using Codex in this same window.

Setup checks for missing/outdated bridge files, custom-setting conflicts, and a live connection. **Codex: Waiting for Connection** means colors are inactive until Codex connects; click it for Open Codex/Reload actions. An activity label such as **Codex: idle** means monitoring is connected. **Not Now** remembers the dismissed setup issue for this workspace; the status action and command remain available. Disabled monitoring does not prompt.

Re-run setup if repair is indicated after updating Codex or this extension. No Codex hooks, configuration, authentication, or transcripts are modified. The separate **Set Up Experimental Codex Bridge** command remains available for manual configuration.

VS Code 1.142.0 may print `[DEP0169] url.parse()` after installation. A trace identifies VS Code’s own Marketplace metadata request; its [request implementation](https://github.com/microsoft/vscode/blob/main/src/vs/platform/request/node/requestService.ts) still uses that deprecated parser. Installation can succeed with that warning; the installer keeps warnings/errors visible.

## States and acknowledgement

| State                | Default                      | Meaning                                                                      |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| Processing           | Blue `#245A91`               | A live turn is reasoning, generating output, or running tools/commands       |
| Needs approval/input | Amber `#A66B16`              | A blocking server approval/structured input request, or runtime waiting flag |
| Finished/unread      | Muted slate purple `#625B78` | A successful completion observed while monitoring                            |
| Idle/acknowledged    | Original appearance          | No active work or unread completion                                          |
| Unknown/disconnected | Original appearance          | Live state cannot be established                                             |

Amber takes priority over blue, which takes priority over purple. Threads are tracked separately. One completion cannot hide another working task; unread completions survive activity in other threads. A new request supersedes unread completion in that same thread. The tooltip shows working, waiting, and unread counts. Colors are steady and remain recognizable while unfocused, including themes that define a separate `statusBar.inactiveBackground`. Both active and inactive status backgrounds are restored when acknowledged or disabled.

Returning from another window acknowledges unread completions in this window only. Restoration is requested immediately, but VS Code applies full-bar colors through its asynchronous settings API. Pending obsolete colors are skipped, and a brief disk/settings-cache mismatch retries automatically without requiring another click. If completion arrives while already focused, purple remains until the next keyboard- or mouse-originated **text-editor selection change**. Command-originated changes, programmatic document edits, timers, and mouse movement do not acknowledge. Focusing a working or blocked window preserves blue/amber.

VS Code does not expose general clicks/keystrokes inside Codex’s webview, the terminal, or menus. An editor click that leaves its selection unchanged is also invisible. Click the purple **Codex: finished** status item to acknowledge immediately, or run **Codex Activity: Acknowledge Completion**; assign a shortcut in standard Keyboard Shortcuts if desired.

Nonblocking (`isBlocking: false`) asynchronous questions, ordinary tool calls, hooks that might auto-resolve permissions, and final-answer text containing questions do not create amber.

For a highlight that lingers after returning, run **Codex Activity: Show Diagnostics**. It includes a bounded, memory-only history of focus changes, state/count changes, completion arrival, and appearance-write/retry timings. This helps distinguish missing focus events, a completion arriving after focus returned, and delayed settings application. It records no conversation content and makes no network requests. Diagnostics include local workspace paths and process IDs; redact these before sharing output publicly. There is no intentional delay to acknowledge on focus. A completion that actually arrives after you returned follows the already-focused rule and waits for a supported interaction.

From the checkout, `npm run diagnostics` fetches live diagnostics from **all running monitored windows**, including their workspace, host PID, current focus/activity, unread state, and recent events. It uses authenticated local Unix sockets; querying neither connects a Codex source nor acknowledges anything. An automatic focus acknowledgement also records a contemporaneous probe of the other windows' focus states. This allows investigation without manually copying output from each window. After installing this instrumentation for the first time, reload existing monitored windows once; older running hosts are explicitly reported as needing a reload. No transcript or conversation content is included, and no report files are written automatically.

## Existing-window colors and the shared-workspace limit

Colors use your **existing workspace settings**, never global appearance settings:

- A normal folder window uses `<project>/.vscode/settings.json`.
- A saved workspace uses its existing `.code-workspace` file.
- Empty or unsaved multi-folder windows need a local folder or saved workspace before full-bar coloring is available.

Color overrides are temporary and restored when the state clears, monitoring is disabled, or the extension deactivates. The settings file may briefly contain activity colors while highlighting and can appear modified in Git. An initially missing settings file can be created and remain as an empty JSON object afterward. Recovery journals and ownership metadata live outside the project.

**Different projects and worktrees can be colored independently in their current windows.** Two windows sharing the _exact same appearance settings file_ cannot have independent full-bar colors with VS Code’s public APIs. The extension registers each monitored window and **pauses full-bar coloring in all detected participants** when a settings file is shared. Their per-window activity tracking and labels continue, with **(shared workspace)** and an explanation. Coloring resumes after only one participant remains.

This detection covers windows running this extension under the same local runtime directory. A duplicate window without this extension may still display the shared settings; detection is not instantaneous during activation. Exact duplicate-workspace full-bar independence remains unsupported. Setup does not ask you to create extra windows to work around this limitation.

## Settings

Search Settings for `@ext:tloureiro.codex-activity-status`.

| Setting                         | Default     | Behavior                                                      |
| ------------------------------- | ----------- | ------------------------------------------------------------- |
| `codexActivity.enabled`         | `true`      | Monitor this window; disable to restore appearance            |
| `codexActivity.processingColor` | `#245A91`   | Working background                                            |
| `codexActivity.finishedColor`   | `#625B78`   | Unread completion background                                  |
| `codexActivity.approvalColor`   | `#A66B16`   | Blocking approval/input background                            |
| `codexActivity.surface`         | `statusBar` | Full `statusBar`, `titleBar`, or `both`                       |
| `codexActivity.autoAcknowledge` | `true`      | Focus-return and supported editor-interaction acknowledgement |

Settings apply without reloading. Colors must be opaque six-digit `#RRGGBB`; invalid values fall back to defaults. Black/white foreground is chosen by contrast. Debugging/no-folder status variants and active/inactive title colors are included. Other extensions’ individual status items may retain their own backgrounds. Enable a hidden status bar through VS Code’s Appearance menu.

On macOS, title colors require `window.titleBarStyle: "custom"`; native title bars cannot reliably show them. Configure this standard VS Code setting if using the title-bar surface. Setup leaves your title-bar preference unchanged. Reset extension settings through the standard Settings gear → **Reset Setting**.

When automatic acknowledgement is off, purple persists until explicit acknowledgement or a new request in the same thread.

## Restoration and removal

Only owned color keys are overlaid, including theme-specific sections. Restoration compares their current values to the applied overlay, preserving unrelated settings and newer user edits. A user edit to an owned key becomes the baseline on refresh. A detached local watchdog restores after an unexpected extension-host exit; startup also recovers outstanding journals. A surviving watchdog finishes before another window can take color ownership.

Connection loss removes that source’s work/unread state instead of inventing completion. Reconnection reconciles only live work. Historical success is never replayed, and silence/process exit never implies success.

To remove, run **Codex Activity: Remove Bridge and Restore Appearance**, disable monitoring or close other monitored windows, then uninstall. The previous executable setting is restored if it still points at this extension’s launcher. No workspace switch is needed. Legacy generated activity workspaces from earlier builds are ordinary saved workspaces now; you may keep using one or return to your original project window.

If the OS kills both host and watchdog, recovery may wait until the workspace is reopened with this extension enabled. Invalid JSONC can also delay safe recovery. Recovery files use `appearance-<id>.json` in the per-user `codex-activity-<uid>` temporary directory. Preserve a remaining journal if recovery fails. Exact user values equal to the currently applied overlay cannot be distinguished from extension-owned values.

## Development and validation

The independent appearance prototype and its architecture decision are documented in [Appearance architecture review](docs/ARCHITECTURE-REVIEW.md). It uses disposable windows/profiles and is excluded from the installed extension.

```sh
npm ci
npm run validate
npm run prototype:appearance
npm run test:vscode
ACTIVITY_WITH_OFFICIAL=1 npm run test:vscode
ACTIVITY_SETUP=1 npm run test:vscode
ACTIVITY_MULTI_WINDOW=1 npm run test:vscode
npm run package
```

`npm run validate` runs syntax checks, ESLint, Prettier checks, public-file hygiene checks, and the unit/integration tests. Use `npm run format` to apply consistent formatting. GitHub Actions runs validation and packaging on macOS; desktop GUI tests remain separate. The real-host tests use temporary VS Code profiles/projects and an empty `CODEX_HOME`; they do not use personal chats or credentials. The setup test covers a normal single-folder window, setup/reload in place, colors, and restoration. Other tests cover saved workspaces and simultaneous windows. Socket/GUI tests require permission outside restrictive execution sandboxes.

Local editor settings, `.env` files, diagnostic dumps, dependencies, and generated packages are ignored by Git. Review `git status` before committing; diagnostics should not be added to the repository.

Initial support: local macOS desktop VS Code with the official Codex IDE extension. Apple Silicon was tested; Intel layout is implemented but unverified. Separate Codex CLI/app sessions, remote/SSH/WSL/containers, VS Code Web, and other editors are outside the initial scope. The extension makes no model calls. Authenticated task/approval behavior and human visual readability remain additional end-to-end checks.

See [validation and A–N procedure](docs/VALIDATION.md) and [integration details](docs/INTEGRATION.md).
