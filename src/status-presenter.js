'use strict';

class StatusPresenter {
  constructor(vscode, item) {
    this.vscode = vscode;
    this.item = item;
  }
  update(finished, label, enabled = true) {
    this.item.color =
      enabled && finished
        ? new this.vscode.ThemeColor('codexCompletion.finishedForeground')
        : undefined;
    this.item.text = enabled && finished ? `$(check) ${label}` : label;
    this.state = enabled && finished ? 'finished' : 'idle';
  }
  snapshot() {
    return {
      state: this.state,
      foreground: this.item.color?.id || null,
    };
  }
  dispose() {
    this.item.color = undefined;
  }
}

module.exports = { StatusPresenter };
