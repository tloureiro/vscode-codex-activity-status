'use strict';
const fs = require('node:fs');
const vscode = require('vscode');
const { ProjectHooks, resolveNode, runtimeRoot, hash } = require('./project-hooks');
const { ActivityState } = require('./activity-state');
const { ActivityEvents } = require('./activity-events');
const { ActivityView, presentation } = require('./activity-view');
const { StatusPresenter } = require('./status-presenter');
const { Integration } = require('./integration');
let controller;
function settings() {
  const config = vscode.workspace.getConfiguration('codexActivity');
  return {
    enabled: config.get('enabled', true),
    autoAcknowledge: config.get('autoAcknowledge', false),
    nodePath: config.get('nodePath', ''),
    beaconWidth: config.get('beaconWidth', 24),
  };
}
async function activate(context) {
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
  let busy = false;
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
      if (action === 'install') await install();
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
  async function install() {
    if (busy) return;
    busy = true;
    try {
      refresh();
      const project = await chooseProject();
      if (!project) return;
      if (!vscode.extensions.getExtension('openai.chatgpt'))
        throw new Error('Install the official Codex extension first.');
      if (project.health.code === 'conflict') {
        await vscode.window.showWarningMessage(project.health.detail);
        return;
      }
      const node = await resolveNode(settings().nodePath);
      const plan = project.hooks.plan(node);
      const choice = await vscode.window.showWarningMessage(
        `Install activity hooks for ${project.name}?`,
        {
          modal: true,
          detail: `Creates or updates this extension's .codex/hooks.json and .codex/codex-activity/ helper, and adds ignore rules to .codex/.gitignore. Existing unrelated hook files are never overwritten. Git ignores do not untrack previously tracked files.\n\nSeven background hooks send only activity metadata to local storage. Node runtime: ${node}. No proxy, executable override, or automatic changes to your Codex user configuration.\n\nAfter installation, open Codex settings → Hooks in the VS Code Codex sidebar. Review this project's seven hooks labelled "Codex Activity — …" and allow them, then start a new chat. Updated definitions may need approval again. Codex manages that separate trust configuration.`,
        },
        'Install Project Hooks',
      );
      if (choice !== 'Install Project Hooks' || disposed) return;
      if (!vscode.workspace.isTrusted)
        throw new Error('Workspace trust changed. Setup was cancelled.');
      project.hooks.install(plan);
      if (!settings().enabled)
        await vscode.workspace
          .getConfiguration('codexActivity')
          .update('enabled', true, vscode.ConfigurationTarget.Workspace);
      await context.workspaceState.update(
        'activitySetupDismissed.' + hash(project.hooks.project).slice(0, 24),
        true,
      );
      refresh();
      const next = await vscode.window.showInformationMessage(
        'Project hooks installed. Open Codex settings → Hooks, review this project\'s "Codex Activity — …" hooks and allow them, then start a new chat. Activity colors appear in the existing status bar.',
        'Open Codex',
      );
      if (next === 'Open Codex') await vscode.commands.executeCommand('chatgpt.openSidebar');
    } finally {
      busy = false;
    }
  }
  async function removeProjectHooks() {
    if (busy) return;
    busy = true;
    try {
      const project = await chooseProject();
      if (!project) return;
      const choice = await vscode.window.showWarningMessage(
        `Remove activity hooks from ${project.name}?`,
        {
          modal: true,
          detail:
            'Removes only the unchanged hook registration and helper files installed by this extension. Edited or unrelated files are preserved. Local Git ignore rules remain. Codex trust records are left unchanged.',
        },
        'Remove Project Hooks',
      );
      if (choice !== 'Remove Project Hooks') return;
      project.events?.dispose();
      project.events = null;
      project.hooks.remove();
      refresh();
      await vscode.window.showInformationMessage(
        'Project hooks removed. Restart the current Codex chat to reload its configuration.',
      );
    } finally {
      busy = false;
    }
  }
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
  async function legacy(removeNotify) {
    const choice = await vscode.window.showWarningMessage(
      removeNotify
        ? 'Remove the legacy completion integration?'
        : 'Remove legacy proxy and activity hooks?',
      {
        modal: true,
        detail:
          'This explicitly cleans recognized old integration entries in your Codex user configuration and restores an old executable override only if it still belongs to this extension. Unrelated settings are preserved. New project hooks are not touched.',
      },
      'Remove Legacy Integration',
    );
    if (choice !== 'Remove Legacy Integration') return;
    const integration = new Integration(vscode, context);
    if (removeNotify) await integration.remove();
    else await integration.cleanupLegacy();
    await vscode.window.showInformationMessage(
      'Legacy integration cleaned up. Restart Codex to reload its configuration.',
    );
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
    'codexActivity.installProjectHooks': install,
    'codexActivity.removeProjectHooks': removeProjectHooks,
    'codexActivity.acknowledge': acknowledge,
    'codexActivity.chooseScope': chooseScope,
    'codexActivity.diagnostics': diagnostics,
    'codexActivity.openHooks': openHooks,
    'codexCompletion.setup': install,
    'codexCompletion.acknowledge': acknowledge,
    'codexCompletion.diagnostics': diagnostics,
    'codexCompletion.cleanupLegacy': () => legacy(false),
    'codexCompletion.removeIntegration': () => legacy(true),
  };
  for (const [id, action] of Object.entries(commands))
    context.subscriptions.push(vscode.commands.registerCommand(id, () => guarded(action)));
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codexActivity')) refresh();
    }),
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
        if (choice === 'Review Hook Setup') await install();
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
