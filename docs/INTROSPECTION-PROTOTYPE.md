# Snapshot-only introspection prototype

October 24, 2026. Research only: the installed activity extension and its
production integration have not been changed.

Study status: **closed**. The final renderer-access gate and implementation
decision are in [STUDY-DECISION.md](STUDY-DECISION.md). That conclusion supersedes
earlier next-experiment suggestions below.

## Result

Read-only private introspection works against the actual installed Codex
extension in a disposable VS Code profile. The probe reached the existing
connection through retained closures, observed normal app-server initialization,
and read existing collections without invoking target getters/methods or adding
listeners.

This establishes access to real objects, not complete activity tracking. The
real application was tested only at startup/idle, with no sign-in or model
requests. Nonempty running/approval/completion snapshots were exercised in an
owned synthetic fixture, separately from the real extension.

| Component                | Tested version                                                     |
| ------------------------ | ------------------------------------------------------------------ |
| VS Code                  | `1.143.1`                                                          |
| Extension-host Node      | `24.21.0`                                                          |
| Official Codex extension | `26.1021.22027`                                                    |
| Extension bundle SHA-256 | `a9cc6736cd2c2d22f6cf43fc5763d5f8a873e4f741f522b44a600b1926f4e627` |

The initial real run took 32.18–48.23 ms per snapshot, including repeated closure
discovery. A subsequent descriptor-projection mode reduced total median read time
to 8.14 ms in a ten-sample idle benchmark; see the follow-up below. Each mode found
seven existing providers and one existing internal notification handler.
Initialization changed from false to true during sampling. No inspector port was
present before or after inspection. These are startup/idle observations, not a
loaded-editor benchmark.

## Mechanism and boundaries

The research reader inspects the already cached CommonJS module. It walks
export-getter scope descriptors without invoking those getters, finds retained
cleanup function `DX`, then finds connection `v` in its activation context.
It locates the chat-session provider through the existing bound callback's
`[[BoundThis]]`; the temporary activation variable `S` was not reachable through
the first attempted scope path.

In the original full-descriptor mode, the inspector operation allowlist contains only `Runtime.evaluate` for the
fixed module-cache expression, `Runtime.getProperties` for descriptors, and
`Runtime.releaseObjectGroup`. No `Runtime.callFunctionOn`, Debugger operations,
heap queries, RPCs, listener registrations, or transport access are used. The
reader rejects unexpected versions/hashes, limits collection sizes and protocol
calls, checks elapsed time between calls, releases remote objects, and
disconnects after every read. The later optional selective mode also permits one
fixed descriptor-projection expression through `Runtime.callFunctionOn`, with
V8 side-effect rejection enabled; it invokes no Codex methods or getters.

The elapsed-time check cannot preempt a single slow inspector operation. This
prototype therefore does not yet establish a production responsiveness bound.
It also temporarily retains inspected objects and allocates descriptor data;
inspection is not free of runtime effects.

The launcher creates an empty user-data profile, workspace, extensions directory,
and Codex home. It loads the unmodified official extension as a development
extension and starts it normally. Its sandbox blocks writes under the user's
home and `/Applications`, reads of the personal Codex home, and outbound network
access. Inherited Codex/OpenAI authentication variables are removed or blanked.
The fixture disables Git integration and uses file-based credentials in its
empty Codex home.

The official extension and VS Code attempted unrelated writes during startup:
a desktop-pairing registration and `argv.json`, respectively. The sandbox
denied them; these denials appear in the disposable launch log. The probe still
passed. They demonstrate why a disposable user-data directory alone was not a
sufficient isolation boundary for this test.

## What the existing state can and cannot tell us

| Existing object                                   | Available observation                                   | Limitation                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Connection `initialized`                          | Connection has initialized                              | Does not establish thread activity                                                           |
| `turnCwds.startedByTurnId`                        | Started turns retained for cache invalidation           | Must validate lifecycle/cancellation/reconnect coverage in real use                          |
| `turnCwds.pendingByStartId`                       | Pending turn-start requests                             | A pending request is not proof that work started                                             |
| `turnCwds.approvalThreadIdByRequestId`            | Approval request IDs associated with threads            | Not an authoritative waiting flag; some server-side resolution paths may leave stale entries |
| Chat-session provider `lifecycleByConversationId` | Retained started/completed/failed status and timestamps | No needs-input state; real event coverage not yet exercised                                  |
| Auto-resolution coordinator                       | Some questions eligible for automatic resolution        | Explicitly excludes blocking user-input requests                                             |

The newly identified turn/approval cache belongs to `turnCwds`, which is enabled
by the installed connection. Its implementation is in derived source
`sources/analysis/extension-host.pretty.js` around lines 64344–64480. It removes
approval entries on client responses and thread cleanup; a map entry must not
automatically be treated as a currently blocking approval.

The auto-resolution coordinator's `observeServerRequest` explicitly removes
blocking `item/tool/requestUserInput` requests from its tracking map. This is an
important negative result: a nonempty/empty question map cannot supply the
original needs-input state. That state may live only in the webview renderer,
which is a different runtime from the inspected extension host.

An active-turn entry disappearing also does not, by itself, prove success.
Completion needs a retained terminal outcome and identity; failures, cancellation,
connection loss, and missed transitions must remain distinct. Sampling can miss
a complete short turn between reads.

## Reproducing the research

```sh
npm run sources:update
npm run research:introspection
npm run research:introspection -- --selective-scopes
npm run research:source-replay
node --test test/introspection.test.js
```

The desktop command needs macOS GUI/process permission. It uses `sandbox-exec`
and an installed VS Code app; it never installs or updates an extension.
If the sandbox or version pin is unavailable, stop rather than relaxing isolation
or falling back to personal configuration. The application files remain in
their installed location and are loaded unchanged.

Latest real results are kept in ignored
`sources/analysis/vscode-introspection-result.json`. Each run also prints the
location of its retained disposable profile and `launch.log`. No conversation
content is copied into the result. The implementation is under
`research/introspection/`, the launcher is `scripts/probe-vscode-introspection.js`,
and both are excluded from VSIX packaging.

The synthetic tests verify nonempty map decoding, running/approval/finished
snapshots, no getter invocation or target mutation, listener-count preservation,
unknown version/hash rejection, prohibited operation rejection, and recovery
after a collection-size limit failure. They do not simulate a real model run.
They also reject concurrent reads and verify that the selective reader rejects
arbitrary function expressions and leaves the fixture state/getter counters unchanged.

## Decision after the prototype

Keep this as a separate research adapter. Do not enable it in the user's existing
windows or advertise complete activity tracking yet. Private reads can reach
useful window-local state, so an upstream API is not a prerequisite for every
improvement. However, complete blocking-input coverage, reliable terminal
outcomes, real active-turn behavior, and acceptable polling overhead remain
unproven.

Further work must stay snapshot-only. No missing field or missed transition is
permission to register an internal listener or intercept a connection. The
currently demonstrated result is an actual, version-pinned read-only connection
probe, with partial candidate activity caches.

## Follow-up: copied source replay identifies information loss

`npm run research:source-replay` now extracts the actual tracker class and
relevant connection, lifecycle-provider, and question-coordinator methods from
the pinned compiled host bundle using Acorn. It runs those definitions in an
owned VM fixture with controlled payloads. The original reference files and
installed/running extensions are not changed. The full extension is not executed
in the replay.

The harness records exact definitions separately from fixture dependencies. The
turn-shape validator, provider/collection containers, and cache-invalidation
callback environment are supplied by the fixture. Thus these are targeted
handler replays, not end-to-end agent runs or a proof covering every object in
the extension host.

Four checks passed:

1. After `item/tool/requestUserInput` with `isBlocking=true` and a
   `thread/status/changed` waiting-on-user-input notification, the inspected
   retained projection is identical to ordinary running. The blocking request
   is not retained by the auto-resolution coordinator, and the host tracker
   does not retain thread runtime status.
2. `serverRequest/resolved` leaves an approval entry in the cache. A following
   `turn/completed` removes its active-turn entry but still leaves the approval
   entry. The client-response path does remove it. Therefore this map cannot
   be used as an authoritative pending-approval set.
3. Canonical v2 `turn/completed` notifications with `completed`, `failed`, or
   `interrupted` outcomes produce the same inspected retained projection. The
   legacy lifecycle provider does not update from these messages. The pinned
   app-server emits these canonical outcomes; its
   `bespoke_event_handling.rs` defines the distinct completed/failed/interrupted
   paths.
4. Even with legacy messages, an error followed by `task_complete` leaves the
   provider's coarse lifecycle status as completed. It is not a trustworthy
   retained terminal-error receipt.

These are losses of information, not merely a polling-frequency problem. Do
not map cache disappearance to success or a retained approval ID to needs input.
The ignored result is `sources/analysis/source-replay-result.json`.

## Follow-up: richer state is retained in the webview runtime

Inspection of the installed webview asset `src-622b307a9baf.js` found the `Dd`
thread store and its `conversations` map. The `Dh` handler copies canonical
`thread/status/changed` payloads into a conversation's `threadRuntimeStatus`.
Its turn-completion path also retains the actual turn status/error.

The replay extracts the exact `Dh` function from that asset and confirms that it
retains active, waiting-on-user-input, waiting-on-approval, idle, system-error,
and not-loaded statuses. The fixture supplies only thread-ID conversion and
owned conversation/store-update functions for this branch. This locates a better
data source; it does not prove live read access to that source.

The asset SHA-256 is
`e4a82a9ee669473490d25c1f2b6f7b60abc4a1b193acb1f9c0a92e074dc81eb5`.
Derived inspection copies are in ignored `sources/analysis/`; the updater's
host-only extension snapshot still omits webview assets. The replay reads and
hash-checks this exact asset directly from the installation recorded in the
manifest, and refuses a changed file.

The current Node inspector session belongs to the extension-host runtime.
VS Code's `ExtHostWebview` retains HTML/options and an RPC proxy, not the live
renderer JavaScript heap. `ElectronWebviewElement` implements the view as an
iframe in the renderer. Following a host-side webview object therefore does not
establish access to this thread store. No suitable existing renderer-read channel
has been demonstrated. Opening a debugging port, injecting renderer scripts,
or adding an internal listener is not an approved fallback.

## Follow-up: selective descriptors reduce measured overhead

The first reader enumerates a large module scope. Yielding between requests
helps scheduling, but the next measurement still showed heartbeat delays above
30 ms during individual reads. An optional `--selective-scopes` mode instead
uses a fixed function on inspector-created scope wrappers. It reads only the
`DX`, `v`, and `e` data descriptors via `Object.getOwnPropertyDescriptor` and
returns a newly allocated projection. It neither invokes target getters/methods
nor writes target properties. The function is exact-string allowlisted, accepts
no dynamic arguments, and sets `throwOnSideEffect: true` for V8 rejection of
effects. Arbitrary `Runtime.callFunctionOn` expressions remain rejected.

The following measurements are small, separate disposable-profile idle runs;
they are not a controlled loaded-editor performance guarantee:

| Measurement                          | Full descriptors with yielding | Selective descriptors with yielding |
| ------------------------------------ | ------------------------------ | ----------------------------------- |
| Snapshot total, median               | 39.64 ms                       | 8.14 ms                             |
| Snapshot total, maximum of 10        | 42.20 ms                       | 14.48 ms                            |
| 5 ms heartbeat excess delay, p95     | 26.77 ms                       | 1.20 ms                             |
| 5 ms heartbeat excess delay, maximum | 32.76 ms                       | 3.56 ms                             |

The selective run again observed ordinary initialization, unchanged provider/
listener counts, and no inspector port. Results are in
`sources/analysis/vscode-introspection-selective.json`. The full-descriptor
benchmark remains in `sources/analysis/vscode-introspection-result.json`;
the earlier non-yielding baseline is retained as
`sources/analysis/vscode-introspection-before-yield.json`.

Reads now yield, so the target can change between descriptor reads. These are
non-atomic observations. Any future adapter needs consistency/generation checks
and must discard uncertain combinations, rather than claim a coherent snapshot
merely because all reads succeeded. A single inspector call is still not
preemptible by the JavaScript elapsed-time guard.

## Current decision

The access and performance experiments made progress, but the inspected
extension-host caches have demonstrated fidelity gaps. Do not turn this reader
into an authoritative status indicator. The final renderer-access experiment
has now completed without demonstrating a compliant path; see the
[closed-study decision](STUDY-DECISION.md). Further polling of the same host
caches cannot restore the missing information.

Actual signed-in task transitions, multiple-window ownership, reload/reconnect
behavior, and loaded-editor performance remain unverified. All real VS Code
runs so far used the empty Codex home and blocked outbound network access; no
personal credentials or model requests were used. The production extension
remains unchanged.
