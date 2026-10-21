'use strict';

class CompletionState {
  constructor() {
    this.unread = new Map();
    this.focused = false;
    this.autoAcknowledge = true;
  }
  complete(event) {
    const key = event.thread || event.turn || `${event.cwd}:${event.at}`;
    this.unread.set(key, event.turn || event.at);
  }
  focus(focused) {
    const returned = focused && !this.focused;
    this.focused = focused;
    if (returned && this.autoAcknowledge) this.acknowledge();
  }
  interaction(kind) {
    if (
      this.focused &&
      this.autoAcknowledge &&
      (kind === 1 || kind === 2 || kind === 'Keyboard' || kind === 'Mouse')
    )
      this.acknowledge();
  }
  acknowledge() {
    this.unread.clear();
  }
  summary() {
    return { state: this.unread.size ? 'finished' : 'idle', unread: this.unread.size };
  }
}

module.exports = { CompletionState };
