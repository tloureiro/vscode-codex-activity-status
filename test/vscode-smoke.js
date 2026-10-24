'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('tloureiro.codex-activity-status');
  assert.ok(extension);
  const api = await extension.activate();
  assert.ok(['unsupported', 'setup'].includes(api.setupStatus().code));
  assert.equal(api.summary().state, 'idle');
  assert.equal(api.summary().unread, 0);
  assert.match(api.presentation().title, /Enable project activity|Open a local project/);
  fs.writeFileSync(
    path.join(process.env.CODEX_COMPLETION_TEST_DIR, 'result.json'),
    JSON.stringify({ passed: true, vscode: vscode.version }),
  );
}

module.exports = { run };
