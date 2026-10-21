'use strict';

class Setup {
  constructor(vscode, context, options) {
    this.vscode = vscode;
    this.context = context;
    this.options = options;
    this.busy = false;
    this.prompting = false;
  }
  status() {
    if (!this.options.enabled())
      return {
        code: 'disabled',
        label: 'Codex completion: Off',
        detail: 'Monitoring is disabled.',
      };
    const status = this.options.integration.status();
    const labels = {
      missingCodex: 'Codex completion: Install Codex',
      unsupported: 'Codex completion: Unsupported',
      migration: 'Codex completion: Migrate',
      conflict: 'Codex completion: Notify conflict',
      setup: 'Codex completion: Set up',
      repair: 'Codex completion: Repair',
      ready: 'Codex completion: Ready',
    };
    return { ...status, label: labels[status.code] };
  }
  refresh() {
    this.options.changed();
  }
  async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      let status = this.status();
      if (status.code === 'disabled') {
        const selected = await this.vscode.window.showInformationMessage(
          status.detail,
          'Enable Monitoring',
        );
        if (selected !== 'Enable Monitoring') return;
        await this.options.enable();
        status = this.status();
      }
      if (status.code === 'missingCodex') {
        await this.vscode.commands.executeCommand(
          'workbench.extensions.search',
          '@id:openai.chatgpt',
        );
        return;
      }
      if (status.code === 'unsupported') {
        await this.vscode.window.showWarningMessage(status.detail);
        return;
      }
      if (status.code === 'conflict') {
        const selected = await this.vscode.window.showWarningMessage(
          status.detail,
          'Clean Up Legacy',
          'Open Codex Config',
        );
        if (selected === 'Clean Up Legacy') {
          const removed = await this.options.integration.cleanupLegacy();
          await this.vscode.window.showInformationMessage(
            removed.proxy || removed.hooks.length
              ? 'Legacy Codex Activity hooks and proxy were removed.'
              : 'No legacy Codex Activity hooks or proxy were found.',
          );
        } else if (selected === 'Open Codex Config')
          await this.vscode.commands.executeCommand(
            'vscode.open',
            this.vscode.Uri.file(this.options.integration.config),
          );
        return;
      }
      const removed = await this.options.integration.migrate();
      await this.context.workspaceState.update('setupDismissed', undefined);
      const details = [
        removed.proxy ? 'the legacy executable proxy' : '',
        removed.hooks.length
          ? `${removed.hooks.length} legacy hook${removed.hooks.length === 1 ? '' : 's'}`
          : '',
      ].filter(Boolean);
      await this.vscode.window.showInformationMessage(
        `Completion-only monitoring is ready.${details.length ? ` Removed ${details.join(' and ')}.` : ''} Restart the current Codex chat to load the notification setting.`,
      );
    } finally {
      this.busy = false;
      this.options.changed();
    }
  }
  async prompt() {
    if (this.busy || this.prompting) return;
    const status = this.status();
    if (['ready', 'disabled', 'unsupported'].includes(status.code)) return;
    if (this.context.workspaceState.get('setupDismissed') === status.code) return;
    const action =
      status.code === 'migration' ? 'Migrate' : status.code === 'repair' ? 'Repair' : 'Set Up';
    this.prompting = true;
    try {
      const selected = await this.vscode.window.showInformationMessage(
        status.detail,
        action,
        'Not Now',
      );
      if (selected === action) await this.run();
      else await this.context.workspaceState.update('setupDismissed', status.code);
    } finally {
      this.prompting = false;
    }
  }
}

module.exports = { Setup };
