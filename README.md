# Codex Completion

A small completion-only indicator for the official Codex extension in VS Code.

When a Codex turn finishes for the current workspace, the status bar shows **Codex: finished** until you return to the window, interact with a text editor, or click the item. It does not attempt to show processing or approval state.

## Why this version is less intrusive

Version 0.3 uses supported configuration and public APIs:

- Codex's documented top-level `notify` setting supplies `agent-turn-complete` events.
- A tiny local notifier forwards only event type, thread ID, turn ID, working directory, and timestamp. Prompt and response text are discarded.
- VS Code's public status-item API renders the result. VS Code itself is never patched.
- The official Codex extension's executable and private state are not intercepted or inspected.

This tradeoff is intentional: Codex does not currently expose another extension's live processing/approval state through a public VS Code API. Completion is the reliable supported signal available today.

## Install and set up

```sh
./install.sh
```

Then reload VS Code and run **Codex Completion: Set Up**. Setup adds one clearly marked block to the user-level `~/.codex/config.toml` and copies a small notifier into this extension's VS Code global storage. Restart the current Codex chat after setup so it reloads the configuration.

If Codex already has a custom top-level `notify` command, the extension leaves it untouched and reports a conflict.

## Migrating from an older release

Setup detects the former integration and can migrate it in one action. Migration:

- restores the previous global `chatgpt.cliExecutable` value when it still points at this extension's proxy;
- deletes that proxy from this extension's global storage;
- removes only recognized legacy Codex Activity hook commands;
- preserves unrelated hooks and configuration; and
- installs the completion notifier.

You can perform cleanup without enabling the new integration with **Codex Completion: Remove Legacy Hooks and Proxy**.

To undo everything owned by this release, run **Codex Completion: Remove Integration**. It removes the marked `notify` block and helper files, cleans recognized older integration artifacts, and disables monitoring. Restart the current Codex chat afterward.

## Settings

| Setting                           | Default | Behavior                                                            |
| --------------------------------- | ------- | ------------------------------------------------------------------- |
| `codexCompletion.enabled`         | `true`  | Show completion notifications in this window                        |
| `codexCompletion.autoAcknowledge` | `true`  | Clear the indicator on focus return or supported editor interaction |

Initial support is local macOS desktop VS Code. Completion files live in a private per-user temporary directory and expire after ten minutes. A completion is routed to a window when its Codex working directory overlaps that window's local workspace folders. With no folder open, only the focused window accepts the event.

## Development

```sh
npm ci
npm run validate
npm run test:vscode
npm run package
```

See [integration details](docs/INTEGRATION.md) and [validation](docs/VALIDATION.md).
