# Codex Window Activity

Steady blue, amber, and purple **status-item backgrounds in your existing VS Code window**. The wide padded indicator follows each window's own Codex activity, including when two windows share the same project or workspace settings. Activity colors do not write project or global appearance settings.

This is an experimental local macOS integration with the official OpenAI Codex IDE extension. It observes that extension's existing app-server connection through its development-only `chatgpt.cliExecutable` setting. Setup affects the current VS Code profile and preserves existing custom executable overrides.

## Install and start

```sh
./install.sh
```

The installer installs locked build dependencies, checks/packages the current source, and force-installs the VSIX. Node.js 22.22+ and npm are required. It finds `code` on PATH or the standard macOS installation. Use `./install.sh --profile Work` for another profile, or set `CODEX_ACTIVITY_CODE_BIN` to choose the VS Code CLI. To build without installing, run `npm ci` followed by `npm run package`, then use **Extensions: Install from VSIX…** with the generated package in `dist/`.

1. Install the official OpenAI Codex extension and this extension.
2. Run **Developer: Reload Window** in each existing monitored window.
3. Choose **Set Up Activity Colors**, click **Codex: Set Up Colors**, or run **Codex Activity: Set Up Activity Colors**.
4. If setup offers **Reload Window**, use it to restart an already-running Codex connection. Continue in the same window.

Setup checks bridge files, custom-setting conflicts, and the live connection. **Codex: Waiting for Connection** means Codex has not connected; click for Open Codex/Reload actions. **Codex: idle** means monitoring is connected. **Not Now** remembers the dismissed setup issue for this workspace. Disabled monitoring does not prompt. No folder or saved workspace is required by the indicator.

Re-run setup if repair is indicated after updating Codex or this extension. No Codex hooks, configuration, authentication, or transcripts are modified. **Set Up Experimental Codex Bridge** remains available for manual configuration.

## States and acknowledgement

| State                | Background             | Meaning                                                                |
| -------------------- | ---------------------- | ---------------------------------------------------------------------- |
| Processing           | Blue `#245A91`         | A live turn is reasoning, generating output, or running tools/commands |
| Needs input          | Amber `#A66B16`        | A blocking approval/input request or runtime waiting flag              |
| Finished/unread      | Slate purple `#625B78` | A successful completion observed while monitoring                      |
| Idle/acknowledged    | Normal status item     | No active work or unread completion                                    |
| Unknown/disconnected | Normal status item     | Live state cannot be established                                       |

Amber takes priority over blue, which takes priority over purple. Threads are tracked separately; unread completions survive activity in other threads. A new request supersedes unread completion in that same thread. The tooltip shows working, waiting, and unread counts. The active item retains the prototype's 122 trailing spaces for a broad steady signal. Idle, disabled, and disconnected items have normal width.

Returning from another window acknowledges unread completions in this window only. If completion arrives while already focused, purple remains until the next keyboard- or mouse-originated **text-editor selection change**. Command-originated changes, programmatic document edits, timers, and mouse movement do not acknowledge. Focusing a working or blocked window preserves blue/amber. The indicator updates directly without waiting for a settings write; VS Code still schedules its own repaint.

VS Code does not expose general clicks/keystrokes inside Codex's webview, terminals, or menus. An editor click that leaves selection unchanged is also invisible. Click **Codex: finished** to acknowledge, or run **Codex Activity: Acknowledge Completion**. With `autoAcknowledge` off, purple persists until explicit acknowledgement or a new request in the same thread.

Nonblocking asynchronous questions, ordinary tool calls, hooks that might auto-resolve permissions, and final-answer text containing questions do not create amber. Connection loss removes that source's work/unread state. Reconnection reconciles live work; historical success, silence, and process exit never manufacture a completion.

## Colors and compatibility

All three background and foreground pairs have identical defaults in dark, light, and both high-contrast themes. Blue/purple use white text; amber uses black. Each window owns its status item, so sharing workspace settings no longer pauses colors. The rest of the status bar and title bar retain their normal appearance. Enable a hidden status bar through VS Code's Appearance menu.

Custom item backgrounds depend on the private extension-host `ALLOWED_BACKGROUND_COLORS` map. The extension checks the map and built-in warning/error entries, registers only its own color identifiers, and removes only registrations it still owns. This mechanism is experimental and can stop working after a VS Code update. If unavailable or rejected, activity labels and acknowledgement keep working, with the limitation in the tooltip and diagnostics. There is no fallback to settings-based coloring or application patching.

The contributed color identifiers are `codexActivity.processingBackground`, `codexActivity.processingForeground`, and the corresponding `approval`/`finished` pairs. Explicit user/theme overrides of these identifiers take precedence over the fixed defaults. The old `processingColor`, `finishedColor`, `approvalColor`, and `surface` settings are deprecated and ignored in 0.2.0.

## Settings and diagnostics

| Setting                         | Default | Behavior                                                     |
| ------------------------------- | ------- | ------------------------------------------------------------ |
| `codexActivity.enabled`         | `true`  | Monitor this window; disabling clears the indicator          |
| `codexActivity.autoAcknowledge` | `true`  | Acknowledge on focus return and supported editor interaction |

Settings apply without reloading. Search for `@ext:tloureiro.codex-activity-status`.

**Codex Activity: Show Diagnostics** includes the presenter capability/limitation, pending legacy recovery, per-window activity/focus, and a bounded in-memory event history. From the checkout, `npm run diagnostics` queries all running monitored windows through authenticated local sockets without acknowledging or creating a Codex source. No conversation content is recorded and no report is written automatically. Diagnostics contain local paths/process IDs; redact these before sharing publicly. Existing hosts need a reload to use new code.

## Upgrade recovery and removal

Version 0.2.0 restores outstanding journals from the previous full-bar adapter before retiring its settings access. Restoration preserves unrelated settings and newer user edits. It removes an empty settings file/directory only when the journal proves the previous adapter created it. Old journals without that provenance preserve empty files. New activity never creates these files or journals.

If an older monitored window or its watchdog still owns the settings, recovery waits and diagnostics asks you to reload other monitored windows. Invalid JSONC retains the journal for recovery after the settings are fixed. Original user values equal to an old applied overlay cannot be distinguished from extension-owned values. Recovery metadata lives in the per-user `codex-activity-<uid>` temporary directory.

Run **Codex Activity: Remove Bridge and Restore Appearance** before uninstalling, and reload other monitored windows. It disables monitoring and restores the previous executable setting if it still points at this extension's launcher. No workspace switch is needed. Legacy generated activity workspaces remain ordinary saved workspaces.

## Development and validation

```sh
npm ci
npm run validate
npm run test:vscode
ACTIVITY_WITH_OFFICIAL=1 ACTIVITY_FOLDER=1 npm run test:vscode
ACTIVITY_EMPTY=1 npm run test:vscode
ACTIVITY_MIGRATION=1 npm run test:vscode
ACTIVITY_SETUP=1 npm run test:vscode
ACTIVITY_MULTI_WINDOW=1 npm run test:vscode
npm run package
```

`npm run validate` checks syntax, ESLint, formatting, public-file hygiene, and unit/integration tests. Set `GIT_READ_ONLY_BIN` to your read-only Git wrapper for the hygiene check. Desktop tests use disposable profiles/projects and an empty `CODEX_HOME`, with no personal chats or credentials. GUI/socket operations need permission outside restrictive sandboxes. The official-extension test starts its actual app-server without a model request.

See [validation](docs/VALIDATION.md), [integration details](docs/INTEGRATION.md), and the [status-item investigation](docs/STATUS-ITEM-INVESTIGATION.md). The older [appearance architecture review](docs/ARCHITECTURE-REVIEW.md) and `npm run prototype:appearance` describe the superseded full-bar design, not the current indicator.

Initial support: local macOS desktop VS Code with the official Codex IDE extension. Apple Silicon is tested; Intel layout is implemented but unverified. Separate Codex CLI/app sessions, remote/SSH/WSL/containers, VS Code Web, and other editors are outside the initial scope. The extension makes no model calls. Authenticated task/approval behavior and human visual readability remain additional end-to-end checks.
