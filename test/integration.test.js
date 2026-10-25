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

test('both generations of owned notify blocks are removed without touching custom notify', () => {
  const surrounding = 'notify = ["mine"]\n\n[features]\nfoo = true\n';
  for (const marker of ['codex-completion', 'codex-activity-status completion']) {
    const block = `# BEGIN ${marker} notifier\nnotify = ["/tmp/notifier"]\n# END ${marker} notifier\n`;
    assert.equal(removeOwnedNotify(block + surrounding), surrounding);
  }
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

test('cleanup restores the old executable setting and removes all legacy generations', async (t) => {
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
  assert.deepEqual(removed.hooks, [legacySound]);
  assert.equal(f.values.get('cliExecutable'), '/custom/codex');
  assert.equal(fs.existsSync(oldProxy), false);
  const config = fs.readFileSync(f.integration.config, 'utf8');
  assert.doesNotMatch(config, /Sosumi|\[\[hooks\.Stop/);
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
  const original = `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = "${legacySound}"\n`;
  fs.writeFileSync(f.integration.config, original);
  const plan = f.integration.plan();
  fs.appendFileSync(f.integration.config, '\n# changed during review\n');
  await assert.rejects(f.integration.remove(plan), /changed during confirmation/);
  assert.match(fs.readFileSync(f.integration.config, 'utf8'), /Sosumi/);
  fs.writeFileSync(f.integration.hooksJson, '{malformed');
  assert.throws(() => f.integration.plan(), SyntaxError);
  assert.match(fs.readFileSync(f.integration.config, 'utf8'), /Sosumi/);
  fs.unlinkSync(f.integration.hooksJson);
  fs.symlinkSync(f.integration.config, f.integration.hooksJson);
  assert.throws(() => f.integration.plan(), /symlinks/);
  assert.match(fs.readFileSync(f.integration.config, 'utf8'), /Sosumi/);
});

test('a legacy-looking command outside a hook table is preserved', () => {
  const input = `[mcp_servers.personal]\ncommand = "codex-activity-helper"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = "${legacySound}"\n`;
  const result = removeLegacyTomlHooks(input);
  assert.match(result.text, /command = "codex-activity-helper"/);
  assert.doesNotMatch(result.text, /Sosumi/);
});
