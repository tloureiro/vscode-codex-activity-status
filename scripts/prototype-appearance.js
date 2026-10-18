'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { runTests } = require('@vscode/test-electron');

(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;
  // macOS Unix sockets impose a short path limit on VS Code's profile socket.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwa-proto-'));
  const seed = {
    'statusBar.background': '#20252A',
    'statusBar.inactiveBackground': '#161C22',
    'titleBar.activeBackground': '#242A30',
    'titleBar.inactiveBackground': '#181E24',
    'editor.background': '#131719',
    '[Dark Modern]': {
      'statusBar.background': '#2A3036',
      'statusBar.inactiveBackground': '#1A2026',
      'titleBar.activeBackground': '#2C3238',
      'titleBar.inactiveBackground': '#1C2228',
    },
  };
  for (const folder of ['project-a', 'project-b']) {
    const settings = path.join(dir, folder, '.vscode');
    fs.mkdirSync(settings, { recursive: true });
    fs.writeFileSync(
      path.join(settings, 'settings.json'),
      JSON.stringify({ 'workbench.colorCustomizations': seed }),
    );
  }
  const user = path.join(dir, 'user', 'User');
  fs.mkdirSync(user, { recursive: true });
  fs.writeFileSync(
    path.join(user, 'settings.json'),
    JSON.stringify({
      'window.title': 'Appearance prototype ${folderName}',
      'window.titleBarStyle': 'custom',
      'workbench.colorTheme': 'Dark Modern',
    }),
  );
  fs.mkdirSync(path.join(dir, 'codex-home'));
  fs.mkdirSync(path.join(dir, 'extensions'));
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  console.log('Disposable appearance prototype: ' + dir);
  await runTests({
    vscodeExecutablePath: '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath: path.resolve('prototype/appearance'),
    extensionTestsPath: path.resolve('prototype/appearance/driver.js'),
    extensionTestsEnv: {
      ACTIVITY_PROTO_DIR: dir,
      ACTIVITY_CDP_PORT: String(port),
      CODEX_HOME: path.join(dir, 'codex-home'),
    },
    launchArgs: [
      path.join(dir, 'project-a'),
      '--user-data-dir=' + path.join(dir, 'user'),
      '--extensions-dir=' + path.join(dir, 'extensions'),
      '--remote-debugging-port=' + port,
      '--remote-debugging-address=127.0.0.1',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      '--disable-updates',
      '--disable-extension=github.copilot-chat',
      '--disable-extension=vscode.git',
      '--no-sandbox',
    ],
  });
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')));
  if (!result.passed) throw new Error('Prototype did not produce passing evidence');
  console.log(
    'Prototype passed: ' +
      result.renderedSamples.length +
      ' rendered checks. Shared settings independence: ' +
      result.sharedSettings.independent,
  );
  console.log('Evidence: ' + path.join(dir, 'result.json'));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
