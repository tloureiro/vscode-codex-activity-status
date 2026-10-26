'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  Integration,
  removeOwnedNotify,
  removeLegacyJsonHooks,
  removeLegacyTomlHooks,
} = require('../src/integration');

const legacyCommand = '/tmp/codex-activity-helper';
const completionSound = '/usr/bin/afplay /System/Library/Sounds/Sosumi.aiff';
const permissionSound = '/usr/bin/afplay /System/Library/Sounds/Ping.aiff';

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

function soundToml() {
  return [
    ['Stop', completionSound, 'stop'],
    ['PermissionRequest', permissionSound, 'permission_request'],
  ]
    .map(
      ([event, command, key]) =>
        `[[hooks.${event}]]\n[[hooks.${event}.hooks]]\ntype = "command"\ncommand = "${command}"\ntimeout = 3\n\n[hooks.state."config.toml:${key}:0:0"]\ntrusted_hash = "keep-${key}"\n`,
    )
    .join('\n');
}

function soundJson() {
  return {
    hooks: Object.fromEntries(
      [
        ['Stop', completionSound],
        ['PermissionRequest', permissionSound],
      ].map(([event, command]) => [event, [{ hooks: [{ type: 'command', command }] }]]),
    ),
  };
}

test('sound hooks alone never trigger cleanup and both formats remain byte-for-byte intact', async (t) => {
  const { integration, home } = fixture(t);
  fs.mkdirSync(home);
  const toml = soundToml();
  const json = JSON.stringify(soundJson(), null, 4) + '\n';
  fs.writeFileSync(integration.config, toml);
  fs.writeFileSync(integration.hooksJson, json);
  assert.equal(integration.plan().needed, false);
  assert.deepEqual(integration.legacy().hooks, []);
  await integration.remove();
  assert.equal(fs.readFileSync(integration.config, 'utf8'), toml);
  assert.equal(fs.readFileSync(integration.hooksJson, 'utf8'), json);
});

test('cleanup removes old activity handlers alongside sounds while retaining sounds and trust', async (t) => {
  const { integration, home } = fixture(t);
  fs.mkdirSync(home);
  const toml = soundToml();
  // A shared Stop group must survive removal of its old activity handler.
  const mixed = toml.replace(
    '\n[hooks.state.',
    `\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "${legacyCommand}"\n\n[hooks.state.`,
  );
  const json = soundJson();
  json.hooks.Stop[0].hooks.push({ type: 'command', command: legacyCommand });
  fs.writeFileSync(integration.config, mixed);
  fs.writeFileSync(integration.hooksJson, JSON.stringify(json));
  assert.deepEqual((await integration.remove()).hooks, [legacyCommand]);
  const cleaned = fs.readFileSync(integration.config, 'utf8');
  for (const value of [completionSound, permissionSound, 'keep-stop', 'keep-permission_request'])
    assert.ok(cleaned.includes(value), value);
  assert.match(cleaned, /\[\[hooks.Stop\]\]/);
  assert.doesNotMatch(cleaned, /codex-activity-helper/);
  assert.deepEqual(JSON.parse(fs.readFileSync(integration.hooksJson)), soundJson());
  assert.equal(integration.plan().needed, false);
});

test('both generations of owned notify blocks are removed without touching custom notify', () => {
  const surrounding = 'notify = ["mine"]\n\n[features]\nfoo = true\n';
  for (const marker of ['codex-completion', 'codex-activity-status completion']) {
    const block = `# BEGIN ${marker} notifier\nnotify = ["/tmp/notifier"]\n# END ${marker} notifier\n`;
    assert.equal(removeOwnedNotify(block + surrounding), surrounding);
  }
});

test('legacy TOML cleanup removes the owned activity handler and state but preserves other hooks', () => {
  const input = `model = "gpt-5"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "${legacyCommand}"\n\n[hooks.state]\n[hooks.state."config.toml:stop:0:0"]\ntrusted_hash = "hash"\n\n[[hooks.Start]]\n[[hooks.Start.hooks]]\ntype = "command"\ncommand = "my-custom-hook"\n`;
  const result = removeLegacyTomlHooks(input);
  assert.deepEqual(result.removed, [legacyCommand]);
  assert.doesNotMatch(result.text, /codex-activity-helper|hooks\.state/);
  assert.match(result.text, /my-custom-hook/);
});

test('legacy JSON cleanup preserves unrelated hook handlers', () => {
  const result = removeLegacyJsonHooks(
    JSON.stringify({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: legacyCommand },
              { type: 'command', command: 'my-custom-hook' },
            ],
          },
        ],
      },
    }),
  );
  assert.deepEqual(result.removed, [legacyCommand]);
  assert.doesNotMatch(result.text, /codex-activity-helper/);
  assert.match(result.text, /my-custom-hook/);
});

test('cleanup restores the old executable setting and removes all legacy generations', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.home, { recursive: true });
  fs.writeFileSync(
    path.join(f.home, 'config.toml'),
    `model = "gpt-5"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = "${legacyCommand}"\n`,
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
  fs.appendFileSync(
    f.integration.config,
    '\n# BEGIN codex-completion notifier\nnotify = ["old"]\n# END codex-completion notifier\n',
  );
  for (const file of [f.integration.launcher, f.integration.notifier])
    fs.writeFileSync(file, 'old helper');
  const plan = f.integration.plan();
  assert.equal(plan.needed, true);
  const removed = await f.integration.remove(plan);
  assert.equal(removed.proxy, true);
  assert.deepEqual(removed.hooks, [legacyCommand]);
  assert.equal(f.values.get('cliExecutable'), '/custom/codex');
  assert.equal(fs.existsSync(oldProxy), false);
  const config = fs.readFileSync(f.integration.config, 'utf8');
  assert.doesNotMatch(config, /codex-activity-helper|\[\[hooks\.Stop/);
  assert.doesNotMatch(config, /BEGIN codex-completion notifier/);
  assert.equal(f.integration.plan().needed, false);
  await f.integration.remove();
  assert.doesNotMatch(fs.readFileSync(f.integration.config, 'utf8'), /notify|codex-completion/);
  assert.equal(fs.existsSync(f.integration.launcher), false);
});

test('a custom notify command is preserved by cleanup', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.home, { recursive: true });
  fs.writeFileSync(f.integration.config, 'notify = ["my-command"]\n');
  assert.equal(f.integration.plan().needed, false);
  await f.integration.remove();
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

test('cleanup refuses stale plans, malformed JSON and symlinked files before changing configuration', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.home);
  const original = `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = "${legacyCommand}"\n`;
  fs.writeFileSync(f.integration.config, original);
  const plan = f.integration.plan();
  fs.appendFileSync(f.integration.config, '\n# changed during review\n');
  await assert.rejects(f.integration.remove(plan), /changed during confirmation/);
  assert.match(fs.readFileSync(f.integration.config, 'utf8'), /codex-activity-helper/);
  fs.writeFileSync(f.integration.hooksJson, '{malformed');
  assert.throws(() => f.integration.plan(), SyntaxError);
  assert.match(fs.readFileSync(f.integration.config, 'utf8'), /codex-activity-helper/);
  fs.unlinkSync(f.integration.hooksJson);
  fs.symlinkSync(f.integration.config, f.integration.hooksJson);
  assert.throws(() => f.integration.plan(), /symlinks/);
  assert.match(fs.readFileSync(f.integration.config, 'utf8'), /codex-activity-helper/);
});

test('a legacy-looking command outside a hook table is preserved', () => {
  const input = `[mcp_servers.personal]\ncommand = "codex-activity-helper"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = "${legacyCommand}"\n`;
  const result = removeLegacyTomlHooks(input);
  assert.match(result.text, /command = "codex-activity-helper"/);
  assert.equal(result.text.includes(legacyCommand), false);
});
