'use strict';
// Research only: no network, model-visible output, or dependency on a receiver.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let input = '';
const deadline = setTimeout(() => process.exit(0), 500);
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.length > 131072) process.exit(0);
});
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const directory = path.join(__dirname, 'events');
    // A missing receiver directory is an ordinary disabled state.
    if (!fs.existsSync(directory)) return;
    const metadata = {
      event: data.hook_event_name,
      sessionId: data.session_id,
      turnId: data.turn_id ?? null,
      cwd: data.cwd,
      toolName: data.tool_name ?? null,
      receivedAt: Date.now(),
    };
    const target = path.join(directory, crypto.randomUUID());
    fs.writeFileSync(target + '.tmp', JSON.stringify(metadata), { mode: 0o600 });
    fs.renameSync(target + '.tmp', target + '.json');
  } catch {
    // Observation failure must not return a hook decision or an error exit.
  } finally {
    clearTimeout(deadline);
  }
});
