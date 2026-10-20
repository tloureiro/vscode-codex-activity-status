'use strict';
const fs = require('node:fs');
const path = require('node:path');
const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";

function bridgePlan(context, official, execPath = process.execPath, arch = process.arch) {
  const launcher = path.join(context.globalStorageUri.fsPath, 'codex-activity-proxy');
  const real = path.join(
    official.extensionPath,
    'bin',
    arch === 'arm64' ? 'macos-aarch64' : 'macos-x86_64',
    'codex',
  );
  const script = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(execPath)} ${quote(path.join(context.extensionPath, 'src', 'proxy.js'))} ${quote(real)} "$@"\n`;
  return { launcher, real, script };
}

class Setup {
  constructor(vscode, context, options) {
    this.vscode = vscode;
    this.context = context;
    this.options = options;
    this.busy = false;
    this.prompting = false;
    this.refresh();
  }
  refresh() {
    const official = this.vscode.extensions.getExtension('openai.chatgpt');
    this.plan = official ? bridgePlan(this.context, official) : null;
    this.official = official;
    this.bridgeIssue = '';
    const configured = this.vscode.workspace.getConfiguration('chatgpt').get('cliExecutable');
    if (!official) this.bridgeIssue = 'missingCodex';
    else if (configured && configured !== this.plan.launcher) this.bridgeIssue = 'conflict';
    else if (!configured) this.bridgeIssue = 'bridge';
    else {
      try {
        fs.accessSync(this.plan.launcher, fs.constants.X_OK);
        fs.accessSync(this.plan.real, fs.constants.X_OK);
        if (fs.readFileSync(this.plan.launcher, 'utf8') !== this.plan.script)
          this.bridgeIssue = 'repair';
      } catch {
        this.bridgeIssue = 'repair';
      }
    }
  }
  status() {
    if (!this.options.enabled())
      return { code: 'disabled', label: 'Codex: Off', detail: 'Activity monitoring is disabled.' };
    if (process.platform !== 'darwin' || this.vscode.env.remoteName)
      return {
        code: 'unsupported',
        label: 'Codex: Unsupported',
        detail: 'Activity colors currently support local macOS desktop VS Code.',
      };
    const error = this.options.error();
    if (error) return { code: 'error', label: 'Codex: Monitoring Unavailable', detail: error };
    const messages = {
      missingCodex: [
        'Codex: Install Codex',
        'Install the official OpenAI Codex extension to enable activity colors.',
      ],
      conflict: [
        'Codex: Setup Conflict',
        'Codex has a custom executable configured. Activity setup will not overwrite it.',
      ],
      bridge: [
        'Codex: Set Up Colors',
        'Activity colors are not configured. Set up the connection to enable colors in this window.',
      ],
      repair: [
        'Codex: Repair Setup',
        'The activity connection needs repair after an update or a missing launcher.',
      ],
    };
    if (this.bridgeIssue) {
      const [label, detail] = messages[this.bridgeIssue];
      return { code: this.bridgeIssue, label, detail };
    }
    if (!this.options.workspaceReady)
      return {
        code: 'workspace',
        label: 'Codex: Open a Folder',
        detail:
          'Open a local folder or save this workspace to enable activity colors in this window.',
      };
    if (this.options.colorConflict?.())
      return {
        code: 'shared',
        label: 'Codex: Shared Workspace',
        detail:
          'Full-bar colors are paused because another monitored window shares these workspace settings. VS Code cannot color those windows independently. Activity tracking remains per window.',
      };
    if (!this.options.connected())
      return {
        code: 'waiting',
        label: 'Codex: Waiting for Connection',
        detail:
          'Colors are inactive until Codex connects in this window. Open Codex; if it is already open, reload this window.',
      };
    return { code: 'ready', detail: 'Activity monitoring is connected in this window.' };
  }
  async ensureBridge() {
    if (process.platform !== 'darwin' || this.vscode.env.remoteName)
      throw new Error('Activity colors currently support local macOS desktop VS Code.');
    this.refresh();
    if (!this.official) throw new Error('Install the official OpenAI Codex extension first.');
    if (this.bridgeIssue === 'conflict')
      throw new Error(
        'chatgpt.cliExecutable already has a custom value. Activity setup will not overwrite it.',
      );
    if (!this.bridgeIssue) return false;
    const { launcher, real, script } = this.plan;
    fs.accessSync(real, fs.constants.X_OK);
    const c = this.vscode.workspace.getConfiguration('chatgpt');
    const previous = c.inspect('cliExecutable')?.globalValue;
    // Save the original before changing the setting. Repairs never replace it.
    if (!this.context.globalState.get('bridge')) {
      await this.context.globalState.update('bridge', {
        launcher,
        previous: previous === undefined ? null : previous,
        had: previous !== undefined && previous !== launcher,
      });
    }
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, script, { mode: 0o700 });
    fs.chmodSync(launcher, 0o700);
    if (previous !== launcher)
      await c.update('cliExecutable', launcher, this.vscode.ConfigurationTarget.Global);
    this.refresh();
    this.options.changed();
    return true;
  }
  async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.refresh();
      let s = this.status();
      if (s.code === 'disabled') {
        const chosen = await this.vscode.window.showInformationMessage(
          s.detail,
          'Enable Monitoring',
        );
        if (chosen !== 'Enable Monitoring') return;
        const c = this.vscode.workspace.getConfiguration('codexActivity');
        const target =
          c.inspect('enabled')?.workspaceValue !== undefined
            ? this.vscode.ConfigurationTarget.Workspace
            : this.vscode.ConfigurationTarget.Global;
        await c.update('enabled', true, target);
        s = this.status();
      }
      if (s.code === 'unsupported') {
        await this.vscode.window.showWarningMessage(s.detail);
        return;
      }
      if (s.code === 'missingCodex') {
        await this.vscode.commands.executeCommand(
          'workbench.extensions.search',
          '@id:openai.chatgpt',
        );
        return;
      }
      if (s.code === 'conflict') {
        const chosen = await this.vscode.window.showWarningMessage(s.detail, 'Open Codex Settings');
        if (chosen)
          await this.vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'chatgpt.cliExecutable',
          );
        return;
      }
      if (s.code === 'workspace') {
        await this.vscode.commands.executeCommand('workbench.action.saveWorkspaceAs');
        return;
      }
      if (s.code === 'shared') {
        await this.vscode.window.showInformationMessage(s.detail);
        return;
      }
      if (s.code === 'error') {
        await this.options.diagnostics();
        return;
      }
      const changed = await this.ensureBridge();
      if (!changed && this.options.connected()) {
        await this.options.diagnostics();
        return;
      }
      await this.vscode.commands.executeCommand('chatgpt.openSidebar');
      if (this.options.connected()) return;
      const action = await this.vscode.window.showInformationMessage(
        'Activity setup is complete. If Codex does not connect, reload this window to start monitoring.',
        'Reload Window',
      );
      if (action === 'Reload Window')
        await this.vscode.commands.executeCommand('workbench.action.reloadWindow');
    } finally {
      this.busy = false;
      this.options.changed();
    }
  }
  async prompt() {
    if (this.busy || this.prompting) return;
    this.refresh();
    this.options.changed();
    const s = this.status();
    if (['ready', 'disabled', 'unsupported', 'error'].includes(s.code)) return;
    if (this.context.workspaceState.get('setupDismissed') === s.code) return;
    const actions =
      s.code === 'waiting'
        ? ['Open Codex', 'Reload Window']
        : [
            s.code === 'missingCodex'
              ? 'Find Codex'
              : s.code === 'conflict'
                ? 'Review Setup'
                : s.code === 'workspace'
                  ? 'Save Workspace'
                  : s.code === 'shared'
                    ? 'Show Explanation'
                    : 'Set Up Activity Colors',
          ];
    const detail = ['bridge', 'repair'].includes(s.code)
      ? s.detail +
        ' Setup configures Codex for this VS Code profile. You keep working in this window.'
      : s.detail;
    this.prompting = true;
    try {
      const chosen = await this.vscode.window.showInformationMessage(detail, ...actions, 'Not Now');
      if (!chosen || chosen === 'Not Now') {
        await this.context.workspaceState.update('setupDismissed', s.code);
        return;
      }
      if (chosen === 'Reload Window')
        await this.vscode.commands.executeCommand('workbench.action.reloadWindow');
      else if (chosen === 'Open Codex')
        await this.vscode.commands.executeCommand('chatgpt.openSidebar');
      else await this.run();
    } finally {
      this.prompting = false;
    }
  }
}
module.exports = { Setup, bridgePlan };
