'use strict';
const fs = require('node:fs');
const vscode = require('vscode');
const { ProjectHooks, runtimeRoot, hash } = require('./project-hooks');
const { ActivityState } = require('./activity-state');
const { ActivityEvents } = require('./activity-events');
const { ActivityView, presentation } = require('./activity-view');
const { StatusPresenter } = require('./status-presenter');
const { Repair } = require('./repair');
let controller;
async function activate(context) {
  function settings() {
    const config = vscode.workspace.getConfiguration('codexActivity');
    return {
      enabled: context.workspaceState.get('activityEnabled', config.get('enabled', true)),
      autoAcknowledge: config.get('autoAcknowledge', false),
      nodePath: config.get('nodePath', ''),
      beaconWidth: config.get('beaconWidth', 24),
    };
  }
  const output = vscode.window.createOutputChannel('Codex Activity');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  status.name = 'Codex Activity';
  status.show();
  context.subscriptions.push(output, status);
  const presenter = new StatusPresenter(status);
  const projects = new Map();
  let selectedProject = context.workspaceState.get('activityProject');
  let selectedSession = null;
  let disposed = false;
  let promptTimer;
  let saveTimer;
  let focused = vscode.window.state.focused;
  let error = '';
  const trace = [];
  const selected = () => projects.get(selectedProject) || projects.values().next().value;
  function record(event, detail = {}) {
    trace.push({ at: new Date().toISOString(), event, ...detail });
    if (trace.length > 50) trace.shift();
  }
  function model() {
    const project = selected();
    return {
      enabled: settings().enabled,
      project: project?.hooks.project || null,
      projectName: project?.name || '',
      sessionId: selectedSession,
      health: project?.health || { code: 'unsupported', detail: 'Open a local macOS project.' },
      summary: project?.state.summary(Date.now(), selectedSession) || {
        state: 'idle',
        unread: 0,
        conversations: 0,
        connected: false,
      },
    };
  }
  const view = new ActivityView(model, (action) =>
    guarded(async () => {
      if (action === 'repair') await repair.run();
      if (action === 'acknowledge') await acknowledge();
      if (action === 'select') await chooseScope();
      if (action === 'openHooks') await openHooks();
    }),
  );
  context.subscriptions.push(
    view,
    vscode.window.registerWebviewViewProvider('codexActivity.panel', view),
  );
  function render() {
    if (disposed) return;
    const current = model();
    presenter.update(current, settings().beaconWidth);
    view.update();
  }
  async function guarded(action) {
    try {
      return await action();
    } catch (caught) {
      error = caught.message;
      output.appendLine(caught.stack || caught.message);
      await vscode.window.showErrorMessage('Codex Activity: ' + caught.message);
      render();
    }
  }
  function persist() {
    clearTimeout(saveTimer);
    if (!disposed)
      saveTimer = setTimeout(
        () => save().catch((caught) => output.appendLine(caught.message)),
        700,
      );
  }
  async function save() {
    for (const project of projects.values())
      await context.workspaceState.update(project.key, project.state.serialize());
  }
  function refresh() {
    if (disposed) return;
    const local =
      process.platform === 'darwin' && !vscode.env.remoteName && vscode.workspace.isTrusted
        ? (vscode.workspace.workspaceFolders || []).filter((folder) => folder.uri.scheme === 'file')
        : [];
    const retained = new Set();
    for (const folder of local) {
      try {
        const hooks = new ProjectHooks(folder.uri.fsPath, context.extensionPath);
        const id = hooks.project;
        retained.add(id);
        let project = projects.get(id);
        if (!project) {
          const key = 'activityState.' + hash(id).slice(0, 24);
          project = {
            hooks,
            name: folder.name,
            key,
            state: new ActivityState(context.workspaceState.get(key, [])),
          };
          projects.set(id, project);
        }
        project.health = hooks.status();
        const shouldListen = settings().enabled && project.health.code === 'installed';
        if (!shouldListen) {
          project.events?.dispose();
          project.events = null;
        }
        if (shouldListen && !project.events) {
          try {
            const root = runtimeRoot(hooks.project);
            if (root !== project.health.manifest.root)
              throw new Error('Temporary storage location changed. Update the project helper.');
            project.events = new ActivityEvents(
              project.health.manifest,
              (event) => {
                if (disposed || !settings().enabled) return;
                project.state.accept(event);
                record(event.event, {
                  project: project.name,
                  sessionId: event.sessionId,
                  turnId: event.turnId,
                });
                persist();
                render();
              },
              (sessionId, payload, at) => {
                if (disposed || !settings().enabled) return;
                if (project.state.terminal(sessionId, payload, at)) {
                  record('terminal', { project: project.name, sessionId, turnId: payload.turn_id });
                  persist();
                  render();
                }
              },
              {
                onError: (caught) => {
                  project.events = null;
                  project.health = { code: 'error', detail: caught.message };
                  error = caught.message;
                  render();
                },
              },
            ).start();
          } catch (caught) {
            project.health = { code: 'error', detail: caught.message };
          }
        }
      } catch (caught) {
        error = caught.message;
        output.appendLine(caught.message);
      }
    }
    for (const [id, project] of projects)
      if (!retained.has(id)) {
        project.events?.dispose();
        projects.delete(id);
      }
    if (!projects.has(selectedProject)) {
      selectedProject = projects.keys().next().value;
      selectedSession = null;
    }
    render();
  }
  async function chooseProject() {
    if (!projects.size) throw new Error('Open a trusted local macOS project first.');
    if (projects.size === 1) return selected();
    const picked = await vscode.window.showQuickPick(
      [...projects.values()].map((project) => ({
        label: project.name,
        description: project.hooks.project,
        project,
      })),
      { title: 'Choose project for Codex Activity' },
    );
    if (!picked) return null;
    selectedProject = picked.project.hooks.project;
    selectedSession = null;
    await context.workspaceState.update('activityProject', selectedProject);
    render();
    return picked.project;
  }
  const repair = new Repair(vscode, context, {
    refresh,
    available: () => projects.size > 0,
    chooseProject,
    settings,
    disposed: () => disposed,
    openHooks,
    stop: (project) => {
      project.events?.dispose();
      project.events = null;
    },
    installed: (project) =>
      context.workspaceState.update(
        'activitySetupDismissed.' + hash(project.hooks.project).slice(0, 24),
        true,
      ),
  });
  async function acknowledge() {
    selected()?.state.acknowledge(selectedSession);
    record('acknowledged');
    await save();
    render();
  }
  async function chooseScope() {
    const project = await chooseProject();
    if (!project) return;
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'All project conversations', sessionId: null },
        ...project.state.sessions().map((sessionId) => ({
          label: 'Thread ' + sessionId.slice(0, 8),
          description: sessionId,
          sessionId,
        })),
      ],
      { title: 'Activity scope · ' + project.name },
    );
    if (choice) {
      selectedSession = choice.sessionId;
      render();
    }
  }
  async function openHooks() {
    const project = selected();
    if (project && fs.existsSync(project.hooks.hooksFile))
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(project.hooks.hooksFile));
  }
  function diagnostics() {
    output.appendLine(
      JSON.stringify(
        {
          version: context.extension.packageJSON.version,
          vscode: vscode.version,
          model: model(),
          projects: [...projects.values()].map((project) => ({
            project: project.hooks.project,
            status: project.health.code,
          })),
          recentEvents: trace,
          error,
        },
        null,
        2,
      ),
    );
    output.show(true);
  }
  const commands = {
    'codexActivity.show': () => vscode.commands.executeCommand('codexActivity.panel.focus'),
    'codexActivity.repair': () => repair.run(),
    // Keep old keybindings callable without contributing palette entries.
    'codexActivity.installProjectHooks': () => repair.run(),
    'codexActivity.removeProjectHooks': () => repair.run('remove'),
    'codexActivity.acknowledge': acknowledge,
    'codexActivity.chooseScope': chooseScope,
    'codexActivity.diagnostics': diagnostics,
    'codexActivity.openHooks': openHooks,
    'codexCompletion.setup': () => repair.run(),
    'codexCompletion.acknowledge': acknowledge,
    'codexCompletion.diagnostics': diagnostics,
    'codexCompletion.cleanupLegacy': () => repair.run(),
    'codexCompletion.removeIntegration': () => repair.run(),
  };
  for (const [id, action] of Object.entries(commands))
    context.subscriptions.push(vscode.commands.registerCommand(id, () => guarded(action)));
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.workspace.onDidChangeConfiguration((event) =>
      guarded(async () => {
        if (event.affectsConfiguration('codexActivity.enabled'))
          await context.workspaceState.update('activityEnabled', undefined);
        if (event.affectsConfiguration('codexActivity')) refresh();
      }),
    ),
    vscode.window.onDidChangeWindowState((state) => {
      const returned = state.focused && !focused;
      focused = state.focused;
      if (returned && settings().autoAcknowledge) guarded(acknowledge);
      if (state.focused) refresh();
    }),
  );
  const timer = setInterval(render, 2000);
  timer.unref();
  refresh();
  promptTimer = setTimeout(
    () =>
      guarded(async () => {
        const project = selected();
        if (!project || !settings().enabled || project.health.code !== 'setup') return;
        const key = 'activitySetupDismissed.' + hash(project.hooks.project).slice(0, 24);
        if (context.workspaceState.get(key)) return;
        const choice = await vscode.window.showInformationMessage(
          'Show Codex project activity as a colored status-bar strip?',
          'Review Hook Setup',
          'Not Now',
        );
        if (choice === 'Review Hook Setup') await repair.run();
        else await context.workspaceState.update(key, true);
      }),
    1200,
  );
  controller = {
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(promptTimer);
      clearTimeout(saveTimer);
      clearInterval(timer);
      for (const project of projects.values()) project.events?.dispose();
      await save();
    },
  };
  context.subscriptions.push(controller);
  return {
    setupStatus: () => selected()?.health || { code: 'unsupported' },
    summary: () => model().summary,
    presentation: () => presentation(model()),
    beacon: () => presenter.snapshot(),
    panelVisible: () => Boolean(view.view?.visible),
    host: process.pid,
    statusAction: () => status.command,
  };
}
async function deactivate() {
  await controller?.dispose();
}
module.exports = { activate, deactivate };
