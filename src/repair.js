'use strict';
const { Integration } = require('./integration');
const { resolveNode } = require('./project-hooks');

// One maintenance path for palette commands, setup prompts and old command IDs.
class Repair {
  constructor(vscode, context, options) {
    this.vscode = vscode;
    this.context = context;
    this.options = options;
    this.busy = false;
  }
  async run(mode = 'repair') {
    if (this.busy) return;
    this.busy = true;
    try {
      this.options.refresh();
      const available = this.options.available();
      const project = available ? await this.options.chooseProject() : null;
      if (available && !project) return;
      const integration = new Integration(this.vscode, this.context);
      const legacy = integration.plan();
      const status = project
        ? project.hooks.status()
        : {
            code: 'conflict',
            detail: 'Open a trusted local macOS project to set up or repair project hooks.',
          };
      const canChange = status.code !== 'conflict';
      let plan;
      let problem = canChange ? '' : status.detail;
      if (mode === 'repair' && canChange) {
        try {
          if (!this.vscode.extensions.getExtension('openai.chatgpt'))
            throw new Error('Install the official Codex extension first.');
          const node = await resolveNode(this.options.settings().nodePath);
          plan = project.hooks.plan(node);
        } catch (error) {
          problem = error.message;
        }
      }
      const repair = 'Repair and Set Up';
      const remove = 'Remove Project Hooks';
      const cleanup = 'Clean Up Legacy Only';
      const review = 'Review Project Hooks';
      const actions = [
        ...(plan ? [repair] : []),
        ...(canChange && status.manifest ? [remove] : []),
        ...(legacy.needed ? [cleanup] : []),
        ...(project ? [review] : []),
      ];
      if (!actions.length) {
        await this.vscode.window.showInformationMessage(
          status.detail + ' No legacy integration found.',
        );
        return;
      }
      const choice = await this.vscode.window.showWarningMessage(
        `Codex Activity: ${project ? (mode === 'remove' ? 'remove hooks' : 'repair or set up') + ' for ' + project.name : 'clean up legacy integration'}?`,
        {
          modal: true,
          detail: [
            problem,
            plan
              ? `Repair installs or updates .codex/hooks.json, the .codex/codex-activity/ helper and .codex/.gitignore (including its self-ignore rule) in this project. Restores missing owned files, updates old labels, runtime and storage paths, and enables monitoring in VS Code storage without writing workspace settings. Node: ${plan.node}.`
              : '',
            `Legacy scan: ${legacy.detail}`,
            legacy.needed
              ? 'Repair also removes recognized old notify blocks, TOML/JSON activity or sound hooks and old helper files from Codex user configuration/storage, and restores an executable override only if still owned by this extension. Clean Up Legacy Only performs just that cleanup.'
              : '',
            'Removal deletes only unchanged owned project hooks and helper files; ignore rules and Codex trust records remain. Unrelated or edited files are preserved. Git ignores cannot untrack previously tracked files.',
            'After repair, review the seven “Codex Activity — …” hooks in Codex settings → Hooks and start a new chat. Codex trust remains a separate review.',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        ...actions,
      );
      if (!choice || this.options.disposed()) return;
      if (choice === review) return this.options.openHooks();
      if (!this.vscode.workspace.isTrusted)
        throw new Error('Workspace trust changed. Maintenance was cancelled.');
      if (choice === repair && plan) {
        // Validate both scopes before either is changed.
        project.hooks.check(plan);
        integration.check(legacy);
        if (legacy.needed) await integration.remove(legacy);
        if (this.options.disposed()) return;
        if (!this.vscode.workspace.isTrusted)
          throw new Error('Workspace trust changed. Project setup was cancelled.');
        this.options.stop(project);
        project.hooks.install(plan);
        await this.context.workspaceState.update('activityEnabled', true);
        await this.options.installed(project);
        await this.vscode.window.showInformationMessage(
          "Activity repaired. In Codex settings → Hooks, review this project's seven “Codex Activity — …” hooks and allow them, then start a new chat. Activity appears in the existing status bar.",
        );
      } else if (choice === remove && canChange && status.manifest) {
        this.options.stop(project);
        project.hooks.remove();
        await this.vscode.window.showInformationMessage(
          'Project hooks removed. Restart the Codex chat to reload its configuration.',
        );
      } else if (choice === cleanup && legacy.needed) {
        await integration.remove(legacy);
        await this.vscode.window.showInformationMessage(
          'Legacy integration cleaned up. Restart Codex to reload its configuration.',
        );
      }
    } finally {
      this.busy = false;
      this.options.refresh();
    }
  }
}

module.exports = { Repair };
