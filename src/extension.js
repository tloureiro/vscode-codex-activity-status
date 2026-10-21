'use strict';
const vscode = require('vscode');
const { CompletionEvents } = require('./completion-events');
const { CompletionState } = require('./completion-state');
const { Integration } = require('./integration');
const { Setup } = require('./setup');
const { StatusPresenter } = require('./status-presenter');

let controller;

function config() {
  const settings = vscode.workspace.getConfiguration('codexCompletion');
  return {
    enabled: settings.get('enabled', true),
    autoAcknowledge: settings.get('autoAcknowledge', true),
  };
}

async function activate(context) {
  const output = vscode.window.createOutputChannel('Codex Completion');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  status.name = 'Codex Completion';
  status.show();
  context.subscriptions.push(output, status);

  const presenter = new StatusPresenter(vscode, status);
  const state = new CompletionState();
  state.focused = vscode.window.state.focused;
  const integration = new Integration(vscode, context);
  const trace = [];
  let setup;
  let events;
  let promptTimer;
  let disposed = false;
  let error = '';

  function record(event, detail = {}) {
    trace.push({ at: new Date().toISOString(), event, ...detail });
    if (trace.length > 50) trace.shift();
  }

  function snapshot() {
    return {
      at: new Date().toISOString(),
      vscode: vscode.version,
      extensionVersion: context.extension.packageJSON.version,
      platform: process.platform,
      remote: vscode.env.remoteName || null,
      enabled: config().enabled,
      setup: setup.status(),
      summary: state.summary(),
      presentation: presenter.snapshot(),
      recentEvents: trace,
      error,
    };
  }

  function diagnostics() {
    output.appendLine(JSON.stringify(snapshot(), null, 2));
    output.show(true);
  }

  function render() {
    if (disposed) return;
    const settings = config();
    state.autoAcknowledge = settings.autoAcknowledge;
    const summary = state.summary();
    const health = setup.status();
    const ready = health.code === 'ready';
    const finished = ready && summary.state === 'finished';
    const label = finished ? 'Codex: finished' : ready ? 'Codex completion: Ready' : health.label;
    presenter.update(finished, label, settings.enabled);
    status.command = finished
      ? 'codexCompletion.acknowledge'
      : ready
        ? 'codexCompletion.diagnostics'
        : 'codexCompletion.setup';
    status.tooltip = finished
      ? `${summary.unread} unread Codex completion${summary.unread === 1 ? '' : 's'}. Click to acknowledge.`
      : health.detail;
  }

  setup = new Setup(vscode, context, {
    enabled: () => config().enabled,
    enable: () =>
      vscode.workspace
        .getConfiguration('codexCompletion')
        .update('enabled', true, vscode.ConfigurationTarget.Global),
    integration,
    changed: render,
  });

  const command = (id, fn) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        try {
          return await fn();
        } catch (caught) {
          error = caught.message;
          output.appendLine(caught.stack || caught.message);
          vscode.window.showErrorMessage(`Codex Completion: ${caught.message}`);
          render();
        }
      }),
    );

  async function removeIntegration() {
    const removed = await integration.remove();
    await vscode.workspace
      .getConfiguration('codexCompletion')
      .update('enabled', false, vscode.ConfigurationTarget.Global);
    state.acknowledge();
    render();
    const legacy = [
      removed.proxy ? 'the old executable proxy' : '',
      removed.hooks.length
        ? `${removed.hooks.length} legacy hook${removed.hooks.length === 1 ? '' : 's'}`
        : '',
    ].filter(Boolean);
    vscode.window.showInformationMessage(
      `Codex completion integration removed${legacy.length ? `, including ${legacy.join(' and ')}` : ''}. Restart the current Codex chat to reload its configuration.`,
    );
  }

  async function cleanupLegacy() {
    const removed = await integration.cleanupLegacy();
    setup.refresh();
    render();
    const legacy = [
      removed.proxy ? 'the old executable proxy' : '',
      removed.hooks.length
        ? `${removed.hooks.length} legacy hook${removed.hooks.length === 1 ? '' : 's'}`
        : '',
    ].filter(Boolean);
    vscode.window.showInformationMessage(
      legacy.length
        ? `Removed ${legacy.join(' and ')}.`
        : 'No legacy Codex Activity proxy or hooks were found.',
    );
  }

  command('codexCompletion.setup', () => setup.run());
  command('codexCompletion.cleanupLegacy', cleanupLegacy);
  command('codexCompletion.removeIntegration', removeIntegration);
  command('codexCompletion.acknowledge', () => {
    state.acknowledge();
    record('acknowledged', { reason: 'command' });
    render();
  });
  command('codexCompletion.diagnostics', diagnostics);

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((windowState) => {
      const before = state.summary().unread;
      state.focus(windowState.focused);
      if (before && !state.summary().unread) record('acknowledged', { reason: 'focus' });
      if (windowState.focused) setup.refresh();
      render();
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const before = state.summary().unread;
      state.interaction(event.kind);
      if (before && !state.summary().unread) record('acknowledged', { reason: 'editor' });
      render();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codexCompletion')) {
        if (!config().enabled) state.acknowledge();
        render();
      }
    }),
    vscode.extensions.onDidChange(() => {
      setup.refresh();
      render();
    }),
  );

  if (process.platform === 'darwin' && !vscode.env.remoteName) {
    try {
      events = new CompletionEvents(vscode, (event) => {
        if (!config().enabled) return;
        state.complete(event);
        record('completion', { cwd: event.cwd, thread: event.thread, turn: event.turn });
        render();
      }).start();
    } catch (caught) {
      error = caught.message;
      output.appendLine(caught.stack || caught.message);
    }
  }

  controller = {
    async dispose() {
      disposed = true;
      clearTimeout(promptTimer);
      events?.dispose();
      presenter.dispose();
    },
  };

  render();
  promptTimer = setTimeout(() => {
    if (!disposed)
      setup.prompt().catch((caught) => {
        error = caught.message;
        output.appendLine(caught.stack || caught.message);
      });
  }, 1200);

  return {
    setupStatus: () => setup.status(),
    summary: () => state.summary(),
    host: process.pid,
    statusAction: () => status.command,
    presentation: () => presenter.snapshot(),
  };
}

async function deactivate() {
  if (controller) await controller.dispose();
}

module.exports = { activate, deactivate };
