# Validation

```sh
npm run validate
npm run test:vscode
npm run package
```

Local validation covers syntax, formatting, lint, public-file hygiene, no private
interception or appearance mutation, setup consent/cancellation, ownership and
preservation of external files, shell quoting, metadata-only output, missing
receivers/helpers, stale and out-of-order events, terminal confirmation and
distinct failed/interrupted outcomes, persisted acknowledgement, and webview
escaping/recreation. Legacy cleanup regressions remain covered.

The public-file check uses the user's read-only `git-safe` wrapper by default;
`GIT_READ_ONLY_BIN` can select another approved read-only wrapper. No Git writes
are part of validation, source updates or packaging.

The real VS Code test requires the local installed-reference manifest. It installs
the production helper only in a disposable project and trusts only those exact
definitions via a public RPC in an empty disposable Codex home. Both its runtime
and IDE phases are sandboxed against personal Codex-home reads, home/application
writes and non-localhost outbound network. It uses a deterministic local Responses
fixture and no personal credentials or real model requests.

The live test keeps the detail panel closed and exercises the actual status-bar
item's text/color through blue activity, purple
confirmed completion, distinct failure, helper absence/recovery and an amber
approval candidate. It then opens the optional detail view on explicit request.
It does not answer the final synthetic approval; disposing
the test profile ends that pending turn. Artifacts include the result and launch
log in the reported disposable directory.

Mission Control recognition at the user's preferred window count/thumbnail size
still needs a manual check: the strip has the existing bar's fixed height and can
become thin at small thumbnail sizes. Do not claim exact waiting state or exclusive
window ownership from these tests.
