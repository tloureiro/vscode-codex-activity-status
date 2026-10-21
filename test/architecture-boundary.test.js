'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');

const root = path.resolve(__dirname, '..');
const sourceDirectory = path.join(root, 'src');

test('runtime contains only completion-era modules and no production dependencies', () => {
  assert.deepEqual(fs.readdirSync(sourceDirectory).sort(), [
    'completion-events.js',
    'completion-state.js',
    'extension.js',
    'integration.js',
    'notifier.js',
    'setup.js',
    'status-presenter.js',
  ]);
  assert.equal(manifest.dependencies, undefined);
  assert.ok(
    manifest.contributes.commands.every(({ command }) => command.startsWith('codexCompletion.')),
  );
  assert.ok(
    Object.keys(manifest.contributes.configuration.properties).every((key) =>
      key.startsWith('codexCompletion.'),
    ),
  );
});

test('active runtime has no interception, private status-color, or workspace-overlay mechanism', () => {
  const activeFiles = [
    'completion-events.js',
    'completion-state.js',
    'extension.js',
    'notifier.js',
    'setup.js',
    'status-presenter.js',
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
  ])
    assert.equal(activeRuntime.includes(forbidden), false, forbidden);
});

test('legacy knowledge is isolated to removal logic', () => {
  const integration = fs.readFileSync(path.join(sourceDirectory, 'integration.js'), 'utf8');
  assert.match(integration, /cleanupLegacy/);
  assert.match(integration, /restoreProxy/);
  assert.doesNotMatch(integration, /require\(['"]node:(?:net|child_process)['"]\)/);
});
