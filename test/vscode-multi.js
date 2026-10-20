'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { runtimeRoot } = require('../src/bridge');
const { query } = require('../src/diagnostics');
const { connectRenderer } = require('./renderer');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn) {
  for (let i = 0; i < 400; i++) {
    if (await fn()) return;
    await pause(50);
  }
  throw new Error('Timed out waiting for multi-window peer');
}
// Loaded only by a copied fixture extension in a separate disposable profile.
async function runPeer(api, dir) {
  fs.writeFileSync(path.join(dir, 'peer-ready.json'), JSON.stringify({ host: api.host }));
  let previous = 0;
  while (!fs.existsSync(path.join(dir, 'multi-done'))) {
    const commandFile = path.join(dir, 'peer-command.json');
    if (fs.existsSync(commandFile)) {
      const { sequence, command } = JSON.parse(fs.readFileSync(commandFile));
      if (sequence !== previous) {
        await vscode.commands.executeCommand(command);
        previous = sequence;
        fs.writeFileSync(path.join(dir, 'peer-response'), String(sequence));
      }
    }
    await pause(40);
  }
}
async function connect(host) {
  const registry = JSON.parse(fs.readFileSync(path.join(runtimeRoot(), host + '.json')));
  const socket = net.createConnection(registry.socketPath);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write(JSON.stringify({ token: registry.token, parent: host }) + '\n');
  return { registry, socket, emit: (event) => socket.write(JSON.stringify({ event }) + '\n') };
}
async function run() {
  const dir = process.env.ACTIVITY_TEST_DIR;
  const api = await vscode.extensions.getExtension('tloureiro.codex-activity-status').activate();
  const main = await connect(api.host);
  const renderer = await connectRenderer('Activity renderer main');
  const original = fs.readFileSync(vscode.workspace.workspaceFile.fsPath, 'utf8');
  const peerExtension = path.join(dir, 'peer-extension');
  fs.mkdirSync(peerExtension);
  fs.copyFileSync(
    path.resolve(__dirname, '../package.json'),
    path.join(peerExtension, 'package.json'),
  );
  fs.cpSync(path.resolve(__dirname, '../src'), path.join(peerExtension, 'src'), {
    recursive: true,
  });
  fs.symlinkSync(
    path.resolve(__dirname, '../node_modules'),
    path.join(peerExtension, 'node_modules'),
  );
  fs.appendFileSync(
    path.join(peerExtension, 'src/extension.js'),
    `\nconst fixtureActivate = module.exports.activate;\nmodule.exports.activate = async context => {\n const api = await fixtureActivate(context);\n require(${JSON.stringify(__filename)}).runPeer(api, ${JSON.stringify(dir)}).catch(e => require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'peer-error'))}, e.stack));\n return api;\n};\n`,
  );
  const peerUser = path.join(dir, 'peer-user');
  fs.mkdirSync(path.join(peerUser, 'User'), { recursive: true });
  fs.writeFileSync(
    path.join(peerUser, 'User/settings.json'),
    JSON.stringify({
      'window.title': 'Activity renderer peer',
      'workbench.colorTheme': 'Dark Modern',
    }),
  );
  const finder = net.createServer();
  await new Promise((r) => finder.listen(0, '127.0.0.1', r));
  const port = finder.address().port;
  await new Promise((r) => finder.close(r));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Open the exact same project's settings file in both profiles.
  const project = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const log = fs.openSync(path.join(dir, 'peer.log'), 'a');
  const child = spawn(
    '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    [
      vscode.workspace.workspaceFile.fsPath,
      '--user-data-dir=' + peerUser,
      '--extensions-dir=' + path.join(dir, 'peer-extensions'),
      '--extensionDevelopmentPath=' + peerExtension,
      '--remote-debugging-port=' + port,
      '--remote-debugging-address=127.0.0.1',
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
    { env, stdio: ['ignore', log, log] },
  );
  fs.closeSync(log);
  let peer,
    peerRenderer,
    sequence = 0;
  const checks = [];
  try {
    await waitFor(() => {
      if (fs.existsSync(path.join(dir, 'peer-error')))
        throw new Error(fs.readFileSync(path.join(dir, 'peer-error'), 'utf8'));
      return fs.existsSync(path.join(dir, 'peer-ready.json'));
    });
    const host = JSON.parse(fs.readFileSync(path.join(dir, 'peer-ready.json'))).host;
    peer = await connect(host);
    peerRenderer = await connectRenderer('Activity renderer peer', port);
    const commandPeer = async (command) => {
      fs.writeFileSync(
        path.join(dir, 'peer-command.json'),
        JSON.stringify({ sequence: ++sequence, command }),
      );
      await waitFor(
        () =>
          fs.existsSync(path.join(dir, 'peer-response')) &&
          fs.readFileSync(path.join(dir, 'peer-response'), 'utf8') === String(sequence),
      );
    };
    const check = async (target, bg, label) => {
      let sample;
      await waitFor(async () => {
        sample = await target.statusItem();
        return sample?.background === bg;
      });
      checks.push({ label, ...sample });
    };
    main.emit({ type: 'start', thread: 'same-thread', turn: 'a' });
    main.emit({ type: 'wait', thread: 'same-thread', turn: 'a', request: 'approve' });
    peer.emit({ type: 'start', thread: 'same-thread', turn: 'b' });
    peer.emit({ type: 'complete', thread: 'same-thread', turn: 'b', status: 'completed' });
    await check(renderer, 'rgb(166, 107, 22)', 'Main amber while peer is purple');
    await check(peerRenderer, 'rgb(98, 91, 120)', 'Peer purple on the same project');
    const [own, other] = await Promise.all([query(main.registry), query(peer.registry)]);
    assert.equal(own.summary.state, 'approval');
    assert.equal(other.summary.state, 'finished');
    assert.equal(
      own.appearanceTarget.file,
      other.appearanceTarget.file,
      'Both windows share the exact appearance settings target',
    );
    await commandPeer('codexActivity.acknowledge');
    await check(peerRenderer, 'rgba(0, 0, 0, 0)', 'Peer acknowledgement clears only peer');
    await check(renderer, 'rgb(166, 107, 22)', 'Main approval survives peer acknowledgement');
    await vscode.commands.executeCommand('workbench.action.focusWindow');
    await waitFor(() => vscode.window.state.focused);
    await check(renderer, 'rgb(166, 107, 22)', 'Returning preserves pending approval');
    main.emit({ type: 'resolved', thread: 'same-thread', request: 'approve' });
    await check(renderer, 'rgb(36, 90, 145)', 'Resolved approval resumes blue');
    main.emit({ type: 'complete', thread: 'same-thread', turn: 'a', status: 'completed' });
    await check(renderer, 'rgb(98, 91, 120)', 'Focused completion remains unread');
    await commandPeer('workbench.action.focusWindow');
    await waitFor(() => !vscode.window.state.focused);
    assert.equal(api.summary().unread, 1);
    await check(renderer, 'rgb(98, 91, 120)', 'Focusing peer preserves main unread');
    await vscode.commands.executeCommand('workbench.action.focusWindow');
    await waitFor(() => vscode.window.state.focused && api.summary().unread === 0);
    await check(renderer, 'rgba(0, 0, 0, 0)', 'Focus return clears main purple');
    main.emit({ type: 'start', thread: 'same-thread', turn: 'disable' });
    await check(renderer, 'rgb(36, 90, 145)', 'Processing before disable');
    await vscode.workspace
      .getConfiguration('codexActivity')
      .update('enabled', false, vscode.ConfigurationTarget.Global);
    await check(renderer, 'rgba(0, 0, 0, 0)', 'Disable removes main background');
    assert.equal(fs.existsSync(path.join(project, '.vscode')), false);
    assert.equal(fs.readFileSync(vscode.workspace.workspaceFile.fsPath, 'utf8'), original);
    fs.writeFileSync(
      path.join(dir, 'multi-result.json'),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          sameSettingsTarget: true,
          independentRouting: true,
          noProjectSettingsWrites: true,
          realFocusAcknowledgement: true,
          checks,
        },
        null,
        2,
      ),
    );
    console.log('Two windows sharing the exact settings target passed.');
  } finally {
    fs.writeFileSync(path.join(dir, 'multi-done'), 'done');
    peer?.socket.destroy();
    main.socket.destroy();
    peerRenderer?.close();
    renderer.close();
    child.kill();
  }
}
module.exports = { run, runPeer };
