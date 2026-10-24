'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const inspector = require('node:inspector');
const { performance } = require('node:perf_hooks');
const vscode = require('vscode');
const { SnapshotReader } = require('./reader');

async function run() {
  const root = process.env.CODEX_SNAPSHOT_TEST_ROOT;
  assert.ok(root);
  assert.equal(vscode.version, '1.143.1', 'Research is pinned to this VS Code version');
  assert.equal(
    fs.realpathSync(process.env.CODEX_HOME),
    fs.realpathSync(path.join(root, 'codex-home')),
  );
  const result = {
    vscode: vscode.version,
    node: process.version,
    inspectorPortBefore: inspector.url() ?? null,
    scope: 'disposable-profile-idle-only-no-model-requests',
    snapshots: [],
  };
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  assert.ok(extension, 'Official extension loaded from its installed files');
  // This starts the official extension normally, only in the disposable profile.
  await extension.activate();
  result.codexVersion = extension.packageJSON.version;
  const selectiveScopes = process.env.CODEX_SNAPSHOT_SCOPE_MODE === 'selective';
  result.scopeInspection = selectiveScopes
    ? 'fixed-read-only-descriptor-projection'
    : 'full-scope-descriptors';
  const reader = new SnapshotReader({ selectiveScopes });
  function timingSummary(values) {
    const ordered = [...values].sort((a, b) => a - b);
    const rounded = (value) => Math.round(value * 100) / 100;
    return {
      samples: ordered.length,
      medianMs: rounded(ordered[Math.floor(ordered.length / 2)]),
      p95Ms: rounded(ordered[Math.ceil(ordered.length * 0.95) - 1]),
      maxMs: rounded(ordered.at(-1)),
    };
  }
  try {
    for (let index = 0; index < 5; index++) {
      result.snapshots.push(await reader.read(extension));
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    assert.ok(
      result.snapshots.some((snapshot) => snapshot.initialized),
      'Normal Codex startup completed',
    );
    assert.ok(
      result.snapshots.every((snapshot) => snapshot.internalHandlerCount === 1),
      'No extra internal listener',
    );
    assert.equal(inspector.url() ?? null, result.inspectorPortBefore);
    const baselineTimerDelays = [];
    for (let index = 0; index < 10; index++) {
      const start = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 0));
      baselineTimerDelays.push(performance.now() - start);
    }
    const timerDelays = [];
    const snapshotTotals = [];
    const heartbeatDelays = [];
    let heartbeatAt = performance.now();
    const heartbeat = setInterval(() => {
      const now = performance.now();
      heartbeatDelays.push(Math.max(0, now - heartbeatAt - 5));
      heartbeatAt = now;
    }, 5);
    try {
      for (let index = 0; index < 10; index++) {
        const start = performance.now();
        const nextTimer = new Promise((resolve) =>
          setTimeout(() => resolve(performance.now() - start), 0),
        );
        const snapshot = await reader.read(extension);
        snapshotTotals.push(performance.now() - start);
        timerDelays.push(await nextTimer);
        assert.equal(snapshot.internalHandlerCount, 1);
        assert.equal(snapshot.initialized, true);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      clearInterval(heartbeat);
    }
    result.benchmark = {
      scope:
        'idle-only; total read includes hash/version checks; zero-delay timers measure event-loop interference',
      baselineTimers: timingSummary(baselineTimerDelays),
      timersDuringInspection: timingSummary(timerDelays),
      totalSnapshot: timingSummary(snapshotTotals),
      heartbeatExcessDelay: timingSummary(heartbeatDelays),
    };
    result.inspectorMethods = [...reader.methods];
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  }
}

module.exports = { run };
