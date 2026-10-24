'use strict';
const { presentation } = require('./activity-view');

class StatusPresenter {
  constructor(item) {
    this.item = item;
  }
  update(model, width = 24) {
    const p = presentation(model);
    const active =
      model.enabled &&
      model.health.code === 'installed' &&
      (model.summary.connected || model.summary.unread > 0) &&
      ['working', 'attention', 'finished', 'failed'].includes(model.summary.state);
    const blocks = Math.max(8, Math.min(48, Number.isFinite(width) ? Math.round(width) : 24));
    this.item.text = `${active ? '█'.repeat(blocks) : '$(pulse)'} Codex: ${p.title.toLowerCase()}`;
    this.item.color = active ? p.color : undefined;
    this.item.command =
      !model.enabled || !model.project
        ? 'codexActivity.diagnostics'
        : ['setup', 'repair'].includes(model.health.code)
          ? 'codexActivity.installProjectHooks'
          : model.health.code === 'conflict'
            ? 'codexActivity.openHooks'
            : model.summary.unread > 0
              ? 'codexActivity.acknowledge'
              : model.summary.connected
                ? 'chatgpt.openSidebar'
                : 'codexActivity.chooseScope';
    const action =
      this.item.command === 'codexActivity.acknowledge'
        ? 'Click to acknowledge.'
        : this.item.command === 'codexActivity.installProjectHooks'
          ? 'Click to review project hook setup.'
          : this.item.command === 'chatgpt.openSidebar'
            ? 'Click to open Codex.'
            : 'Click for details.';
    this.item.tooltip = `${p.detail}${model.projectName ? '\nProject: ' + model.projectName : ''}${model.summary.unread ? '\nUnread outcomes: ' + model.summary.unread : ''}\n${action}`;
    this.item.accessibilityInformation = {
      label: `Codex Activity: ${p.title}. ${p.detail}. ${action}`,
      role: 'button',
    };
    this.state = active ? model.summary.state : 'neutral';
  }
  snapshot() {
    return {
      state: this.state,
      text: this.item.text,
      color: this.item.color || null,
      command: this.item.command,
    };
  }
  dispose() {
    this.item.color = undefined;
  }
}

module.exports = { StatusPresenter };
