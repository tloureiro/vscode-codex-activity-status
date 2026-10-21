'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  Integration,
  installOwnedNotify,
  removeOwnedNotify,
  removeLegacyJsonHooks,
  removeLegacyTomlHooks,
} = require('../src/integration');

const legacySound = '/usr/bin/afplay /System/Library/Sounds/Sosumi.aiff';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storage = path.join(root, 'storage');
  const home = path.join(root, 'codex');
  const values = new Map();
  const memory = new Map();
  const context = {
    globalStorageUri: { fsPath: storage },
    extensionPath: path.resolve(__dirname, '..'),
    globalState: {
      get: (key) => memory.get(key),
      update: async (key, value) => memory.set(key, value),
    },
  };
  const vscode = {
    ConfigurationTarget: { Global: 1 },
    env: {},
    extensions: { getExtension: () => ({}) },
    workspace: {
      getConfiguration: () => ({
        get: (key) => values.get(key),
        inspect: (key) => ({ globalValue: values.get(key) }),
        update: async (key, value) => values.set(key, value),
      }),
    },
  };
  return {
    integration: new Integration(vscode, context, { codexHome: home }),
    context,
    values,
    home,
  };
}

test('owned notify block round-trips without altering surrounding Codex config', () => {
  const original = 'model = "gpt-5"\n\n[features]\nfoo = true\n';
  const installed = installOwnedNotify(original, '/tmp/notifier');
  assert.equal(installed.conflict, false);
  assert.match(installed.text, /notify = \["\/tmp\/notifier"\]/);
  assert.equal(removeOwnedNotify(installed.text).replace(/^\n+/, ''), original);
  assert.equal(installOwnedNotify('notify = ["mine"]\n', '/tmp/notifier').conflict, true);
});

test('legacy TOML cleanup removes the recognized sound and state but preserves other hooks', () => {
  const input = `model = "gpt-5"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "${legacySound}"\n\n[hooks.state]\n[hooks.state."config.toml:stop:0:0"]\ntrusted_hash = "hash"\n\n[[hooks.Start]]\n[[hooks.Start.hooks]]\ntype = "command"\ncommand = "my-custom-hook"\n`;
  const result = removeLegacyTomlHooks(input);
  assert.deepEqual(result.removed, [legacySound]);
  assert.doesNotMatch(result.text, /Sosumi|hooks\.state/);
  assert.match(result.text, /my-custom-hook/);
});

test('legacy JSON cleanup preserves unrelated hook handlers', () => {
  const result = removeLegacyJsonHooks(
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: legacySound },
              { type: 'command', command: 'my-custom-hook' },
            ],
          },
        ],
      },
    }),
  );
  assert.deepEqual(result.removed, [legacySound]);
  assert.doesNotMatch(result.text, /Sosumi/);
  assert.match(result.text, /my-custom-hook/);
});

test('migration restores the old executable setting, removes legacy hooks, and installs notify', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.home, { recursive: true });
  fs.writeFileSync(
    path.join(f.home, 'config.toml'),
    `model = "gpt-5"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = "${legacySound}"\n`,
  );
  const oldProxy = path.join(f.integration.directory, 'codex-activity-proxy');
  fs.mkdirSync(f.integration.directory, { recursive: true });
  fs.writeFileSync(oldProxy, 'old');
  f.values.set('cliExecutable', oldProxy);
  await f.context.globalState.update('bridge', {
    launcher: oldProxy,
    had: true,
    previous: '/custom/codex',
  });
  const removed = await f.integration.migrate();
  assert.equal(removed.proxy, true);
  assert.deepEqual(removed.hooks, [legacySound]);
  assert.equal(f.values.get('cliExecutable'), '/custom/codex');
  assert.equal(fs.existsSync(oldProxy), false);
  const config = fs.readFileSync(f.integration.config, 'utf8');
  assert.doesNotMatch(config, /Sosumi|\[\[hooks\.Stop/);
  assert.match(config, /BEGIN codex-completion notifier/);
  assert.equal(f.integration.status().code, 'ready');
  await f.integration.remove();
  assert.doesNotMatch(fs.readFileSync(f.integration.config, 'utf8'), /notify|codex-completion/);
  assert.equal(fs.existsSync(f.integration.launcher), false);
});

test('a custom notify command is never overwritten', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.home, { recursive: true });
  fs.writeFileSync(f.integration.config, 'notify = ["my-command"]\n');
  assert.equal(f.integration.status().code, 'conflict');
  assert.throws(() => f.integration.ensure(), /custom notify/);
  assert.equal(fs.readFileSync(f.integration.config, 'utf8'), 'notify = ["my-command"]\n');
});

test('legacy cleanup leaves a user replacement executable untouched', async (t) => {
  const f = fixture(t);
  const oldProxy = path.join(f.integration.directory, 'codex-activity-proxy');
  fs.mkdirSync(f.integration.directory, { recursive: true });
  fs.writeFileSync(oldProxy, 'old');
  f.values.set('cliExecutable', '/my/current/codex');
  await f.context.globalState.update('bridge', {
    launcher: oldProxy,
    had: true,
    previous: '/my/previous/codex',
  });
  const removed = await f.integration.cleanupLegacy();
  assert.equal(removed.proxy, false);
  assert.equal(f.values.get('cliExecutable'), '/my/current/codex');
  assert.equal(fs.existsSync(oldProxy), false);
});
