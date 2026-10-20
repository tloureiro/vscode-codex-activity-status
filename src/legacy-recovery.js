'use strict';
const fs = require('node:fs');
const { Appearance } = require('./appearance');
const { ColorLease } = require('./color-lease');

// Only the retiring full-bar adapter needs settings access. Never apply a new
// overlay, and never take a journal from a surviving old host or watchdog.
class LegacyRecovery {
  constructor(vscode, target, changed, options = {}) {
    this.vscode = vscode;
    this.target = target;
    this.changed = changed;
    this.options = options;
    this.queue = Promise.resolve();
    this.detail = null;
  }
  async start() {
    if (!this.target) return;
    try {
      this.lease = new ColorLease(
        this.target.file,
        () => {
          // ColorLease may notify before its constructor returns.
          queueMicrotask(() => this.retry());
        },
        this.options.root,
      );
      await this.retry();
    } catch (error) {
      this.detail = 'Previous full-bar appearance recovery: ' + error.message;
      this.changed();
    }
  }
  retry() {
    if (!this.lease || this.disposed) return this.queue;
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.disposed || !this.lease) return;
        try {
          for (const journalPath of [
            this.lease.journalPath,
            this.target.file + '.appearance.json',
          ]) {
            if (!fs.existsSync(journalPath)) continue;
            if (!this.lease.exclusive) {
              this.detail =
                'Waiting for an older window or recovery helper to release full-bar colors. Reload other monitored windows.';
              this.changed();
              return;
            }
            const recovery = new Appearance(this.vscode, this.target.file, {
              verifyDisk: true,
              journalPath,
              container: this.target.container,
              canRestoreOther: () => this.lease?.exclusive === true,
            });
            await recovery.update('unknown', {});
            if (fs.existsSync(journalPath))
              throw new Error('Full-bar recovery journal is still pending.');
          }
          this.detail = null;
          this.lease.dispose();
          this.lease = null;
        } catch (error) {
          this.detail = 'Previous full-bar appearance recovery: ' + error.message;
        }
        this.changed();
      });
    return this.queue;
  }
  async dispose() {
    this.disposed = true;
    await this.queue;
    this.lease?.dispose();
    this.lease = null;
  }
}
module.exports = { LegacyRecovery };
