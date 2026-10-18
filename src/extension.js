'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { ActivityState } = require('./state');
const { Appearance, defaults, validColor } = require('./appearance');
const { listen } = require('./bridge');
const { Setup } = require('./setup');
const { ColorLease, appearanceTarget } = require('./color-lease');
const { collect } = require('./diagnostics');
let controller;
function config() {
  const c = vscode.workspace.getConfiguration('codexActivity');
  return {
    enabled: c.get('enabled', true),
    autoAcknowledge: c.get('autoAcknowledge', true),
    surface: c.get('surface', 'statusBar'),
    ...Object.fromEntries(
      Object.keys(defaults).map((s) => [s + 'Color', validColor(c.get(s + 'Color'), defaults[s])]),
    ),
  };
}
async function activate(context) {
  const output = vscode.window.createOutputChannel('Codex Window Activity');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  status.command = 'codexActivity.diagnostics';
  status.name = 'Codex Window Activity';
  status.show();
  context.subscriptions.push(output, status);
  const activityTrace = [];
  let lastSummary = '';
  function trace(event, detail = {}) {
    activityTrace.push({ at: new Date().toISOString(), event, ...detail });
    if (activityTrace.length > 80) activityTrace.shift();
  }
  const state = new ActivityState();
  state.focused = vscode.window.state.focused;
  let appearance,
    bridge,
    lease,
    watchdog,
    setup,
    promptTimer,
    error = '',
    disposed = false;
  const target = appearanceTarget(vscode);
  const workspace =
    vscode.workspace.workspaceFile?.fsPath ||
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    '';
  function render() {
    if (disposed) return;
    const c = config();
    state.autoAcknowledge = c.autoAcknowledge;
    const s = state.summary();
    const summaryKey = JSON.stringify(s);
    if (summaryKey !== lastSummary) {
      trace('state', { focused: state.focused, ...s });
      lastSummary = summaryKey;
    }
    const health = setup?.status();
    status.text =
      health?.code === 'shared'
        ? `Codex: ${s.state} (shared workspace)`
        : health && health.code !== 'ready'
          ? health.label
          : `Codex: ${s.state === 'approval' ? 'Needs input' : s.state}`;
    status.command =
      health?.code === 'ready'
        ? s.state === 'finished'
          ? 'codexActivity.acknowledge'
          : 'codexActivity.diagnostics'
        : 'codexActivity.setup';
    status.tooltip = `${health?.detail || error || 'Checking activity setup'}\n${s.processing} working · ${s.waiting} waiting · ${s.unread} unread · ${s.connected} connections\n${s.problems.join(', ')}\n${health?.code === 'ready' ? (s.state === 'finished' ? 'Click to acknowledge this completion and restore normal colors.' : 'Click for diagnostics; use Acknowledge Completion to clear unread completions.') : 'Click to complete setup or resolve the connection.'}`;
    if (appearance)
      appearance.update(c.enabled && lease?.exclusive ? s.state : 'unknown', c).catch((e) => {
        error = 'Appearance update failed: ' + e.message;
        output.appendLine(error);
      });
  }
  async function installBridge() {
    const changed = await setup.ensureBridge();
    const action = await vscode.window.showInformationMessage(
      changed
        ? 'Activity bridge configured. Complete setup to connect this window.'
        : 'Activity bridge is up to date.',
      'Complete Setup',
    );
    if (action === 'Complete Setup') await setup.run();
  }
  async function removeBridge() {
    await vscode.workspace
      .getConfiguration('codexActivity')
      .update(
        'enabled',
        false,
        target ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
      );
    state.clear();
    if (appearance) await appearance.dispose();
    const saved = context.globalState.get('bridge');
    if (saved) {
      const c = vscode.workspace.getConfiguration('chatgpt');
      if (c.inspect('cliExecutable')?.globalValue === saved.launcher)
        await c.update(
          'cliExecutable',
          saved.had ? saved.previous : undefined,
          vscode.ConfigurationTarget.Global,
        );
      await context.globalState.update('bridge', undefined);
      // Keep launcher until Codex has restarted; it continues to pass through.
    }
    vscode.window.showInformationMessage(
      'Bridge setting and this window’s appearance restored. Reload other windows before uninstalling.',
    );
    render();
  }
  function snapshot() {
    return {
      at: new Date().toISOString(),
      vscode: vscode.version,
      extensionVersion: context.extension.packageJSON.version,
      platform: process.platform,
      remote: vscode.env.remoteName || null,
      host: process.pid,
      app: process.ppid,
      windowState: { focused: vscode.window.state.focused, active: vscode.window.state.active },
      appearanceTarget: target,
      exclusiveColors: lease?.exclusive,
      enabled: config().enabled,
      bridge: !!bridge,
      workspace,
      setup: setup.status(),
      summary: state.summary(),
      recentEvents: activityTrace,
      appearanceTimings: appearance?.timings,
      error,
    };
  }
  function diagnostics() {
    output.appendLine(JSON.stringify(snapshot(), null, 2));
    output.show(true);
  }
  setup = new Setup(vscode, context, {
    workspaceReady: !!target,
    colorConflict: () => !!lease && !lease.exclusive,
    enabled: () => config().enabled,
    connected: () => state.summary().connected > 0,
    error: () => error,
    diagnostics,
    changed: render,
  });
  const command = (id, fn) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          return await fn();
        } catch (e) {
          output.appendLine(e.stack || e.message);
          vscode.window.showErrorMessage('Codex Activity: ' + e.message);
        }
      }),
    );
  command('codexActivity.setup', () => setup.run());
  command('codexActivity.installBridge', installBridge);
  command('codexActivity.removeBridge', removeBridge);
  command('codexActivity.acknowledge', () => {
    trace('acknowledgeCommand');
    state.acknowledge();
    render();
  });
  command('codexActivity.diagnostics', diagnostics);
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      const unreadBefore = state.summary().unread;
      trace('windowFocus', {
        focused: e.focused,
        active: e.active,
        previousFocused: state.focused,
        unreadBefore,
      });
      state.autoAcknowledge = config().autoAcknowledge;
      state.focus(e.focused);
      if (state.summary().unread < unreadBefore) {
        trace('acknowledged', { reason: 'windowFocus', unreadBefore });
        // Capture the peer perspective at the problematic transition, rather than
        // requiring the user to collect another window's output at that moment.
        collect()
          .then((windows) => {
            if (!disposed)
              trace('peerFocusAtAcknowledgement', {
                windows: windows
                  .filter((w) => w.host !== process.pid)
                  .map((w) => ({
                    host: w.host,
                    app: w.app,
                    windowState: w.windowState,
                    at: w.at,
                    error: w.error,
                  })),
              });
          })
          .catch((e) => {
            if (!disposed) trace('peerFocusProbeError', { error: e.message });
          });
      }
      render();
      // Appearance restoration has priority over checking the launcher on disk.
      if (e.focused) {
        setup.refresh();
        render();
      }
    }),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (state.summary().unread)
        trace('editorInteraction', { kind: e.kind, focused: state.focused });
      state.interaction(e.kind);
      render();
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('chatgpt.cliExecutable')) {
        setup.refresh();
        render();
      } else if (e.affectsConfiguration('codexActivity')) {
        if (e.affectsConfiguration('codexActivity.enabled')) {
          if (!config().enabled) state.clear();
          bridge?.reset();
        }
        render();
      } else if (
        e.affectsConfiguration('workbench.colorCustomizations') &&
        appearance &&
        !appearance.isOwnChange()
      )
        render();
    }),
  );
  context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(render));
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      setup.refresh();
      render();
    }),
  );
  if (process.platform !== 'darwin' || vscode.env.remoteName)
    error = 'Unsupported environment: use local macOS desktop VS Code.';
  else if (target) {
    try {
      lease = new ColorLease(target.file, render);
      appearance = new Appearance(vscode, target.file, {
        onUpdate: (event) => {
          if (event.outcome !== 'unchanged') trace('appearance', event);
        },
        canHighlight: () => !!lease?.exclusive && config().enabled,
        verifyDisk: true,
        journalPath: lease.journalPath,
        container: target.container,
        owner: lease.owner.token,
        canRestoreOther: () => lease.exclusive,
      });
      // Recover old generated-workspace journals without creating more wrappers.
      const legacyJournal = target.file + '.appearance.json';
      if (fs.existsSync(legacyJournal) && !fs.existsSync(lease.journalPath))
        fs.renameSync(legacyJournal, lease.journalPath);
      await appearance.update('unknown', config());
      watchdog = fork(
        path.join(context.extensionPath, 'src', 'watchdog.js'),
        [target.file, lease.member, lease.owner.token, lease.journalPath],
        {
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          execArgv: [],
        },
      );
      watchdog.on('error', (e) => {
        error = 'Crash recovery unavailable: ' + e.message;
        render();
      });
      lease.setWatchdog(watchdog.pid);
      watchdog.unref();
      watchdog.channel?.unref();
      bridge = await listen(
        (source) => {
          if (config().enabled) state.connect(source);
          render();
        },
        (source, event) => {
          if (event.type === 'complete')
            trace('completionReceived', { focused: state.focused, outcome: event.status });
          if (config().enabled) {
            if (!state.sources.has(source)) state.connect(source);
            state.apply(source, event);
          }
          render();
        },
        (source) => {
          state.disconnect(source);
          render();
        },
        undefined,
        { diagnostics: snapshot },
      );
    } catch (e) {
      error = e.message;
      output.appendLine(e.stack || error);
    }
  }
  controller = {
    async dispose() {
      disposed = true;
      clearTimeout(promptTimer);
      bridge?.dispose();
      try {
        if (appearance) await appearance.dispose();
        const pending =
          appearance && fs.existsSync(appearance.journalPath)
            ? JSON.parse(fs.readFileSync(appearance.journalPath, 'utf8'))
            : null;
        if (pending?.owner === lease?.owner.token && watchdog?.connected) {
          // If settings and the host's cache were still reconciling at shutdown,
          // leave our registration until the helper finishes disk recovery.
          lease.dispose(false);
          watchdog.disconnect();
          return;
        }
        if (watchdog?.connected) watchdog.send('stop');
        lease?.dispose();
      } catch (e) {
        // Keep the recovery owner/journal and let the helper retry after IPC loss.
        lease?.dispose(false);
        if (watchdog?.connected) watchdog.disconnect();
        throw e;
      }
    },
  };
  render();
  // Give an already-configured app-server time to connect before offering help.
  const promptDelay = setup.status().code === 'waiting' ? 8000 : 1200;
  promptTimer = setTimeout(() => {
    if (!disposed)
      setup.prompt().catch((e) => {
        output.appendLine(e.stack || e.message);
        vscode.window.showErrorMessage('Codex Activity setup: ' + e.message);
      });
  }, promptDelay);
  // A small diagnostics API, also used by the real extension-host smoke test.
  return {
    setupStatus: () => setup.status(),
    summary: () => state.summary(),
    workspaceReady: !!target,
    host: process.pid,
    statusAction: () => status.command,
    whenAppearanceSettled: () => appearance?.queue,
    isOwnAppearance: () => appearance?.isOwnChange(),
  };
}
async function deactivate() {
  if (controller) await controller.dispose();
}
module.exports = { activate, deactivate };
