# Completion integration

## Supported signal

Codex supports a user-level `notify` command in `~/.codex/config.toml`. At present, the documented notification type is `agent-turn-complete`. Codex invokes the configured program with one JSON argument. This extension installs a marked block like:

```toml
# BEGIN codex-completion notifier
notify = ["/path/to/codex-completion-notify"]
# END codex-completion notifier
```

The notifier deliberately retains only the event type, thread ID, turn ID, working directory, and its own timestamp. It atomically writes that record into a mode-0700 per-user temporary directory. Prompt and response fields are never copied. Extension windows watch that directory and accept events whose working directory overlaps their local workspace.

There is no network listener, app-server proxy, executable replacement, webview scraping, private Codex bundle import, or VS Code patch. The status item uses only the public `StatusBarItem` API.

This design cannot report processing or approval state. The official extension may internally provide `ChatSessionStatus`, but VS Code does not expose another extension's provider state for third-party consumption.

## Configuration ownership

The marker pair is the ownership boundary. Removal deletes only the block between those exact markers. Setup refuses to overwrite any other root-level `notify` value. Helper files are stored under this extension's `globalStorageUri` and removal deletes only the two expected filenames there.

The notifier setting is user-level because Codex ignores `notify` in project configuration. A Codex chat must be restarted after changing it.

## Legacy cleanup

Migration recognizes the old proxy only when the global `chatgpt.cliExecutable` points to the launcher recorded in this extension's global state or to the expected `codex-activity-proxy` filename inside this extension's own global storage. It restores the recorded previous value and does not touch unrelated executable overrides.

Legacy hook cleanup is signature-based. It removes the old exact Sosumi completion command and commands identifying this extension, while preserving unrelated hook handlers and tables. Both `config.toml` hook tables and the older `hooks.json` shape are supported. Writes are atomic and retain the existing file mode.

Official Codex configuration reference: [notifications](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications).
