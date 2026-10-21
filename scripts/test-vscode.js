'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-completion-vscode-'));
  const project = path.join(root, 'project');
  const user = path.join(root, 'user');
  const extensions = path.join(root, 'extensions');
  const codexHome = path.join(root, 'codex-home');
  for (const directory of [project, path.join(user, 'User'), extensions, codexHome])
    fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(user, 'User', 'settings.json'), '{}');
  try {
    await runTests({
      vscodeExecutablePath: '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
      extensionDevelopmentPath: path.resolve('.'),
      extensionTestsPath: path.resolve('test/vscode-smoke.js'),
      extensionTestsEnv: {
        CODEX_COMPLETION_TEST_DIR: root,
        CODEX_HOME: codexHome,
      },
      launchArgs: [
        project,
        '--user-data-dir=' + user,
        '--extensions-dir=' + extensions,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        '--disable-updates',
        '--disable-gpu',
        '--no-sandbox',
      ],
    });
    const result = JSON.parse(fs.readFileSync(path.join(root, 'result.json')));
    if (!result.passed) throw new Error('Extension-host smoke did not pass');
    console.log('Real VS Code extension-host smoke passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
