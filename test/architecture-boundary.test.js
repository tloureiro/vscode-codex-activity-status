'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');

const root = path.resolve(__dirname, '..');
const sourceDirectory = path.join(root, 'src');

test('activity UI uses a public webview and has no production dependencies', () => {
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.contributes.views.codexActivity[0].type, 'webview');
  assert.equal(manifest.contributes.viewsContainers.panel[0].id, 'codexActivity');
  assert.ok(
    Object.keys(manifest.contributes.configuration.properties).every(
      (key) => key.startsWith('codexCompletion.') || key.startsWith('codexActivity.'),
    ),
  );
});

test('active runtime has no interception, private status-color, or workspace-overlay mechanism', () => {
  const activeFiles = [
    'activity-events.js',
    'activity-state.js',
    'activity-helper.js',
    'activity-view.js',
    'status-presenter.js',
    'extension.js',
  ];
  const activeRuntime = activeFiles
    .map((file) => fs.readFileSync(path.join(sourceDirectory, file), 'utf8'))
    .join('\n');
  for (const forbidden of [
    "require('node:net')",
    "require('node:child_process')",
    'ALLOWED_BACKGROUND_COLORS',
    'chatgpt.cliExecutable',
    'workbench.colorCustomizations',
    'codex-activity-proxy',
    "require('node:inspector')",
  ])
    assert.equal(activeRuntime.includes(forbidden), false, forbidden);
});

test('legacy knowledge is isolated to removal logic', () => {
  const integration = fs.readFileSync(path.join(sourceDirectory, 'integration.js'), 'utf8');
  assert.match(integration, /cleanupLegacy/);
  assert.match(integration, /restoreProxy/);
  assert.doesNotMatch(integration, /require\(['"]node:(?:net|child_process)['"]\)/);
});

test('palette has five distinct actions and legacy code can only remove integrations', () => {
  assert.deepEqual(manifest.contributes.commands.map((entry) => entry.command).sort(), [
    'codexActivity.acknowledge',
    'codexActivity.chooseScope',
    'codexActivity.diagnostics',
    'codexActivity.repair',
    'codexActivity.show',
  ]);
  const integration = fs.readFileSync(path.join(sourceDirectory, 'integration.js'), 'utf8');
  assert.doesNotMatch(integration, /installOwnedNotify|launcherScript|ensure\(\)|migrate\(\)/);
  assert.equal(
    Object.keys(manifest.contributes.configuration.properties).some((key) =>
      key.startsWith('codexCompletion.'),
    ),
    false,
  );
});
