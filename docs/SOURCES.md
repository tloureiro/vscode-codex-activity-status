# Local upstream references

Run from this project:

```sh
npm run sources:update
```

This downloads public source archives matching the installed VS Code build and
the Codex CLI bundled with the installed official Codex extension. It also copies
the installed Codex extension's compiled extension-host bundle for reference.
It requires Node.js, `curl`, `tar`, and network access. macOS desktop installation
paths are detected by default; use `--help` for installation-path overrides.

| Path                       | Contents                                                                    |
| -------------------------- | --------------------------------------------------------------------------- |
| `sources/codex/`           | `openai/codex`: CLI, core, app-server, and protocol sources                 |
| `sources/vscode/`          | `microsoft/vscode`: Code - OSS sources                                      |
| `sources/codex-extension/` | Installed extension manifest, compiled host JavaScript, readme, and license |
| `sources/manifest.json`    | Requested refs, resolved commits, archive checksums, and installed versions |
| `sources/snapshots/`       | Retained snapshots; the three paths above are local symlinks                |

The Codex IDE extension is [not open source](https://learn.chatgpt.com/docs/open-source).
Its reference copy is a compiled distribution, not the original source. Native
binaries and webview assets are omitted. Code - OSS also differs from Microsoft's
[VS Code distribution](https://code.visualstudio.com/docs/supporting/faq#_what-is-the-difference-between-the-vscode-repository-and-the-microsoft-visual-studio-code-distribution).

## Updating in future sessions

After upgrading VS Code or the Codex extension, rerun `npm run sources:update`.
It detects the new installed versions and resolves their exact upstream commits.
If a bundled prerelease has no public tag, the command fails and preserves the
current references rather than silently downloading unrelated code. An explicit
ref override can then select a known public revision; the manifest records it.

For development ahead of the installed versions:

```sh
npm run sources:update -- --latest
```

For specific tags, branches, or commits:

```sh
npm run sources:update -- --codex-ref rust-v0.164.0-alpha.11.1 --vscode-ref 1.143.1
npm run sources:update -- --help
```

The extension bundle always comes from the installed extension, including in
`--latest` mode. Consult the manifest before comparing it to public sources.
Existing snapshots are reused by commit and retained when versions change.
Treat snapshots as reference copies; keep experiments in separate files. Run one
update command at a time. The updater downloads archives and never invokes Git,
installs dependencies, executes upstream code, or changes installed applications.

Everything under `sources/` is ignored by Git, ESLint, Prettier, and VSIX
packaging. The updater and these instructions remain ordinary project files.
The public-file check also rejects any accidentally tracked source snapshots.

## Research entry points

- `sources/codex/codex-rs/app-server/`: connection handling, event delivery, and subscriptions.
- `sources/codex/codex-rs/app-server-protocol/`: thread states, waiting flags, and protocol schemas.
- `sources/codex/codex-rs/core/`: turn lifecycle, approvals, and hook invocation.
- `sources/codex-extension/out/extension.js`: installed extension-host bundle; inspect its server connection and window ownership.
- `sources/codex-extension/package.json`: actual settings, commands, and API proposals used by the installed extension.
- `sources/vscode/src/vscode-dts/vscode.d.ts`: stable extension API.
- `sources/vscode/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts`: proposed chat-session API.
- `sources/vscode/src/vs/workbench/api/`: extension-host and workbench API implementation.

Source availability does not prove that an interface is public or supported.
Confirm connection ownership, passive observation, and routing with real IDE
sessions before choosing a replacement for the completion-only integration.

See the [self-contained integration study](SELF-CONTAINED-STUDY.md) for findings
against the installed versions, containment requirements, and the recommended
architecture.

The [snapshot-only prototype report](INTROSPECTION-PROTOTYPE.md) records the
subsequent real VS Code inspection result and how to rerun the isolated probe.

The study is now [closed with a decision](STUDY-DECISION.md). Consult that
capability table before proposing product changes or reopening research.
