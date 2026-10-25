# Project activity integration

Version 0.4 uses opt-in project hooks and public VS Code UI/storage APIs. This is
the explicitly authorized relaxation of the earlier configuration-free boundary.
It is not an executable proxy, transport interceptor or private-state observer.

## Installation and ownership

The installer prepares a read-only plan, checks an independent Node.js 18+
executable, and asks for per-project consent. Cancelling does not create project
files. An existing `.codex/hooks.json` without our ownership manifest is refused.
An edited installation is also refused rather than overwritten. Files and
directories used for installation must not be symlinks. Changes during review
invalidate the plan.

Installed files:

| File                                         | Purpose                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `.codex/hooks.json`                          | Seven async command registrations, timeout 1 second         |
| `.codex/codex-activity/observer.js`          | Standalone helper, copied from this extension               |
| `.codex/codex-activity/observer-config.json` | Canonical project and private event-storage path            |
| `.codex/codex-activity/installation.json`    | Ownership, checksums and selected runtime                   |
| `.codex/.gitignore`                          | Rules ignoring the hook file and installed helper directory |

The registration is published last. Files use atomic replacement; new helper,
configuration and event files are private. Existing ignore text is preserved.
Removal unregisters unchanged hooks before deleting unchanged owned helper files,
preserves unknown files and leaves ignore rules. No Git commands or metadata
changes are required. Ignore rules cannot untrack pre-existing tracked files.

Each command includes a descriptive `statusMessage` beginning with “Codex Activity —”
and identifying its event. Codex uses it as the hook review row label. Existing owned
installations without these labels are marked for an explicit project update; startup
does not rewrite them. In the VS Code Codex sidebar, review the updated definitions
under Codex settings → Hooks and allow them before starting a new chat.

The installer does not write Codex's user configuration or grant trust. Project
trust and exact hook-definition trust are reviewed separately in Codex. Its
normal trust UI records `hooks.state` in its own user configuration. Helper content
is not itself covered by a promise that declaration trust prevents future edits.

## Event path

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`,
`Stop` and `Interrupt` run asynchronously. Every command ends without exposing
stdout/stderr or returning control decisions. Missing runtime/helper errors are
neutral shell exits; Codex also bounds a hung command with a one-second timeout.
The helper has a 700 ms stdin deadline and an 8 MiB input cap; larger inputs are
dropped. It never approves, denies, rewrites or adds model context.

The extension creates a short-lived receiver lease in a mode-0700 per-user,
per-project temporary directory. The helper publishes only if a valid receiver
lease exists. A receiver renews its lease every four seconds, removes it on
disable/dispose and expires after 15 seconds following a crash. The helper needs
no acknowledgement, connection or VS Code executable. Another observing window
can keep its own receiver active.

Event files contain only schema/id, event name, canonical cwd/project, session/turn
IDs, tool name/use ID, transcript path and receipt time. Prompts, responses, tool
arguments and approval reasons are discarded. The extension polls at 500 ms,
processes bounded batches, retains events at most 30 minutes and prunes older
records sooner under capacity pressure. The helper stops publishing if storage
exceeds its cap. Such drops remain an observation gap, never a Codex dependency.

## State and completion

The reducer keeps at most 128 observed turns. Prompt/tool signals produce blue;
approval/question signals produce amber. A matching tool result clears an
attention candidate. Late tool-starts do not clear an existing approval signal;
known resolved question IDs do not recreate attention. A stop/interrupt signal
first produces an unconfirmed outcome, not a successful completion.

The bounded rollout reader reads only the hook-reported `.jsonl` path under the
active Codex home's `sessions` or `archived_sessions`. It resolves containment,
rejects final-file symlinks, checks ownership, reads at most 256 KiB per file per
poll and retains only minimal terminal metadata. It does not write transcripts.
Cached terminal metadata handles a hook arriving after the corresponding record.

`task_complete`/`turn_complete` confirms completion; an error flag produces Failed;
`turn_aborted` produces Interrupted. Message/error text is not retained. Confirmed
outcomes dominate late hook events. An unread outcome persists in workspace state
and remains visible until acknowledged. Restored nonterminal state is unknown,
and two minutes without recent signals makes a live candidate unknown. An open
turn is not proof that Codex is processing.

Hook signals are not a definitive waiting-state API. A prompt may be rejected,
another hook can resolve approval, questions can be nonblocking/invalid, and stop
hooks can request continuation. Multiple hooks may finish out of order. The UI
therefore says Attention requested and confirms outcomes independently. Project
cwd does not establish exclusive VS Code window ownership.

## Presentation and legacy configuration

Version 0.4.1 renders a wide run of solid block characters through our own public
`StatusBarItem.text` and `color` properties. It does not change the item's background,
chrome colors or appearance settings. Width is configurable from 8 to 48 characters;
it occupies status-bar width, not editor height. Clicking an unread outcome
acknowledges it; activity and attention signals link to Codex. A separate accessible
label avoids reading a run of blocks with a screen reader. Other states stay compact.

An optional bottom-panel webview owns its colors and symbols. It has a nonce
CSP, no network access, escaped labels and an allowlist of messages to its own
controller. It does not mutate themes, title bars, other extensions or private
runtime collections. It starts hidden, setup never opens it, and events do not
force it into view. The strip continues working with the panel closed. Users
control panel location/height and whether its tab remains selected.

Startup performs no migration. Recognized older proxy/hook/notify cleanup remains
available only through explicit legacy commands with a separate confirmation.
Unrelated user configuration is preserved. Existing 0.3 notifier configuration
is not made self-contained retroactively or silently removed.

Sources: [official hooks](https://learn.chatgpt.com/docs/hooks), matching snapshots
in [SOURCES.md](SOURCES.md), and [live feasibility](HOOK-FEASIBILITY.md).
