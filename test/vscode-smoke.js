'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { runtimeRoot } = require('../src/bridge');
async function waitFor(fn) {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('Timed out');
}
async function run() {
  const ext = vscode.extensions.getExtension('tloureiro.codex-activity-status'),
    api = await ext.activate();
  assert.equal(api.workspaceReady, true);
  if (process.env.ACTIVITY_OFFICIAL_VERSION) {
    const official = vscode.extensions.getExtension('openai.chatgpt');
    assert.ok(official, 'Official extension loaded in test profile');
    await official.activate();
    await vscode.commands.executeCommand('chatgpt.openSidebar');
    await waitFor(() => api.summary().connected >= 1);
    assert.equal(api.setupStatus().code, 'ready');
    console.log(
      'Official Codex app-server associated with owning extension host: ' +
        process.env.ACTIVITY_OFFICIAL_VERSION,
    );
  }
  const registry = JSON.parse(fs.readFileSync(path.join(runtimeRoot(), api.host + '.json')));
  const socket = net.createConnection(registry.socketPath);
  await new Promise((r) => socket.once('connect', r));
  socket.write(JSON.stringify({ token: registry.token, parent: api.host }) + '\n');
  const emit = (event) => socket.write(JSON.stringify({ event }) + '\n');
  const colors = () =>
    vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')?.workspaceValue;
  const setting = async (key, value) =>
    vscode.workspace
      .getConfiguration('codexActivity')
      .update(key, value, vscode.ConfigurationTarget.Workspace);
  try {
    emit({ type: 'start', thread: 'a', turn: '1' });
    await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
    emit({ type: 'wait', thread: 'a', turn: '1', request: 'approve' });
    await waitFor(() => colors()?.['statusBar.background'] === '#A66B16');
    await vscode.commands.executeCommand('codexActivity.acknowledge');
    assert.equal(api.summary().state, 'approval');
    emit({ type: 'resolved', thread: 'a', request: 'approve' });
    await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
    emit({ type: 'complete', thread: 'a', turn: '1', status: 'completed' });
    await waitFor(() => colors()?.['statusBar.background'] === '#625B78');
    assert.equal(
      api.statusAction(),
      'codexActivity.acknowledge',
      'Finished status provides one-click acknowledgement',
    );
    const doc = await vscode.workspace.openTextDocument({
      content: 'programmatic changes are not acknowledgement',
      language: 'plaintext',
    });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(0, 0), 'generated: ');
    await vscode.workspace.applyEdit(edit);
    await api.whenAppearanceSettled();
    assert.equal(api.summary().state, 'finished');
    await setting('surface', 'both');
    await waitFor(() => colors()?.['titleBar.inactiveBackground'] === '#625B78');
    await setting('finishedColor', '#776688');
    await waitFor(() => colors()?.['titleBar.activeBackground'] === '#776688');
    const c = vscode.workspace.getConfiguration('workbench');
    await c.update(
      'colorCustomizations',
      { ...colors(), 'editor.background': '#101112' },
      vscode.ConfigurationTarget.Workspace,
    );
    const restoreStarted = Date.now();
    await vscode.commands.executeCommand(api.statusAction());
    await waitFor(() => !colors()?.['statusBar.background']);
    const acknowledgementRestoreMs = Date.now() - restoreStarted;
    console.log('Acknowledgement to settings restoration: ' + acknowledgementRestoreMs + ' ms');
    assert.equal(colors()['editor.background'], '#101112');
    // Real child process inheritance: a proxy spawned by this extension host
    // must reach this window without a cwd-based lookup.
    const fake = path.join(process.env.ACTIVITY_TEST_DIR, 'fake.cjs');
    fs.writeFileSync(
      fake,
      `setTimeout(()=>{process.stdout.write(JSON.stringify({method:'turn/started',params:{threadId:'proxy',turn:{id:'p'}}})+'\\n')},200);process.stdin.resume();`,
    );
    const child = spawn(
      process.execPath,
      [path.resolve(__dirname, '../src/proxy.js'), process.execPath, fake, 'app-server'],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    try {
      await waitFor(() => api.summary().processing === 1);
    } finally {
      child.kill();
    }
    await waitFor(() => api.summary().processing === 0);
    await setting('enabled', false);
    await waitFor(() => !colors()?.['titleBar.activeBackground']);
    fs.writeFileSync(
      path.join(process.env.ACTIVITY_TEST_DIR, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          officialCodex: process.env.ACTIVITY_OFFICIAL_VERSION || null,
          acknowledgementRestoreMs,
          api: 'workspace configuration, authenticated IPC, child-process association, full status/title color keys, acknowledgement, restoration',
        },
        null,
        2,
      ),
    );
    console.log('Activity extension-host smoke passed.');
  } finally {
    socket.destroy();
  }
}
module.exports = { run };
