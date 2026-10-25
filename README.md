# Codex Activity

A colored strip in the existing status bar for the official Codex extension in
local macOS VS Code. It uses solid block characters and foreground color in this
extension's own item, with no extra editor-height cost. It does not recolor chrome
backgrounds, write theme settings, patch VS Code, or intercept Codex's execution.

- **Blue — Working:** a prompt or tool activity signal was observed.
- **Amber — Attention requested:** an approval or question signal was observed.
- **Purple — Finished:** an existing session record confirmed turn completion.
- Failed, interrupted, stale and unconfirmed outcomes have separate presentations.

The strip shows during activity, attention requests and unread completions; other
states use a compact text item. Click the purple strip to acknowledge. Choose a project or one
observed conversation, or aggregate all conversations in that project.

## Install and enable a project

```sh
./install.sh
```

Reload VS Code, then run **Codex Activity: Install or Update Project Hooks**.
The confirmation explains the exact project files being added. Setup requires
an independently installed Node.js 18+ runtime; it detects common locations or
uses `codexActivity.nodePath`.

Setup creates `.codex/hooks.json` and a standalone helper under
`.codex/codex-activity/`, adding rules to `.codex/.gitignore` so the new hook file
and helper stay local. No Git commands or Git metadata edits are involved. An
existing hook file is left untouched: this first version refuses to overwrite or
merge unrelated hooks. Ignore rules cannot untrack already tracked files.

In the VS Code Codex sidebar, open **Codex settings → Hooks**. Review this project's
seven hooks labelled **Codex Activity — …**, expand their details, and allow them.
The labels identify session start, prompt submission, tool start, permission requests,
tool finish, turn stop and interruption. Then start a new chat. Installation does not bypass trust or modify
your Codex user configuration. Codex manages trust separately and may write its
own trust records there. Both project trust and hook trust are required.

If an older installation shows “Hook 1” through “Hook 7”, run **Codex Activity:
Install or Update Project Hooks** after updating the extension. Confirm the project
update to add the labels, then review the updated definitions in Codex settings →
Hooks. Changed definitions may require approval again. CLI users can use `/hooks`.

No extra panel needs to stay open. Keep VS Code's existing status bar visible;
`codexActivity.beaconWidth` adjusts the strip width (24 block characters by
default). It uses status-bar width without reducing editor height. Mission Control
visibility still depends on thumbnail scale: the existing bar's fixed height may
become thin when many windows are shown.

**Codex Activity: Show Panel** opens the optional large detail panel on request.
It starts hidden and is never opened by setup or incoming events. The status-bar
strip continues working while that panel is closed.

## Independence and limitations

Seven short asynchronous hooks write only event/session/turn/project/tool
metadata into private local storage while a receiver is active. The helper
returns no decisions or model context. It does not connect to VS Code, run an
app-server, install a service, change the Codex executable, or inspect private
extension objects. A missing receiver/helper or hung observer did not prevent
Codex turns from completing in disposable-profile tests.

Signals can arrive late, out of order, or be lost. Blue does not guarantee active
processing; amber does not prove a human is still needed. A stop hook alone does
not mean success: completion is confirmed by a bounded read of the matching
existing Codex session file. Missing/unsupported records stay unconfirmed. After
two minutes without fresh activity, an unfinished turn becomes unknown.

Routing is **project/thread based**. Two windows opening the same project can
show the same conversations. There is no claim of automatic exclusive window
ownership. Use **Choose Project or Conversation** to select the displayed scope.

## Removal and upgrades

**Codex Activity: Remove Project Hooks** confirms removal of unchanged files owned
by this extension. Edited/unrelated files are preserved; ignore rules and Codex
trust records remain. Restart the Codex chat after installation/removal. Helper
updates also require an explicit action; edited installations are not repaired
silently.

Version 0.4 does not install the old completion-only `notify` integration and
does not automatically clean up previous configuration. If upgrading from 0.3,
the old notifier may remain until you explicitly run **Codex Activity: Remove
Legacy Completion Integration**. The legacy proxy/hooks cleanup command also
remains available behind confirmation.

## Settings

| Setting                         | Default | Behavior                                                             |
| ------------------------------- | ------- | -------------------------------------------------------------------- |
| `codexActivity.enabled`         | `true`  | Listen only in projects with an installed integration                |
| `codexActivity.autoAcknowledge` | `false` | Optionally clear unread outcomes when returning to this window       |
| `codexActivity.nodePath`        | empty   | Detect Node, or choose an absolute standalone runtime path for setup |
| `codexActivity.beaconWidth`     | `24`    | Strip width in solid block characters (8–48)                         |

Disabling monitoring removes this window's receiver immediately. Other windows
can continue observing the same project. Hooks return without publishing events
once no live receiver remains. No background monitoring daemon is installed.

## Development

```sh
npm ci
npm run validate
npm run sources:update
npm run test:vscode
npm run package
```

The live test uses installed applications in a disposable profile, a localhost
fake model and an OS sandbox. It needs permission to open that profile and listen
on localhost. It makes no real model requests and changes no normal configuration.

See [integration](docs/INTEGRATION.md), [validation](docs/VALIDATION.md),
[source references](docs/SOURCES.md), and [hook feasibility](docs/HOOK-FEASIBILITY.md).
