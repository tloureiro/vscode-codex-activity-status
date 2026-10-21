#!/usr/bin/env node
'use strict';
// This file is copied to persistent extension storage. Keep it standalone.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main(raw) {
  const source = JSON.parse(raw || '{}');
  if (source.type !== 'agent-turn-complete') return;
  const event = {
    type: source.type,
    thread: typeof source['thread-id'] === 'string' ? source['thread-id'] : '',
    turn: typeof source['turn-id'] === 'string' ? source['turn-id'] : '',
    cwd: typeof source.cwd === 'string' ? source.cwd : '',
    at: new Date().toISOString(),
  };
  const uid = process.getuid();
  const root = path.join(os.tmpdir(), 'codex-completion-' + uid);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.mode & 0o077)
    throw new Error('Unsafe Codex completion runtime directory.');
  const id = `${Date.now()}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const temporary = path.join(root, '.completion-' + id);
  const target = path.join(root, 'completion-' + id + '.json');
  fs.writeFileSync(temporary, JSON.stringify(event), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, target);
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith('completion-') || !name.endsWith('.json')) continue;
    const file = path.join(root, name);
    try {
      if (fs.lstatSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    } catch {
      // Another notifier or extension window may have cleaned it already.
    }
  }
}

try {
  main(process.argv[2]);
} catch (error) {
  process.stderr.write(`Codex completion notifier: ${error.message}\n`);
  process.exitCode = 1;
}

module.exports = { main };
