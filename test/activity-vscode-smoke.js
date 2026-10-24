'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
async function run() {
  const root = process.env.CODEX_ACTIVITY_TEST_ROOT;
  const url = process.env.CODEX_ACTIVITY_TEST_URL;
  const result = { vscode: vscode.version, states: [] };
  const extension = vscode.extensions.getExtension('tloureiro.codex-activity-status');
  const api = await extension.activate();
  async function until(check, label) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out: ' + label + '; summary=' + JSON.stringify(api.summary()));
  }
  async function prompt(comment) {
    await vscode.commands.executeCommand('chatgpt.implementTodo', {
      line: 0,
      fileName: path.join(root, 'project/example.txt'),
      cwd: path.join(root, 'project'),
      comment,
    });
  }
  try {
    assert.equal(api.setupStatus().code, 'installed');
    assert.equal(api.panelVisible(), false, 'Large panel stays closed by default');
    await vscode.extensions.getExtension('openai.chatgpt').activate();
    await vscode.commands.executeCommand('chatgpt.openSidebar');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await prompt('HOOK_ACTIVITY_WORKING: Reply OK without using tools.');
    await until(() => api.summary().state === 'working', 'blue working state');
    assert.equal(api.presentation().color, '#2864e8');
    assert.equal(api.beacon().color, '#2864e8');
    assert.match(api.beacon().text, /^█{24} Codex: working$/);
    assert.equal(api.panelVisible(), false);
    result.states.push('working');
    await fetch(url + '/control/normal');
    await until(() => api.summary().state === 'finished', 'purple confirmed completion');
    assert.equal(api.presentation().color, '#8453d6');
    assert.equal(api.beacon().color, '#8453d6');
    assert.equal(api.statusAction(), 'codexActivity.acknowledge');
    result.states.push('finished');
    await vscode.commands.executeCommand('codexActivity.acknowledge');
    assert.equal(api.summary().unread, 0);
    await fetch(url + '/control/failure');
    await prompt('HOOK_ACTIVITY_FAILURE: Reply OK without tools.');
    await until(() => api.summary().state === 'failed', 'separate failed outcome');
    result.states.push('failed');
    await vscode.commands.executeCommand('codexActivity.acknowledge');
    await fetch(url + '/control/normal');
    const helper = path.join(root, 'project/.codex/codex-activity/observer.js');
    fs.renameSync(helper, helper + '-disabled');
    try {
      await prompt('HOOK_ACTIVITY_HELPER_ABSENT: Reply OK without tools.');
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } finally {
      fs.renameSync(helper + '-disabled', helper);
    }
    await prompt('HOOK_ACTIVITY_RECOVERED: Reply OK without tools.');
    await until(() => api.summary().state === 'finished', 'recovered helper');
    result.states.push('recovered');
    await vscode.commands.executeCommand('codexActivity.acknowledge');
    await fetch(url + '/control/approval');
    await prompt('HOOK_ACTIVITY_APPROVAL: perform the synthetic fixture action.');
    await until(() => api.summary().state === 'attention', 'amber approval signal');
    assert.equal(api.presentation().color, '#edb537');
    assert.equal(api.beacon().color, '#edb537');
    assert.equal(api.panelVisible(), false, 'Activity never opens the detail panel');
    await vscode.commands.executeCommand('codexActivity.show');
    await until(() => api.panelVisible(), 'optional detail panel opens on request');
    result.states.push('attention');
    result.passed = true;
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  }
}
module.exports = { run };
