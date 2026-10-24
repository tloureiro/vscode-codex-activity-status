# Study decision: close the full-status investigation

October 24, 2026. **No-go for implementing the full original feature set on the
inspected stack under the agreed containment rules. The study phase is closed.**

Subsequent user-authorized follow-up: [opt-in project-hook feasibility](HOOK-FEASIBILITY.md).
That separate experiment deliberately changes the configuration boundary; it does
not reverse this decision under the original strict rules.

The final feasibility gate began at 19:47:48 UTC, with a one-hour ceiling.
The completed diagnostic run finished at 19:50:55 UTC. The conclusion was
available well before the ceiling; no further alternative-route research is
scheduled. Documentation and verification followed the probe.

This is an engineering decision about the routes inspected and demonstrated,
not a mathematical claim that every possible private interface has been ruled
out.

## Required boundary

The user accepts maintaining version-specific introspection. The extension may
read existing data and keep its own observations/UI. It must not modify external
plugins, applications, services, private listener sets, executables, shared
rendering objects, or external configuration. Monitoring must not become a
prerequisite for Codex or VS Code to start or continue working.

The final gate excluded debugging ports, renderer script injection, debugger
attachment, internal subscriptions, transport interception, and configuration
changes outside the disposable test profile. The negative result is not a reason
to relax those constraints.

## Final probe result

The probe used unmodified installed Codex extension `26.1021.22027`, VS Code
`1.143.1`, and extension-host Node `24.21.0`. Exact source provenance and hashes
are recorded in [the prototype report](INTROSPECTION-PROTOTYPE.md) and ignored
`sources/manifest.json`.

It ran in a disposable unsigned-in profile with an empty Codex home. A sandbox
blocked outbound network access, personal Codex-home reads, and writes under the
user's home and `/Applications`. No model calls or personal credentials were
used. Opening the sidebar normally was a test-driver UI action, not a call
made by a production observer.

The bounded experiment:

1. Enumerated execution contexts visible to its own in-process inspector.
2. Inspected the already loaded Codex provider before opening its sidebar.
3. Opened the official sidebar in the disposable window and waited for its
   existing ready flag.
4. Found the real host-side webview through data descriptors, without invoking
   its `webview` getter.
5. Rechecked visible contexts and recorded wrapper property names and readiness
   metadata, without copying page contents.
6. Released inspector handles and verified that no inspector port was opened.

The official sidebar reported ready. Before and after opening it, the inspector
exposed one utility-process context with neither `window` nor `document`.
The host-side webview was found in private field `#o` on this build. Its own
public data properties were `_onMessageEmitter`, `onDidReceiveMessage`, and
`_onDidDispose`; no direct thread-store data field was found on that wrapper or
the inspected Codex provider.

The first attempt failed an assertion because it assumed the unminified
`#webview` name. Correcting the descriptor lookup produced a completed probe:
`probeCompleted: true`,
`gateDecision: "no-go-for-full-fidelity-under-current-boundary"`.
A completed diagnostic is not successful access to renderer state.

`Runtime.enable/disable` was used only on our own inspector session to enumerate
local contexts; its notification listener belongs to that session. No listener
was added to Codex, no target methods/getters were invoked by the reader, no
renderer scripts were injected, and no debugger was attached to the renderer.

## Why the inspected bridge does not solve access

The VS Code source matching this installation explains the runtime result:

- `sources/vscode/src/vs/workbench/api/common/extHostWebview.ts` retains HTML,
  options, and a proxy to the workbench. The host wrapper is not a reference to
  the renderer's JavaScript global object or heap.
- `MainThreadWebviewsShape` in
  `sources/vscode/src/vs/workbench/api/common/extHost.protocol.ts` provides
  `$setHtml`, `$setOptions`, and `$postMessage`, not a read-only renderer-state query.
- `sources/vscode/src/vs/platform/webview/common/webviewManagerService.ts`
  provides menu-shortcut and find-in-frame controls, not activity-state access.
- `sources/vscode/src/vs/workbench/contrib/webview/electron-browser/webviewElement.ts`
  implements the view as an iframe in the renderer.
- `sources/vscode/src/vs/workbench/contrib/webview/electron-browser/webviewCommands.ts`
  opens ordinary renderer developer tools. That command does not return a
  data-reading endpoint to a companion extension and was not used by the probe.

Earlier replay located richer Codex state in the webview's thread store:
`threadRuntimeStatus`, waiting flags, and explicit turn outcomes. That is data
in a different runtime. Finding its source does not make the live objects
reachable from the extension host's inspector. No existing compliant bridge to
those objects was demonstrated.

## Capability table

“Demonstrated” refers to the tested versions and stated scope, not all versions
or failure modes.

| Capability                                                   | Status under current boundary                  | Evidence / implication                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Read loaded Codex connection objects                         | Demonstrated                                   | Real isolated-profile introspection, without a startup proxy                                           |
| Inspect while the official sidebar is ready                  | Demonstrated                                   | Final gate reached the host-side wrapper without invoking its getter                                   |
| Efficient bounded host snapshots                             | Promising, partial                             | Selective mode median 8.14 ms in a small idle benchmark; loaded-editor limits unverified               |
| Candidate turn activity from host caches                     | Partial                                        | Cache-invalidation bookkeeping, not a complete lifecycle contract                                      |
| Definitive pending approval state                            | Unavailable through demonstrated reader        | Copied handler replay leaves stale IDs after server resolution/completion                              |
| Blocking question / needs-input state                        | Unavailable through demonstrated reader        | Inspected caches can be identical to running; richer state resides in renderer                         |
| Distinguish success/failure/cancellation from host snapshots | Unavailable through demonstrated reader        | Distinct canonical terminal outcomes collapse to the same inspected projection                         |
| Automatic exclusive attribution across windows               | Unverified                                     | Host-local access works; full task ownership/reconnect behavior was not tested                         |
| Read renderer thread-store without excluded mechanisms       | Not demonstrated; gate rejected                | Ready renderer stayed outside the local inspector and inspected bridge surfaces                        |
| Read persisted turn-start/terminal records                   | Feasible reduced scope                         | Source supports it; delayed/version-sensitive, with project/thread rather than proven window ownership |
| Own item text, icons, foreground colors, acknowledgement     | Available                                      | Public VS Code APIs; existing presentation tests cover foreground rendering                            |
| Colored tiles in an extension-owned view                     | Available UI option                            | Public webview API; does not supply missing signals                                                    |
| Original arbitrary title/full-status-bar backgrounds         | Excluded / unavailable through public item API | Would require external appearance changes or private rendering mutation                                |
| Full original per-window running/waiting/finished experience | No-go on evidence obtained                     | Reliable signals and compliant access/rendering were not demonstrated together                         |

## Implementation recommendation

Do not promote the introspection prototype into the production activity
indicator. Do not claim the host caches provide reliable working, needs-input,
or successful-completion state. Faster polling cannot restore data they do not
retain.

The recommended implementable scope from this study is explicitly smaller:
**self-contained project/thread completion history**, reading existing persisted
terminal records with a bounded version-aware reader. It could show observed
outcomes/timestamps, sticky unread completions, and explicit acknowledgement in
our own UI, without `notify`, hooks, executable overrides, or extra Codex processes.

It must describe project/thread observations, preserve distinct failure and
cancellation records when supplied, and show unknown for missing/unsupported
data. It must not invent waiting state, label an open turn as proven processing,
or imply exclusive ownership by one VS Code window. This reduced product has
not been implemented by the study.

If that smaller scope would not provide enough value, defer the full-status
feature instead of implementing another interception mechanism.

The installed `0.3.0` release still has its existing `notify` integration. This
study did not remove or migrate it and did not make the installed release
self-contained retroactively. Deliberate cleanup of that integration is separate
work.

## Reproduction and closure

```sh
npm run research:introspection -- --renderer-access
```

The launcher retains the disposable profile/launch log and copies the structured
result to ignored `sources/analysis/vscode-renderer-access-gate.json`. Research
code stays under `research/introspection/` and is excluded from VSIX packaging.
The command exists for reproducibility, not as an automatic recurring study.

Reopen only for a concrete new interface/version change or an explicit user
request. Do not automatically add speculative experiments, architecture branches,
or model-task trials to this completed study.
