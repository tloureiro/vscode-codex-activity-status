# Validation

Run the complete local validation suite:

```sh
npm run validate
```

It covers:

- syntax, lint, formatting, and public-file hygiene;
- an architecture boundary that excludes interception, private status colors, workspace overlays, and production dependencies;
- owned `notify` block installation/removal and custom-notify protection;
- restoration of the former executable setting and deletion of its proxy;
- selective TOML and JSON legacy-hook cleanup;
- privacy-minimized notifier output and workspace routing;
- completion acknowledgement behavior; and
- public status-item rendering.

`npm run test:vscode` launches a disposable VS Code profile and empty Codex home to verify extension activation. It does not read personal Codex configuration, authentication, or chats.

Manual release checks should also confirm that setup and removal work in an installed profile, a newly completed Codex turn reaches the matching workspace, a custom `notify` command is not changed, and restarting VS Code does not resurrect an old completion.
