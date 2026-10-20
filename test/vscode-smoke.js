'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { runtimeRoot } = require('../src/bridge');
const { connectRenderer } = require('./renderer');
async function waitFor(fn) {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('Timed out');
}
async function run() {
  const ext = vscode.extensions.getExtension('tloureiro.codex-activity-status'),
    api = await ext.activate();
  assert.equal(api.appearance().supported, true);
  if (process.env.ACTIVITY_OFFICIAL_VERSION) {
    const official = vscode.extensions.getExtension('openai.chatgpt');
    await official.activate();
    await vscode.commands.executeCommand('chatgpt.openSidebar');
    await waitFor(() => api.summary().connected >= 1);
    assert.equal(api.setupStatus().code, 'ready');
  }
  const registry = JSON.parse(fs.readFileSync(path.join(runtimeRoot(), api.host + '.json')));
  let socket = net.createConnection(registry.socketPath);
  await new Promise((r) => socket.once('connect', r));
  socket.write(JSON.stringify({ token: registry.token, parent: api.host }) + '\n');
  const emit = (event) => socket.write(JSON.stringify({ event }) + '\n');
  const renderer = await connectRenderer('Activity renderer main');
  const colors = () =>
    vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')?.workspaceValue;
  const baseline = colors();
  if (process.env.ACTIVITY_MIGRATION === '1') {
    assert.deepEqual(baseline, {
      'statusBar.background': '#112233',
      'editor.background': '#202122',
    });
    assert.equal(fs.existsSync(vscode.workspace.workspaceFile.fsPath + '.appearance.json'), false);
  }
  const settingsFile =
    vscode.workspace.workspaceFile?.fsPath ||
    (vscode.workspace.workspaceFolders?.[0] &&
      path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode/settings.json'));
  const originalFile =
    settingsFile && fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : undefined;
  const setting = (key, value) =>
    vscode.workspace
      .getConfiguration('codexActivity')
      .update(key, value, vscode.ConfigurationTarget.Global);
  const samples = [];
  const expected = {
    processing: ['rgb(36, 90, 145)', 'rgb(255, 255, 255)'],
    approval: ['rgb(166, 107, 22)', 'rgb(0, 0, 0)'],
    finished: ['rgb(98, 91, 120)', 'rgb(255, 255, 255)'],
  };
  const expectState = async (state) => {
    await waitFor(
      () =>
        api.summary().state === state &&
        api.appearance().background === `codexActivity.${state}Background`,
    );
    let sample;
    await waitFor(async () => {
      sample = await renderer.statusItem();
      return sample?.background === expected[state][0] && sample?.foreground === expected[state][1];
    });
    assert.ok(sample.width > 400, 'Active indicator retains wide prototype padding');
    assert.deepEqual(colors(), baseline, 'Activity never writes workspace colors');
    samples.push({
      state,
      theme: vscode.workspace.getConfiguration('workbench').get('colorTheme'),
      ...sample,
    });
  };
  try {
    for (const theme of [
      'Dark Modern',
      'Light Modern',
      'Default High Contrast',
      'Default High Contrast Light',
    ]) {
      await vscode.workspace
        .getConfiguration('workbench')
        .update('colorTheme', theme, vscode.ConfigurationTarget.Global);
      await waitFor(
        () =>
          vscode.window.activeColorTheme.kind ===
          {
            'Dark Modern': 2,
            'Light Modern': 1,
            'Default High Contrast': 3,
            'Default High Contrast Light': 4,
          }[theme],
      );
      emit({ type: 'start', thread: 'a', turn: theme });
      await expectState('processing');
      emit({ type: 'wait', thread: 'a', turn: theme, request: 'approve' });
      await expectState('approval');
      await vscode.commands.executeCommand('codexActivity.acknowledge');
      assert.equal(api.summary().state, 'approval');
      emit({ type: 'resolved', thread: 'a', request: 'approve' });
      await expectState('processing');
      emit({ type: 'complete', thread: 'a', turn: theme, status: 'completed' });
      await expectState('finished');
      // With the official extension ready, the item offers one-click acknowledgement.
      if (process.env.ACTIVITY_OFFICIAL_VERSION)
        assert.equal(api.statusAction(), 'codexActivity.acknowledge');
      const doc = await vscode.workspace.openTextDocument({ content: 'fixture' });
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, new vscode.Position(0, 0), 'generated: ');
      await vscode.workspace.applyEdit(edit);
      assert.equal(api.summary().state, 'finished');
      await vscode.commands.executeCommand('codexActivity.acknowledge');
      assert.equal(api.appearance().background, null);
      await waitFor(async () => !(await renderer.statusItem())?.text.endsWith(' '));
    }
    // Former appearance settings cannot reactivate project overlays.
    await setting('surface', 'both');
    await setting('finishedColor', '#776688');
    emit({ type: 'start', thread: 'disable', turn: 'd' });
    await expectState('processing');
    await setting('enabled', false);
    await waitFor(() => api.appearance().background === null);
    await setting('enabled', true);
    await waitFor(() => api.appearance().background === null);
    socket.destroy();
    socket = net.createConnection(registry.socketPath);
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(JSON.stringify({ token: registry.token, parent: api.host }) + '\n');
    const fake = path.join(process.env.ACTIVITY_TEST_DIR, 'fake.cjs');
    fs.writeFileSync(
      fake,
      `setTimeout(()=>{process.stdout.write(JSON.stringify({method:'turn/started',params:{threadId:'proxy',turn:{id:'p'}}})+String.fromCharCode(10))},200);process.stdin.resume();`,
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
    assert.equal(api.appearance().background, null);
    assert.deepEqual(colors(), baseline);
    if (settingsFile)
      assert.equal(
        fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : undefined,
        originalFile,
        'No project settings changes across activity, themes, and disable',
      );
    // Exercise loss and recovery of the private capability in this disposable host.
    const probe = vscode.window.createStatusBarItem();
    const allowed = probe.constructor.ALLOWED_BACKGROUND_COLORS;
    probe.dispose();
    const warning = allowed.get('statusBarItem.warningBackground');
    try {
      allowed.delete('statusBarItem.warningBackground');
      emit({ type: 'start', thread: 'fallback', turn: 'f' });
      await waitFor(() => api.summary().state === 'processing' && !api.appearance().supported);
      assert.equal(api.summary().state, 'processing');
      assert.equal(api.appearance().background, null);
      await waitFor(async () => (await renderer.statusItem())?.background === 'rgba(0, 0, 0, 0)');
    } finally {
      allowed.set('statusBarItem.warningBackground', warning);
    }
    emit({ type: 'wait', thread: 'fallback', turn: 'f', request: 'fallback-approval' });
    await expectState('approval');
    await require('../src/extension').deactivate();
    assert.equal(api.appearance().background, null);
    for (const name of ['processing', 'approval', 'finished'])
      assert.equal(allowed.has(`codexActivity.${name}Background`), false);
    assert.equal(allowed.get('statusBarItem.warningBackground'), warning);
    fs.writeFileSync(
      path.join(process.env.ACTIVITY_TEST_DIR, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          vscode: vscode.version,
          officialCodex: process.env.ACTIVITY_OFFICIAL_VERSION || null,
          noProjectSettingsWrites: true,
          capabilityLossAndRecovery: true,
          deactivationRemovedOwnedEntries: true,
          samples,
        },
        null,
        2,
      ),
    );
    console.log('Status-item production extension-host smoke passed.');
  } finally {
    renderer.close();
    socket.destroy();
  }
}
module.exports = { run };
