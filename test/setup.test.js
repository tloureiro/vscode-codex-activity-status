'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Setup } = require('../src/setup');

function fixture(status = 'setup') {
  const prompts = [];
  const commands = [];
  const memory = new Map();
  let enabled = true;
  let selected;
  const integration = {
    config: '/tmp/config.toml',
    status: () => ({ code: status, detail: 'setup detail' }),
    migrate: async () => ({ proxy: true, hooks: ['hook'] }),
    cleanupLegacy: async () => ({ proxy: true, hooks: ['hook'] }),
  };
  const vscode = {
    Uri: { file: (value) => ({ fsPath: value }) },
    window: {
      showInformationMessage: async (...args) => {
        prompts.push(args);
        return selected;
      },
      showWarningMessage: async (...args) => {
        prompts.push(args);
        return selected;
      },
    },
    commands: { executeCommand: async (...args) => commands.push(args) },
  };
  const context = {
    workspaceState: {
      get: (key) => memory.get(key),
      update: async (key, value) => memory.set(key, value),
    },
  };
  const setup = new Setup(vscode, context, {
    enabled: () => enabled,
    enable: async () => {
      enabled = true;
    },
    integration,
    changed: () => {},
  });
  return {
    setup,
    prompts,
    commands,
    choose(value) {
      selected = value;
    },
    disable() {
      enabled = false;
    },
  };
}

test('setup migrates legacy integration in one action', async () => {
  const f = fixture('migration');
  f.choose('Migrate');
  await f.setup.prompt();
  assert.match(f.prompts.at(-1)[0], /Completion-only monitoring is ready/);
  assert.match(f.prompts.at(-1)[0], /legacy executable proxy/);
});

test('custom notify conflict opens the exact Codex config without overwriting it', async () => {
  const f = fixture('conflict');
  f.choose('Open Codex Config');
  await f.setup.run();
  assert.deepEqual(f.commands, [['vscode.open', { fsPath: '/tmp/config.toml' }]]);
});

test('disabled and ready states do not prompt at startup', async () => {
  const disabled = fixture('setup');
  disabled.disable();
  await disabled.setup.prompt();
  assert.equal(disabled.prompts.length, 0);
  const ready = fixture('ready');
  await ready.setup.prompt();
  assert.equal(ready.prompts.length, 0);
});
