'use strict';
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { connectRenderer } = require('../../test/renderer');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, label = 'condition') {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await pause(25);
  }
  throw new Error('Timed out: ' + label);
}
function write(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data));
  fs.renameSync(file + '.tmp', file);
}
function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function run() {
  const dir = process.env.ACTIVITY_PROTO_DIR;
  const shared = process.env.ACTIVITY_PROTO_SHARED === '1';
  const role = shared
    ? 'shared'
    : path.basename(vscode.workspace.workspaceFolders[0].uri.fsPath) === 'project-b'
      ? 'peer'
      : 'main';
  const api = await vscode.extensions
    .getExtension('local-prototype.appearance-prototype')
    .activate();
  const title =
    role === 'peer' ? 'Appearance prototype project-b' : 'Appearance prototype project-a';
  const renderer = await connectRenderer(title);
  const perform = async (method, params = {}) => {
    if (method === 'state') await api.set(params.state, params.surface || 'both');
    else if (method === 'focus') {
      await vscode.commands.executeCommand('workbench.action.focusWindow');
      await until(() => vscode.window.state.focused, 'local native focus');
    } else if (method === 'theme')
      await vscode.workspace
        .getConfiguration('workbench')
        .update('colorTheme', params.theme, vscode.ConfigurationTarget.Global);
    else if (method === 'screenshot') {
      if (path.basename(params.file) !== params.file)
        throw new Error('Fixture screenshot needs a simple filename');
      fs.writeFileSync(
        path.join(dir, params.file),
        Buffer.from(await renderer.screenshot(), 'base64'),
      );
    } else if (method !== 'snapshot' && method !== 'stop')
      throw new Error('Unknown fixture command');
    await api.settle();
    return { ...api.snapshot(), rendered: await renderer.appearance() };
  };
  if (role !== 'main') {
    write(path.join(dir, role + '-ready.json'), await perform('snapshot'));
    try {
      let previous;
      for (;;) {
        const request = read(path.join(dir, role + '-request.json'));
        if (request && request.id !== previous) {
          previous = request.id;
          try {
            write(path.join(dir, role + '-response.json'), {
              id: request.id,
              result: await perform(request.method, request.params),
            });
          } catch (error) {
            write(path.join(dir, role + '-response.json'), { id: request.id, error: error.stack });
          }
          if (request.method === 'stop') break;
        }
        await pause(25);
      }
    } finally {
      renderer.close();
    }
    return;
  }

  let requestId = 0;
  async function rpc(target, method, params) {
    const id = ++requestId;
    write(path.join(dir, target + '-request.json'), { id, method, params });
    let response;
    await until(
      () => {
        response = read(path.join(dir, target + '-response.json'));
        return response?.id === id;
      },
      target + ' ' + method,
    );
    if (response.error) throw new Error(response.error);
    return response.result;
  }
  const samples = [];
  async function expect(target, expected, label, state) {
    let snapshot;
    try {
      await until(
        async () => {
          snapshot = target === 'main' ? await perform('snapshot') : await rpc(target, 'snapshot');
          return Object.entries(expected).every(([key, value]) => snapshot.rendered[key] === value);
        },
        label + ': ' + JSON.stringify(expected),
      );
    } catch (error) {
      error.message +=
        '; observed ' + JSON.stringify({ state: snapshot?.state, rendered: snapshot?.rendered });
      throw error;
    }
    if (state) assert.equal(snapshot.state, state, label + ': activity state');
    samples.push({ label, window: target, state: snapshot.state, ...snapshot.rendered });
    return snapshot;
  }
  const rgb = (hex) =>
    'rgb(' +
    [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ') +
    ')';
  const active = (hex, focused) => ({ status: rgb(hex), title: rgb(hex), focused });
  const executable = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  function launch(folder, extension, userDir, extra = [], environment = {}) {
    const env = { ...process.env, ...environment };
    delete env.ELECTRON_RUN_AS_NODE;
    const log = fs.openSync(path.join(dir, path.basename(extension) + '.log'), 'a');
    const child = spawn(
      executable,
      [
        folder,
        '--new-window',
        '--user-data-dir=' + userDir,
        '--extensions-dir=' + path.join(dir, 'extensions'),
        '--extensionDevelopmentPath=' + extension,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-telemetry',
        '--disable-updates',
        '--disable-extension=github.copilot-chat',
        '--no-sandbox',
        ...extra,
      ],
      { env, stdio: ['ignore', log, log] },
    );
    fs.closeSync(log);
    child.unref();
    return child;
  }
  const source = path.resolve(__dirname);
  function copyExtension(name) {
    const target = path.join(dir, name);
    fs.mkdirSync(target);
    for (const file of ['package.json', 'extension.js'])
      fs.copyFileSync(path.join(source, file), path.join(target, file));
    return target;
  }
  let sharedProcess;
  try {
    launch(path.join(dir, 'project-b'), copyExtension('peer-extension'), path.join(dir, 'user'));
    await until(() => read(path.join(dir, 'peer-ready.json')), 'peer ready');
    for (const theme of ['Dark Modern', 'Light Modern']) {
      await perform('theme', { theme });
      await rpc('peer', 'theme', { theme });
      await perform('state', { state: 'idle' });
      await rpc('peer', 'state', { state: 'idle' });
      const dark = theme === 'Dark Modern';
      const aFocused = {
        status: rgb(dark ? '#2A3036' : '#20252A'),
        title: rgb(dark ? '#2C3238' : '#242A30'),
        focused: true,
      };
      const aUnfocused = {
        status: rgb(dark ? '#1A2026' : '#161C22'),
        title: rgb(dark ? '#1C2228' : '#181E24'),
        focused: false,
      };
      const bFocused = { ...aFocused },
        bUnfocused = { ...aUnfocused };
      await perform('focus');
      await expect('main', aFocused, `${theme}: custom active baseline`, 'idle');
      await expect('peer', bUnfocused, `${theme}: custom inactive baseline`, 'idle');
      await rpc('peer', 'focus');
      await until(() => !vscode.window.state.focused);
      await expect('main', aUnfocused, `${theme}: A inactive baseline`, 'idle');
      await expect('peer', bFocused, `${theme}: B active baseline`, 'idle');

      for (const [state, hex] of [
        ['processing', '#245A91'],
        ['approval', '#A66B16'],
      ]) {
        await perform('focus');
        await perform('state', { state });
        await expect('main', active(hex, true), `${theme}: ${state} focused`, state);
        await expect('peer', bUnfocused, `${theme}: B unaffected by A ${state}`, 'idle');
        await rpc('peer', 'focus');
        await until(() => !vscode.window.state.focused);
        await expect('main', active(hex, false), `${theme}: ${state} survives focus B`, state);
        await expect('peer', bFocused, `${theme}: B remains normal`, 'idle');
        await perform('focus');
        await expect(
          'main',
          active(hex, true),
          `${theme}: returning does not clear ${state}`,
          state,
        );
        await perform('state', { state: 'idle' });
        await expect('main', aFocused, `${theme}: restore ${state}`, 'idle');
      }

      await perform('state', { state: 'finished' });
      await expect(
        'main',
        active('#625B78', true),
        `${theme}: focused completion stays purple`,
        'finished',
      );
      await rpc('peer', 'focus');
      await until(() => !vscode.window.state.focused);
      await expect(
        'main',
        active('#625B78', false),
        `${theme}: B does not acknowledge A`,
        'finished',
      );
      await perform('focus');
      await expect('main', aFocused, `${theme}: return acknowledges A`, 'idle');

      await rpc('peer', 'focus');
      await until(() => !vscode.window.state.focused);
      await perform('state', { state: 'finished' });
      await expect(
        'main',
        active('#625B78', false),
        `${theme}: completion arrives unfocused`,
        'finished',
      );
      await rpc('peer', 'focus');
      await expect(
        'main',
        active('#625B78', false),
        `${theme}: repeated B focus preserves A`,
        'finished',
      );
      await perform('focus');
      await expect('main', aFocused, `${theme}: unfocused completion acknowledged`, 'idle');

      await perform('state', { state: 'approval' });
      await rpc('peer', 'state', { state: 'processing' });
      await expect('main', active('#A66B16', true), `${theme}: A amber independently`, 'approval');
      await expect(
        'peer',
        active('#245A91', false),
        `${theme}: B blue independently`,
        'processing',
      );
      await rpc('peer', 'focus');
      await rpc('peer', 'state', { state: 'finished' });
      await perform('focus');
      await expect(
        'main',
        active('#A66B16', true),
        `${theme}: A approval survives B completion`,
        'approval',
      );
      await expect(
        'peer',
        active('#625B78', false),
        `${theme}: B purple while A amber`,
        'finished',
      );
      if (theme === 'Dark Modern') {
        await perform('screenshot', { file: 'A-amber.png' });
        await rpc('peer', 'screenshot', { file: 'B-purple.png' });
      }
      await perform('state', { state: 'idle' });
      await rpc('peer', 'focus');
      await expect('peer', bFocused, `${theme}: B acknowledges only B`, 'idle');
      await expect('main', aUnfocused, `${theme}: A restored while B focused`, 'idle');
    }

    // Surface changes and user edits must restore the actual previous appearance.
    await perform('focus');
    const baseline = { status: rgb('#20252A'), title: rgb('#242A30'), focused: true };
    await expect('main', baseline, 'Custom baseline before changing surfaces', 'idle');
    await perform('state', { state: 'approval', surface: 'titleBar' });
    await expect(
      'main',
      { ...baseline, title: rgb('#A66B16') },
      'Title-only leaves status bar normal',
      'approval',
    );
    await perform('state', { state: 'processing', surface: 'statusBar' });
    await expect(
      'main',
      { ...baseline, status: rgb('#245A91') },
      'Status-only restores title bar',
      'processing',
    );
    const config = vscode.workspace.getConfiguration('workbench');
    const original = config.inspect('colorCustomizations').workspaceValue;
    await config.update(
      'colorCustomizations',
      { ...original, 'editorCursor.foreground': '#AABBCC' },
      vscode.ConfigurationTarget.Workspace,
    );
    await perform('state', { state: 'idle' });
    assert.equal(
      config.inspect('colorCustomizations').workspaceValue['editorCursor.foreground'],
      '#AABBCC',
    );
    await expect('main', baseline, 'Restoration preserves unrelated user edit', 'idle');

    // A second isolated profile permits the exact same folder in two windows.
    // Demonstrate the settings-scope limit rather than pretending it is per-window.
    const portFinder = net.createServer();
    await new Promise((resolve) => portFinder.listen(0, '127.0.0.1', resolve));
    const sharedPort = portFinder.address().port;
    await new Promise((resolve) => portFinder.close(resolve));
    const sharedUser = path.join(dir, 'shared-user', 'User');
    fs.mkdirSync(sharedUser, { recursive: true });
    fs.writeFileSync(
      path.join(sharedUser, 'settings.json'),
      JSON.stringify({
        'window.title': 'Appearance prototype ${folderName}',
        'window.titleBarStyle': 'custom',
        'workbench.colorTheme': 'Light Modern',
      }),
    );
    sharedProcess = launch(
      path.join(dir, 'project-a'),
      copyExtension('shared-extension'),
      path.join(dir, 'shared-user'),
      [
        '--extensionTestsPath=' + __filename,
        '--remote-debugging-port=' + sharedPort,
        '--remote-debugging-address=127.0.0.1',
      ],
      { ACTIVITY_PROTO_SHARED: '1', ACTIVITY_CDP_PORT: String(sharedPort) },
    );
    await until(() => read(path.join(dir, 'shared-ready.json')), 'shared settings window ready');
    assert.equal((await rpc('shared', 'snapshot')).file, api.snapshot().file);
    await perform('state', { state: 'processing' });
    await expect('main', active('#245A91', false), 'Shared settings: A blue', 'processing');
    await expect(
      'shared',
      active('#245A91', true),
      'Shared settings: idle C also becomes blue',
      'idle',
    );
    await perform('state', { state: 'idle' });
    const sharedResult = {
      independent: false,
      observed: 'Idle C displayed A activity because both read the exact same settings file.',
      profiles: 'Two disposable profiles, same folder/settings file',
    };
    write(path.join(dir, 'result.json'), {
      passed: true,
      vscode: vscode.version,
      importedProductionModules: false,
      codexUsed: false,
      themes: ['Dark Modern', 'Light Modern'],
      renderedSamples: samples,
      sharedSettings: sharedResult,
      untested: [
        'Native title-bar styling',
        'Physical OS mouse clicks',
        'Extension-host crash recovery',
        'Real Codex lifecycle integration',
      ],
    });
    await rpc('shared', 'stop');
    await rpc('peer', 'stop');
  } finally {
    await api.set('idle').catch(() => {});
    sharedProcess?.kill();
    renderer.close();
  }
}
module.exports = { run };
