#!/usr/bin/env node
'use strict';
// Copied into the project. Standalone: never contact VS Code or return hook output.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EVENTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop',
  'Interrupt',
]);
const MAX_INPUT = 8 * 1024 * 1024;

function privateDirectory(directory) {
  const stat = fs.lstatSync(directory);
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === process.getuid() &&
    !(stat.mode & 0o077)
  );
}

function emit(raw, config) {
  if (!config || config.schema !== 1 || !privateDirectory(config.root)) return false;
  const now = Date.now();
  const names = fs.readdirSync(config.root);
  if (names.length > 1200) return false;
  const listening = names
    .filter((name) => /^receiver-[a-f0-9-]+\.json$/.test(name))
    .some((name) => {
      try {
        const file = path.join(config.root, name);
        const stat = fs.lstatSync(file);
        if (
          !stat.isFile() ||
          stat.uid !== process.getuid() ||
          stat.mode & 0o077 ||
          stat.size > 1024
        )
          return false;
        const lease = JSON.parse(fs.readFileSync(file, 'utf8'));
        return (
          lease.project === config.project && lease.expiresAt > now && lease.expiresAt < now + 30000
        );
      } catch {
        return false;
      }
    });
  if (!listening || Buffer.byteLength(raw) > MAX_INPUT) return false;
  const input = JSON.parse(raw);
  if (
    !EVENTS.has(input.hook_event_name) ||
    typeof input.session_id !== 'string' ||
    input.session_id.length > 512
  )
    return false;
  if (typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd)) return false;
  const cwd = fs.realpathSync(input.cwd);
  const relative = path.relative(config.project, cwd);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    return false;
  const string = (value, limit = 512) =>
    typeof value === 'string' && value.length <= limit ? value : null;
  const event = {
    schema: 1,
    id: crypto.randomUUID(),
    project: config.project,
    event: input.hook_event_name,
    sessionId: input.session_id,
    turnId: string(input.turn_id),
    cwd,
    toolName: string(input.tool_name),
    toolUseId: string(input.tool_use_id),
    transcriptPath: string(input.transcript_path, 4096),
    at: now,
  };
  const target = path.join(config.root, `event-${now}-${event.id}.json`);
  const temporary = target + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(event), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* Published or already gone. */
    }
  }
  return true;
}

function main() {
  let raw = '';
  let size = 0;
  const deadline = setTimeout(() => process.exit(0), 700);
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_INPUT) process.exit(0);
    raw += chunk;
  });
  process.stdin.on('end', () => {
    try {
      const config = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'observer-config.json'), 'utf8'),
      );
      emit(raw, config);
    } catch {
      /* Every observer failure is an ordinary, silent success exit. */
    } finally {
      clearTimeout(deadline);
    }
  });
}
if (require.main === module) main();
module.exports = { emit, privateDirectory, EVENTS, MAX_INPUT };
