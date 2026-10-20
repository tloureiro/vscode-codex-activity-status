'use strict';
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { runTests } = require('@vscode/test-electron');
const { bridgePlan } = require('../src/setup');
const net = require('node:net');
(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-activity-vscode-'));
  // Ordinary project/workspace windows in a disposable profile; never touch
  // the user's projects, profile settings, Codex configuration, or credentials.
  const storage = path.join(
    dir,
    'user',
    'User',
    'globalStorage',
    'tloureiro.codex-activity-status',
  );
  fs.mkdirSync(storage, { recursive: true });
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  const setupTest = process.env.ACTIVITY_SETUP === '1';
  let debuggerPort;
  if (!setupTest) {
    const portFinder = net.createServer();
    await new Promise((resolve) => portFinder.listen(0, '127.0.0.1', resolve));
    debuggerPort = portFinder.address().port;
    await new Promise((resolve) => portFinder.close(resolve));
  }
  const workspace = path.join(dir, 'test.code-workspace');
  fs.writeFileSync(
    workspace,
    JSON.stringify({
      folders: [{ path: project }],
      settings: {
        'window.titleBarStyle': 'custom',
      },
    }),
  );
  if (process.env.ACTIVITY_MIGRATION === '1') {
    const { overlay, palette } = require('../src/appearance');
    const data = JSON.parse(fs.readFileSync(workspace, 'utf8'));
    const base = { 'statusBar.background': '#112233', 'editor.background': '#202122' };
    const applied = overlay(base, palette('finished', { surface: 'both' }));
    data.settings['workbench.colorCustomizations'] = applied.colors;
    fs.writeFileSync(workspace, JSON.stringify(data));
    fs.writeFileSync(workspace + '.appearance.json', JSON.stringify(applied.journal));
  }
  const userSettings = {
    'window.title': 'Activity renderer main',
    'workbench.colorTheme': 'Dark Modern',
  };
  fs.writeFileSync(path.join(dir, 'user', 'User', 'settings.json'), JSON.stringify(userSettings));
  let officialVersion = null;
  if (process.env.ACTIVITY_WITH_OFFICIAL === '1' || setupTest) {
    const installed = path.join(os.homedir(), '.vscode', 'extensions');
    const candidates = fs
      .readdirSync(installed)
      .filter((n) => n.startsWith('openai.chatgpt-') && n.endsWith('darwin-arm64'))
      .sort();
    if (!candidates.length) throw new Error('No local official Codex extension found');
    const name = candidates.at(-1),
      official = path.join(installed, name);
    const extensions = path.join(dir, 'extensions');
    fs.mkdirSync(extensions, { recursive: true });
    fs.symlinkSync(official, path.join(extensions, name));
    officialVersion = JSON.parse(fs.readFileSync(path.join(official, 'package.json'))).version;
    const settings = { ...userSettings, 'chatgpt.openOnStartup': false };
    if (!setupTest) {
      const runtime =
        '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)';
      const plan = bridgePlan(
        { globalStorageUri: { fsPath: storage }, extensionPath: path.resolve('.') },
        { extensionPath: path.join(extensions, name) },
        runtime,
      );
      fs.writeFileSync(plan.launcher, plan.script, { mode: 0o700 });
      settings['chatgpt.cliExecutable'] = plan.launcher;
    }
    fs.writeFileSync(path.join(dir, 'user', 'User', 'settings.json'), JSON.stringify(settings));
    fs.mkdirSync(path.join(dir, 'codex-home'), { recursive: true });
    // The child receives this only; no personal Codex auth/config/history is used.
  }
  try {
    const options = {
      vscodeExecutablePath: '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
      extensionDevelopmentPath: path.resolve('.'),
      extensionTestsPath: path.resolve(
        setupTest
          ? 'test/vscode-setup.js'
          : process.env.ACTIVITY_MULTI_WINDOW === '1'
            ? 'test/vscode-multi.js'
            : 'test/vscode-smoke.js',
      ),
      extensionTestsEnv: {
        ACTIVITY_TEST_DIR: dir,
        ACTIVITY_CDP_PORT: debuggerPort ? String(debuggerPort) : '',
        ACTIVITY_OFFICIAL_VERSION: officialVersion || '',
        CODEX_HOME: path.join(dir, 'codex-home'),
      },
      launchArgs: [
        ...(process.env.ACTIVITY_EMPTY === '1'
          ? []
          : [setupTest || process.env.ACTIVITY_FOLDER === '1' ? project : workspace]),
        '--user-data-dir=' + path.join(dir, 'user'),
        '--extensions-dir=' + path.join(dir, 'extensions'),
        ...(debuggerPort
          ? ['--remote-debugging-port=' + debuggerPort, '--remote-debugging-address=127.0.0.1']
          : []),
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        '--disable-updates',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-extension=github.copilot-chat',
        '--disable-extension=vscode.git',
        '--disable-extension=vscode.github-authentication',
      ],
    };
    try {
      await runTests(options);
    } catch (error) {
      // VS Code closes its CLI test runner when Reload Window is invoked.
      // Finish recovery checks in a second host using the same profile/folder.
      const reloadMarker = path.join(dir, 'setup-reload-requested');
      if (!setupTest || !fs.existsSync(reloadMarker) || error.code !== 1) throw error;
      await runTests(options);
    }
    const resultFile = path.join(
      dir,
      setupTest
        ? 'setup-result.json'
        : process.env.ACTIVITY_MULTI_WINDOW === '1'
          ? 'multi-result.json'
          : 'result.json',
    );
    if (!fs.existsSync(resultFile))
      throw new Error('Test runner exited without required result evidence: ' + dir);
    const result = JSON.parse(fs.readFileSync(resultFile));
    if (!result.passed) throw new Error('Test evidence did not pass');
    console.log('Real VS Code extension-host smoke passed; evidence: ' + dir);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
})();
