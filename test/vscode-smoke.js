'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('tloureiro.codex-activity-status');
  assert.ok(extension);
  const api = await extension.activate();
  assert.ok(['missingCodex', 'setup'].includes(api.setupStatus().code));
  assert.deepEqual(api.summary(), { state: 'idle', unread: 0 });
  assert.deepEqual(api.presentation(), { state: 'idle', foreground: null });
  fs.writeFileSync(
    path.join(process.env.CODEX_COMPLETION_TEST_DIR, 'result.json'),
    JSON.stringify({ passed: true, vscode: vscode.version }),
  );
}

module.exports = { run };
