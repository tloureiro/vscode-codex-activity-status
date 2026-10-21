'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EVENT_PREFIX = 'completion-';

function runtimeRoot(tmp = os.tmpdir(), uid = process.getuid?.()) {
  if (!Number.isInteger(uid)) throw new Error('Completion notifications require a local user id.');
  const root = path.join(tmp, 'codex-completion-' + uid);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.mode & 0o077)
    throw new Error('Unsafe Codex completion runtime directory.');
  return root;
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function matchesWorkspace(cwd, folders, focused = false) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false;
  const local = (folders || []).filter((folder) => folder.uri?.scheme === 'file');
  if (!local.length) return focused;
  return local.some(
    (folder) => contains(folder.uri.fsPath, cwd) || contains(cwd, folder.uri.fsPath),
  );
}

class CompletionEvents {
  constructor(vscode, onEvent, options = {}) {
    this.vscode = vscode;
    this.onEvent = onEvent;
    this.root = options.root || runtimeRoot();
    this.seen = new Map();
    this.closed = false;
    this.startedAt = Date.now();
  }
  start() {
    const wake = () => queueMicrotask(() => this.scan());
    try {
      this.watcher = fs.watch(this.root, wake);
      this.watcher.on('error', () => this.fallback());
    } catch {
      this.fallback();
    }
    this.poll = setInterval(() => this.scan(), 1000);
    this.poll.unref();
    this.scan();
    return this;
  }
  fallback() {
    this.watcher?.close();
    this.watcher = null;
  }
  scan() {
    if (this.closed || this.scanning) return;
    this.scanning = true;
    try {
      const now = Date.now();
      for (const name of fs.readdirSync(this.root)) {
        if (!name.startsWith(EVENT_PREFIX) || !name.endsWith('.json')) continue;
        const file = path.join(this.root, name);
        if (this.seen.has(name)) continue;
        this.seen.set(name, now);
        try {
          const stat = fs.lstatSync(file);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.uid !== process.getuid() ||
            stat.size > 64 * 1024
          )
            continue;
          if (now - stat.mtimeMs > 10 * 60 * 1000) {
            fs.unlinkSync(file);
            continue;
          }
          // Do not resurrect an old completion merely because VS Code reloaded.
          if (stat.mtimeMs < this.startedAt - 2000) continue;
          const event = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (
            event.type === 'agent-turn-complete' &&
            matchesWorkspace(
              event.cwd,
              this.vscode.workspace.workspaceFolders,
              this.vscode.window.state.focused,
            )
          )
            this.onEvent(event);
        } catch {
          // A partial, malformed, or concurrently removed event is ignored.
        }
      }
      for (const [name, at] of this.seen) if (now - at > 15 * 60 * 1000) this.seen.delete(name);
    } catch {
      // The next poll retries a transient directory error.
    } finally {
      this.scanning = false;
    }
  }
  dispose() {
    this.closed = true;
    this.watcher?.close();
    clearInterval(this.poll);
  }
}

module.exports = { CompletionEvents, matchesWorkspace, runtimeRoot, EVENT_PREFIX };
