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
  for (let i = 0; i < 600; i++) {
    if (await fn()) return;
    await pause(50);
  }
  throw new Error('Timed out waiting for multi-window peer');
}
async function run(providedApi) {
  const dir = process.env.ACTIVITY_TEST_DIR;
  const file = vscode.workspace.workspaceFile.fsPath,
    peer = path.basename(file).startsWith('peer');
  const api = providedApi?.summary
    ? providedApi
    : await vscode.extensions.getExtension('tloureiro.codex-activity-status').activate();
  assert.equal(api.workspaceReady, true);
  const panel = vscode.window.createWebviewPanel(
    'activityFocusFixture',
    'Activity focus fixture',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  panel.webview.html =
    '<!doctype html><html><body><input autofocus aria-label="Focus fixture"><script>window.addEventListener("message", e => { if (e.data === "focus") document.querySelector("input").focus(); });</script></body></html>';
  const registry = JSON.parse(fs.readFileSync(path.join(runtimeRoot(), api.host + '.json')));
  const socket = net.createConnection(registry.socketPath);
  await new Promise((r) => socket.once('connect', r));
  socket.write(JSON.stringify({ token: registry.token, parent: api.host }) + '\n');
  const emit = (e) => socket.write(JSON.stringify({ event: e }) + '\n');
  const colors = () =>
    vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')?.workspaceValue;
  const marker = (name) => path.join(dir, name);
  const renderer = peer ? null : await connectRenderer('Activity renderer main');
  const renderedStatusBarChecks = [];
  async function expectRendered(background, label) {
    let actual;
    for (let i = 0; i < 20; i++) {
      actual = await renderer.statusBar();
      if (actual?.background === background) break;
      await pause(50);
    }
    assert.equal(actual?.background, background, label + ': actual rendered status bar');
    renderedStatusBarChecks.push({ label, ...actual });
  }
  const focusEvents = [];
  const focusStarted = Date.now();
  const focusListener = vscode.window.onDidChangeWindowState((e) =>
    focusEvents.push({
      elapsedMs: Date.now() - focusStarted,
      focused: e.focused,
      active: e.active,
    }),
  );
  try {
    if (peer) {
      assert.equal(api.summary().processing, 0);
      assert.equal(colors(), undefined);
      fs.writeFileSync(marker('peer-normal'), JSON.stringify({ host: api.host }));
      emit({ type: 'start', thread: 'same-thread', turn: 'b' });
      await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
      emit({ type: 'complete', thread: 'same-thread', turn: 'b', status: 'completed' });
      await waitFor(() => colors()?.['statusBar.background'] === '#625B78');
      fs.writeFileSync(marker('peer-finished'), 'ok');
      await waitFor(() => fs.existsSync(marker('main-approval-returned')));
      await vscode.commands.executeCommand('workbench.action.focusWindow');
      await waitFor(() => vscode.window.state.focused);
      // Returning to B correctly acknowledges its first completion. Create a
      // fresh one for the subsequent independent-acknowledgement scenario.
      emit({ type: 'start', thread: 'same-thread', turn: 'b2' });
      await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
      emit({ type: 'complete', thread: 'same-thread', turn: 'b2', status: 'completed' });
      await waitFor(() => colors()?.['statusBar.background'] === '#625B78');
      fs.writeFileSync(marker('peer-focused-approval'), 'ok');
      await waitFor(() => fs.existsSync(marker('main-finished')));
      assert.equal(api.summary().unread, 1);
      await vscode.commands.executeCommand('codexActivity.acknowledge');
      await waitFor(() => !colors()?.['statusBar.background']);
      fs.writeFileSync(marker('peer-acknowledged'), 'ok');
      await waitFor(() => fs.existsSync(marker('main-finished-focused')));
      await vscode.commands.executeCommand('workbench.action.focusWindow');
      await waitFor(() => vscode.window.state.focused);
      fs.writeFileSync(marker('peer-refocused'), 'ok');
      if (process.env.ACTIVITY_FOCUS_APP) {
        await waitFor(() => fs.existsSync(marker('main-finished-external')));
        await vscode.commands.executeCommand('workbench.action.focusWindow');
        await waitFor(() => vscode.window.state.focused);
        fs.writeFileSync(marker('peer-refocused-external'), 'ok');
      }
      await waitFor(() => fs.existsSync(marker('main-checked')));
    } else {
      emit({ type: 'start', thread: 'same-thread', turn: 'a' });
      await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
      const peerFile = path.join(path.dirname(file), 'peer.code-workspace');
      fs.copyFileSync(file, peerFile);
      // Remove the active overlay from the peer's copied workspace.
      const data = JSON.parse(fs.readFileSync(peerFile));
      delete data.settings['workbench.colorCustomizations'];
      data.settings['window.title'] = 'Activity renderer peer';
      fs.writeFileSync(peerFile, JSON.stringify(data));
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
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(
        '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
        [
          peerFile,
          '--new-window',
          '--user-data-dir=' + path.join(dir, 'user'),
          '--extensions-dir=' + path.join(dir, 'extensions'),
          '--extensionDevelopmentPath=' + peerExtension,
          '--disable-workspace-trust',
          '--skip-welcome',
          '--disable-telemetry',
          '--disable-updates',
          '--no-sandbox',
        ],
        {
          env,
          stdio: [
            'ignore',
            fs.openSync(marker('peer.log'), 'a'),
            fs.openSync(marker('peer.log'), 'a'),
          ],
        },
      );
      child.unref();
      await waitFor(() => {
        if (fs.existsSync(marker('peer-error')))
          throw new Error(fs.readFileSync(marker('peer-error'), 'utf8'));
        return fs.existsSync(marker('peer-normal'));
      });
      assert.equal(colors()['statusBar.background'], '#245A91');
      await waitFor(() => !vscode.window.state.focused);
      await expectRendered('rgb(36, 90, 145)', 'Unfocused processing remains blue');
      await waitFor(() => fs.existsSync(marker('peer-finished')));
      assert.equal(colors()['statusBar.background'], '#245A91');
      const peerHost = JSON.parse(fs.readFileSync(marker('peer-normal'))).host;
      const peerRegistry = JSON.parse(
        fs.readFileSync(path.join(runtimeRoot(), peerHost + '.json')),
      );
      const [ownDiagnostics, peerDiagnostics] = await Promise.all([
        query(registry),
        query(peerRegistry),
      ]);
      assert.equal(ownDiagnostics.host, api.host);
      assert.equal(ownDiagnostics.summary.processing, 1);
      assert.equal(peerDiagnostics.host, peerHost);
      assert.equal(peerDiagnostics.summary.unread, 1);
      assert.notEqual(ownDiagnostics.workspace, peerDiagnostics.workspace);
      // The reported amber disappearance must be checked in the renderer,
      // both when another window is focused and after returning to this one.
      emit({ type: 'wait', thread: 'same-thread', turn: 'a', request: 'approval-fixture' });
      await waitFor(() => colors()?.['statusBar.background'] === '#A66B16');
      await expectRendered('rgb(166, 107, 22)', 'Unfocused approval remains amber');
      await vscode.commands.executeCommand('workbench.action.focusWindow');
      await waitFor(() => vscode.window.state.focused);
      assert.equal(api.summary().state, 'approval');
      await expectRendered('rgb(166, 107, 22)', 'Returning to A preserves amber');
      fs.writeFileSync(marker('main-approval-returned'), 'ok');
      await waitFor(() => fs.existsSync(marker('peer-focused-approval')));
      await waitFor(() => !vscode.window.state.focused);
      assert.equal(api.summary().state, 'approval');
      await expectRendered('rgb(166, 107, 22)', 'Focusing B preserves rendered amber in A');
      emit({ type: 'resolved', thread: 'same-thread', request: 'approval-fixture' });
      await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
      const unfocusedAtFinish = !vscode.window.state.focused;
      emit({ type: 'complete', thread: 'same-thread', turn: 'a', status: 'completed' });
      await waitFor(() => colors()?.['statusBar.background'] === '#625B78');
      fs.writeFileSync(marker('main-finished'), 'ok');
      await expectRendered('rgb(98, 91, 120)', 'Unfocused completion remains purple');
      await waitFor(() => fs.existsSync(marker('peer-acknowledged')));
      assert.equal(api.summary().unread, 1);
      assert.equal(colors()['statusBar.background'], '#625B78');
      assert.equal(vscode.window.state.focused, false, 'Peer still owns focus before returning');
      const focusReturnStarted = Date.now();
      await vscode.commands.executeCommand('workbench.action.focusWindow');
      await waitFor(() => vscode.window.state.focused);
      await waitFor(() => api.summary().unread === 0 && !colors()?.['statusBar.background']);
      const focusReturnRestoreMs = Date.now() - focusReturnStarted;
      await expectRendered(
        'rgb(24, 24, 24)',
        'Focus acknowledgement restores Dark Modern baseline',
      );
      // Regression: B must gain focus AFTER A completes, rather than remaining
      // focused throughout. A must keep its unread completion when focus leaves.
      emit({ type: 'start', thread: 'same-thread', turn: 'a2' });
      await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
      emit({ type: 'complete', thread: 'same-thread', turn: 'a2', status: 'completed' });
      await waitFor(() => colors()?.['statusBar.background'] === '#625B78');
      assert.equal(vscode.window.state.focused, true);
      fs.writeFileSync(marker('main-finished-focused'), 'ok');
      await waitFor(() => fs.existsSync(marker('peer-refocused')));
      await pause(600);
      assert.equal(vscode.window.state.focused, false, 'Focusing B must leave A unfocused');
      assert.equal(api.summary().unread, 1, 'Focusing B after A completed must preserve A unread');
      assert.equal(
        colors()['statusBar.background'],
        '#625B78',
        'Focusing B must preserve A purple bar',
      );
      await expectRendered('rgb(98, 91, 120)', 'Focusing B preserves rendered purple in A');
      await vscode.commands.executeCommand('workbench.action.focusWindow');
      await waitFor(
        () =>
          vscode.window.state.focused &&
          api.summary().unread === 0 &&
          !colors()?.['statusBar.background'],
      );
      if (process.env.ACTIVITY_FOCUS_APP) {
        emit({ type: 'start', thread: 'same-thread', turn: 'a3' });
        await waitFor(() => colors()?.['statusBar.background'] === '#245A91');
        const otherApp = spawn(process.env.ACTIVITY_FOCUS_APP, [], { stdio: 'ignore' });
        try {
          await waitFor(() => !vscode.window.state.focused);
          await pause(300);
          emit({ type: 'complete', thread: 'same-thread', turn: 'a3', status: 'completed' });
          await waitFor(() => colors()?.['statusBar.background'] === '#625B78');
          fs.writeFileSync(marker('main-finished-external'), 'ok');
          await waitFor(() => fs.existsSync(marker('peer-refocused-external')));
          await pause(600);
          assert.equal(
            api.summary().unread,
            1,
            'Returning to B from another app must preserve A unread',
          );
          assert.equal(colors()['statusBar.background'], '#625B78');
          await vscode.commands.executeCommand('workbench.action.focusWindow');
          await waitFor(
            () =>
              vscode.window.state.focused &&
              api.summary().unread === 0 &&
              !colors()?.['statusBar.background'],
          );
        } finally {
          otherApp.kill();
        }
      }
      fs.writeFileSync(
        marker('multi-result.json'),
        JSON.stringify(
          {
            passed: true,
            vscode: vscode.version,
            sameProfile: true,
            sameProject: true,
            sameThreadIdentifier: true,
            independentWorkspaceFiles: true,
            bothWindowDiagnosticsQueried: true,
            unfocusedAtFinish,
            peerAcknowledgementPreservedMainUnread: true,
            peerFocusAfterCompletionPreservedMainUnread: true,
            peerAppReturnPreservedMainUnread: !!process.env.ACTIVITY_FOCUS_APP,
            realFocusReturnAcknowledged: true,
            focusReturnRestoreMs,
            focusEvents,
            renderedStatusBarChecks,
          },
          null,
          2,
        ),
      );
      fs.writeFileSync(marker('main-checked'), 'ok');
      await pause(200);
      console.log(
        'Two simultaneous windows in one profile passed independent routing/color/acknowledgement checks.',
      );
    }
  } finally {
    renderer?.close();
    panel.dispose();
    focusListener.dispose();
    socket.destroy();
  }
}
module.exports = { run };
