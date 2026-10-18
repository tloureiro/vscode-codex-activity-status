'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runtimeRoot, alive } = require('./bridge');
const { atomicJson } = require('./appearance');

function canonical(file) {
  let parent = path.resolve(file);
  const missing = [];
  while (!fs.existsSync(parent)) {
    missing.unshift(path.basename(parent));
    parent = path.dirname(parent);
  }
  return path.join(fs.realpathSync(parent), ...missing);
}
function appearanceTarget(vscode) {
  const workspace = vscode.workspace.workspaceFile;
  if (workspace?.scheme === 'file')
    return { file: canonical(workspace.fsPath), container: 'workspace' };
  if (workspace) return null; // An untitled/virtual workspace must be saved first.
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length !== 1 || folders[0].uri.scheme !== 'file') return null;
  return {
    file: canonical(path.join(folders[0].uri.fsPath, '.vscode', 'settings.json')),
    container: 'folder',
  };
}

// Every local extension host using the same appearance file registers itself.
// File-system events pause coloring in ALL participants when the file is shared.
class ColorLease {
  constructor(file, changed, root = runtimeRoot()) {
    this.id = crypto.createHash('sha256').update(canonical(file)).digest('hex').slice(0, 24);
    this.directory = path.join(root, 'colors-' + this.id);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.owner = { pid: process.pid, token: crypto.randomBytes(24).toString('hex') };
    this.member = path.join(this.directory, process.pid + '-' + this.owner.token + '.json');
    this.journalPath = path.join(root, 'appearance-' + this.id + '.json');
    this.closed = false;
    this.exclusive = false;
    this.changed = changed;
    // Some macOS hosts exhaust filesystem watcher capacity. Fall back to
    // watching this small registry directory's mtime, never project contents.
    const fallback = () => {
      if (this.closed || this.poll) return;
      this.watcher?.close();
      this.poll = () => this.refresh();
      fs.watchFile(this.directory, { interval: 500, persistent: false }, this.poll);
      this.refresh();
    };
    try {
      this.watcher = fs.watch(this.directory, () => this.refresh());
      this.watcher.on('error', fallback);
    } catch {
      fallback();
    }
    atomicJson(this.member, this.owner);
    this.refresh();
    // Also reconcile once a second: macOS can coalesce/drop directory events,
    // and a dead host may not remove its registration. This bounded scan reads
    // only the tiny registration directory for this settings file.
    this.reconcile = setInterval(() => this.refresh(), 1000);
    this.reconcile.unref();
  }
  refresh() {
    if (this.closed) return;
    let count = 0,
      names;
    try {
      names = fs.readdirSync(this.directory);
    } catch {
      this.exclusive = false;
      this.changed();
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(this.directory, name);
      try {
        const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
        // Wait for a surviving watchdog to restore before another window writes.
        if (alive(owner.pid) || (owner.watchdog && alive(owner.watchdog))) count++;
        else fs.unlinkSync(file);
      } catch {
        count++;
      } // Uncertain ownership must not permit shared writes.
    }
    const exclusive = count === 1;
    if (this.exclusive !== exclusive) {
      this.exclusive = exclusive;
      this.changed();
    }
  }
  setWatchdog(pid) {
    this.owner.watchdog = pid;
    atomicJson(this.member, this.owner);
  }
  dispose(release = true) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.reconcile);
    this.watcher?.close();
    if (this.poll) fs.unwatchFile(this.directory, this.poll);
    if (release) {
      try {
        fs.unlinkSync(this.member);
      } catch {
        /* Already recovered. */
      }
    }
  }
}
module.exports = { ColorLease, appearanceTarget, canonical };
