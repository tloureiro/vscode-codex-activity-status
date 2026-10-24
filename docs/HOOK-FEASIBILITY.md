# Opt-in project hooks: feasibility result

October 24, 2026. **Go for an opt-in project/thread activity implementation.**
The installed IDE runs project hooks. Tested observer failures did not prevent
turns from completing. This does not certify every failure mode, the full original
per-window experience, or zero runtime overhead. No production integration changed.

The user explicitly proposed consented, ignored project hooks after the earlier
strict-boundary study closed. This is a supported external integration: Codex
intentionally launches our helper. It requires configuration and hook trust, so
it relaxes the earlier configuration-free meaning of self-contained.

## Test environment

VS Code 1.143.1, installed official extension 26.1021.22027, bundled Codex
0.164.0-alpha.11.1. Provenance is recorded in `sources/manifest.json`.

Fresh project, Codex home, VS Code user-data and extension directories under
`/private/tmp`; deterministic localhost Responses fixture, no real model requests
or personal credentials. Installed applications were used unchanged. There was
no executable override, proxy, private listener registration, inspector, renderer
injection or persistent service.

The final runtime and IDE phases both use a macOS sandbox denying network access
except localhost, writes under the user's home and `/Applications`, and reads of
personal `~/.codex`. Earlier runtime-only trials had outbound networking enabled;
Codex attempted its normal featured-plugin cache warmup into the disposable home.
The final probe also isolates that phase. The local fixture server exists only
for the duration of the experiment.

The IDE driver invokes the existing `chatgpt.implementTodo` command with synthetic
text. Completion during receiver failures is checked independently against real
persisted `task_complete` records. No private Codex methods are called.

## Evidence

| Check                                               | Result                                                            | Scope                          |
| --------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| Discover project hooks                              | Seven declarations listed as untrusted                            | Bundled runtime                |
| Trust exact declarations                            | Public config RPC, disposable Codex home, no bypass               | Bundled runtime                |
| Session start, prompt submission, stop              | Delivered with session/turn identifiers                           | Actual IDE and bundled runtime |
| Receiver directory absent                           | Turn completed                                                    | Actual IDE and bundled runtime |
| Helper file missing                                 | Turn completed                                                    | Actual IDE and bundled runtime |
| Helper hangs for 10 seconds; async timeout 1 second | Turn completed without waiting for helper                         | Actual IDE and bundled runtime |
| Restore helper                                      | Subsequent turn completed                                         | Actual IDE and bundled runtime |
| Approval request                                    | Hook delivered while independent approval request was pending     | Bundled runtime                |
| Cancellation                                        | Interrupt hook delivered; independent terminal status interrupted | Bundled runtime                |
| Blocking question                                   | Tool hooks before and after answering                             | Bundled runtime, plan mode     |

The approval driver declined a synthetic command; our observer made no approval
decision. The question driver independently verified `isBlocking: true`, then
answered a synthetic question. Richer approval/question/cancellation events were
tested through the same bundled runtime, not IDE UI interaction.

The report in ignored `sources/analysis/hook-feasibility-result.json` records the
latest disposable root, versions and outcomes. Eight bundled-runtime scenarios
and four actual-IDE failure/recovery scenarios supplement normal IDE delivery.
Small fixture latencies are not a production overhead benchmark.

## Architecture supported by this result

Offer installation per project, explaining exact file/configuration changes.
Ignore the installed helper and newly created hook file by default. Preserve
existing hooks and do not silently edit a tracked hook file. Ignore rules cannot
untrack existing files and are not security controls. No Git metadata changed here.

Use short asynchronous hooks and an independently runnable helper. The prototype
uses the local Node executable; product packaging must explicitly provide or
check its runtime rather than depend on the VS Code receiver being alive.

The helper reads stdin, copies only event/session/turn/cwd/tool metadata into
private local files with atomic publication, and returns no stdout or decisions.
Missing receiver storage, parse errors and write errors exit without failure.
The research helper drops inputs above 128 KiB and exits after 500 ms waiting for
input, so oversized payloads remain a known event-loss case. Product storage needs
ownership checks and bounded retention. The receiver watches its own storage and
owns its UI; no server or synchronous acknowledgement is needed.

## Limits and consent boundary

- **Hook trust is separate from installation.** The probe trusted only exact
  definitions via public `config/batchWrite` in its disposable home. Production
  must obtain explicit consent or use Codex's own review UI. The installed IDE
  includes hook listing and trust-update UI code; clicking those controls was
  not automated. Its normal trust updater writes `hooks.state` in the user's
  Codex configuration, even for project hooks. Trust is for the declaration;
  it is not a promise that script contents are immutable.
- **Events do not provide a complete authoritative state stream.** A submitted
  prompt can be rejected by another hook. Another hook can resolve an approval.
  Another stop hook can request continuation. Confirm final outcomes with existing
  persisted terminal records rather than treating Stop as definitive success.
- **Questions lack a blocking flag in hook input.** The test driver had that flag
  through its own client. Production only sees tool boundaries, which may also
  surround nonblocking or invalid requests. Do not label all question-tool calls
  as proven waiting for the user.
- **Async delivery can race or disappear.** Hooks may finish out of order, queue,
  or be cancelled on session end. Tolerate duplicates, gaps and late events;
  receipt timestamps are not causal ordering. Failed commands may still produce
  Codex diagnostics. This is not literally free of effects.
- **Project is not window identity.** Session and turn IDs distinguish chats;
  cwd cannot distinguish two windows on the same project. Initially present
  project/thread activity or require explicit association.
- **Rendering limits persist.** Use public extension-owned UI. Arbitrary existing
  title/status-bar backgrounds still require excluded appearance changes.

Supported behavior and background-hook limitations are documented in
[official OpenAI hook documentation](https://learn.chatgpt.com/docs/hooks).
The go decision also depends on the live results above, not documentation alone.

## Reproduction and closure

```sh
npm run research:hooks
```

Requires macOS, the pinned installed applications, and permission to launch a
disposable GUI and listen on localhost. Artifacts remain in the reported disposable
root and ignored analysis folder. The command fails if runtime or IDE gates fail.
Research files are excluded from the VSIX. It does not modify normal configuration
or install anything in real projects. No further open-ended study is scheduled.

Next work can implement the consented installer and project/thread indicator with
these limits. This prototype is not installed in any normal workspace.
