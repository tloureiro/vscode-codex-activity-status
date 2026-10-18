'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { runtimeRoot } = require('../src/bridge');
async function waitFor(fn) {
  for (let i = 0; i < 400; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Setup test timed out');
}
async function run() {
  const dir = process.env.ACTIVITY_TEST_DIR,
    beforeFile = path.join(dir, 'setup-before.json');
  const api = await vscode.extensions.getExtension('tloureiro.codex-activity-status').activate();
  assert.equal(api.workspaceReady, true);
  assert.equal(
    vscode.workspace.workspaceFile,
    undefined,
    'This is an ordinary single-folder window',
  );
  const folder = vscode.workspace.workspaceFolders[0].uri.toString();
  if (!fs.existsSync(beforeFile)) {
    assert.equal(api.setupStatus().code, 'bridge');
    fs.writeFileSync(beforeFile, JSON.stringify({ folder, host: api.host }));
    void vscode.commands.executeCommand('codexActivity.setup');
    await waitFor(() => vscode.workspace.getConfiguration('chatgpt').get('cliExecutable'));
    // Simulate choosing the offered Reload Window action. The same folder and
    // window remain open; an already-running Codex server must be restarted.
    fs.writeFileSync(path.join(dir, 'setup-reload-requested'), 'expected runner shutdown');
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
    await new Promise(() => {});
  }
  const before = JSON.parse(fs.readFileSync(beforeFile));
  await vscode.extensions.getExtension('openai.chatgpt').activate();
  await vscode.commands.executeCommand('chatgpt.openSidebar');
  await waitFor(() => api.setupStatus().code === 'ready');
  assert.equal(folder, before.folder);
  assert.notEqual(api.host, before.host);
  assert.equal(vscode.workspace.workspaceFile, undefined, 'Setup did not replace the workspace');
  const registry = JSON.parse(fs.readFileSync(path.join(runtimeRoot(), api.host + '.json')));
  const socket = net.createConnection(registry.socketPath);
  await new Promise((r) => socket.once('connect', r));
  socket.write(JSON.stringify({ token: registry.token, parent: api.host }) + '\n');
  const emit = (event) => socket.write(JSON.stringify({ event }) + '\n');
  const colors = () =>
    vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')?.workspaceValue;
  try {
    emit({ type: 'start', thread: 'folder', turn: 't' });
    await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
    const settingsFile = path.join(
      vscode.workspace.workspaceFolders[0].uri.fsPath,
      '.vscode/settings.json',
    );
    const { parse } = require('jsonc-parser');
    assert.equal(
      parse(fs.readFileSync(settingsFile, 'utf8'))['workbench.colorCustomizations'][
        'statusBar.background'
      ],
      '#245A91',
    );
    emit({ type: 'complete', thread: 'folder', turn: 't', status: 'completed' });
    await waitFor(() => colors()?.['statusBar.background'] === '#625B78');
    await vscode.commands.executeCommand('codexActivity.acknowledge');
    await waitFor(() => !colors()?.['statusBar.background']);
    fs.writeFileSync(
      path.join(dir, 'setup-result.json'),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          missingSetupDetected: true,
          setupConfiguredExistingWindow: true,
          restartAfterSetup: true,
          sameProfileAndFolderAfterRestart: true,
          sameFolder: true,
          noWorkspaceReplacement: true,
          officialCodexConnected: true,
          singleFolderColorAndRestoration: true,
        },
        null,
        2,
      ),
    );
  } finally {
    socket.destroy();
  }
}
module.exports = { run };
