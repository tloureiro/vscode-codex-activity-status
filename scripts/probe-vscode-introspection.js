'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const project = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'sources', 'manifest.json')));
  const root = fs.mkdtempSync(path.join('/private/tmp', 'codex-snapshot-vscode-'));
  const user = path.join(root, 'user');
  const workspace = path.join(root, 'project');
  const codexHome = path.join(root, 'codex-home');
  const extensions = path.join(root, 'extensions');
  for (const directory of [path.join(user, 'User'), workspace, codexHome, extensions])
    fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(user, 'User', 'settings.json'),
    JSON.stringify({
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
      'chatgpt.openOnStartup': false,
      'workbench.startupEditor': 'none',
      'git.enabled': false,
    }),
  );
  fs.writeFileSync(
    path.join(codexHome, 'config.toml'),
    'cli_auth_credentials_store = "file"\n[analytics]\nenabled = false\n',
  );
  const profile = path.join(root, 'isolation.sb');
  fs.writeFileSync(
    profile,
    `(version 1)
(allow default)
(deny file-write* (subpath ${JSON.stringify(os.homedir())}))
(allow file-write* (subpath ${JSON.stringify(root)}))
(deny file-write* (subpath "/Applications"))
(deny file-read* (subpath ${JSON.stringify(path.join(os.homedir(), '.codex'))}))
(deny network-outbound)
`,
  );
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(OPENAI|ANTHROPIC|AZURE_OPENAI|CODEX|CHATGPT)_/.test(key)) delete env[key];
  delete env.ELECTRON_RUN_AS_NODE;
  env.CODEX_HOME = codexHome;
  env.CODEX_SNAPSHOT_TEST_ROOT = root;
  const selectiveScopes = process.argv.includes('--selective-scopes');
  const rendererAccess = process.argv.includes('--renderer-access');
  env.CODEX_SNAPSHOT_SCOPE_MODE = selectiveScopes ? 'selective' : 'full';
  // runTests merges the parent environment, so remove inherited auth keys there too.
  for (const key of Object.keys(process.env))
    if (/^(OPENAI|ANTHROPIC|AZURE_OPENAI|CODEX|CHATGPT)_/.test(key)) env[key] ??= '';
  console.log(`Disposable research profile: ${root}`);
  const artifacts = path.join(project, 'sources', 'analysis');
  fs.mkdirSync(artifacts, { recursive: true });
  const log = fs.createWriteStream(path.join(root, 'launch.log'));
  try {
    await runTests({
      vscodeExecutablePath: '/usr/bin/sandbox-exec',
      extensionDevelopmentPath: [
        path.join(project, 'research', 'introspection'),
        manifest.codexExtension.installedPath,
      ],
      extensionTestsPath: path.join(
        project,
        'research',
        'introspection',
        rendererAccess ? 'renderer-suite.js' : 'suite.js',
      ),
      extensionTestsEnv: env,
      stdout: log,
      stderr: log,
      launchArgs: [
        '-f',
        profile,
        '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
        workspace,
        '--user-data-dir=' + user,
        '--extensions-dir=' + extensions,
        '--enable-proposed-api=openai.chatgpt',
        '--disable-extensions',
        '--disable-gpu',
        '--disable-telemetry',
        '--disable-crash-reporter',
      ],
    });
  } finally {
    log.end();
    const result = path.join(root, 'result.json');
    if (fs.existsSync(result)) {
      fs.copyFileSync(
        result,
        path.join(
          artifacts,
          rendererAccess
            ? 'vscode-renderer-access-gate.json'
            : selectiveScopes
              ? 'vscode-introspection-selective.json'
              : 'vscode-introspection-result.json',
        ),
      );
      console.log(fs.readFileSync(result, 'utf8'));
    }
    console.log(`Research artifacts retained in ${root}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
