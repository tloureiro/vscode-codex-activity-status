'use strict';
const states = ['processing', 'approval', 'finished'];
const colorId = (state, part) => `codexActivity.${state}${part}`;

// Experimental: VS Code's public setter rejects custom item backgrounds. Keep
// this private capability isolated, checked, and limited to our own color IDs.
class StatusAppearance {
  constructor(vscode, item) {
    this.vscode = vscode;
    this.item = item;
    this.owned = new Map();
    this.disposed = false;
  }
  capability() {
    const map = this.item.constructor.ALLOWED_BACKGROUND_COLORS;
    return map instanceof Map &&
      map.get('statusBarItem.errorBackground')?.id === 'statusBarItem.errorForeground' &&
      map.get('statusBarItem.warningBackground')?.id === 'statusBarItem.warningForeground'
      ? map
      : null;
  }
  update(state, label, enabled = true) {
    if (this.disposed) return;
    const map = this.capability();
    const active = enabled && states.includes(state);
    this.limitation = '';
    if (map) {
      for (const name of states) {
        const key = colorId(name, 'Background');
        const owned = this.owned.get(key);
        if (map.has(key) && map.get(key) !== owned) {
          this.limitation = 'Custom status-item colors are owned by another presenter.';
          break;
        }
      }
      if (!this.limitation) {
        if (this.map && this.map !== map) this.release();
        this.map = map;
        for (const name of states) {
          const key = colorId(name, 'Background');
          const value =
            this.owned.get(key) || new this.vscode.ThemeColor(colorId(name, 'Foreground'));
          this.owned.set(key, value);
          map.set(key, value);
        }
      }
    } else {
      this.limitation =
        'This VS Code version does not expose the experimental status-item color capability.';
    }
    this.item.backgroundColor =
      active && !this.limitation
        ? new this.vscode.ThemeColor(colorId(state, 'Background'))
        : undefined;
    this.item.color = undefined;
    if (
      active &&
      !this.limitation &&
      this.item.backgroundColor?.id !== colorId(state, 'Background')
    ) {
      this.limitation = 'VS Code rejected the experimental status-item background.';
      this.item.backgroundColor = undefined;
    }
    this.item.text = label + (active && !this.limitation ? ' '.repeat(122) : '');
    this.state = active ? state : 'idle';
  }
  snapshot() {
    return {
      mode: 'statusItem',
      experimental: true,
      supported: !this.limitation,
      limitation: this.limitation || null,
      state: this.state,
      background: this.item.backgroundColor?.id || null,
    };
  }
  release() {
    for (const [key, value] of this.owned) if (this.map?.get(key) === value) this.map.delete(key);
    this.owned.clear();
  }
  dispose() {
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
    this.item.text = this.item.text.trimEnd();
    this.release();
    this.disposed = true;
  }
}
module.exports = { StatusAppearance };
