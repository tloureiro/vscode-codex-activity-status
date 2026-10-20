'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Setup } = require('../src/setup');

function fixture(
  t,
  {
    workspaceReady = true,
    installed = true,
    configured,
    enabled = true,
    globalStorageExists = true,
  } = {},
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-setup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const globalStorage = path.join(dir, 'global-storage');
  if (globalStorageExists) fs.mkdirSync(globalStorage);
  const official = { extensionPath: path.join(dir, 'official') };
  const real = path.join(
    official.extensionPath,
    'bin',
    process.arch === 'arm64' ? 'macos-aarch64' : 'macos-x86_64',
    'codex',
  );
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, '', { mode: 0o700 });
  const globalData = new Map(),
    workspaceData = new Map(),
    prompts = [],
    commands = [],
    updates = [];
  let value = configured,
    connected = false,
    opens = 0,
    choice;
  const memento = (data) => ({
    get: (key) => data.get(key),
    update: async (key, v) => {
      data.set(key, v);
    },
  });
  const context = {
    globalStorageUri: { fsPath: globalStorage },
    extensionPath: path.resolve(__dirname, '..'),
    globalState: memento(globalData),
    workspaceState: memento(workspaceData),
  };
  const vscode = {
    env: {},
    extensions: { getExtension: () => (installed ? official : undefined) },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    workspace: {
      getConfiguration: (section) =>
        section === 'chatgpt'
          ? {
              get: () => value,
              inspect: () => ({ globalValue: value }),
              update: async (_, v) => {
                updates.push(v);
                value = v;
              },
            }
          : {
              inspect: () => ({}),
              update: async (_, v) => {
                enabled = v;
              },
            },
    },
    window: {
      showInformationMessage: async (...args) => {
        prompts.push(args);
        return choice;
      },
      showWarningMessage: async (...args) => {
        prompts.push(args);
        return choice;
      },
    },
    commands: {
      executeCommand: async (...args) => {
        commands.push(args);
      },
    },
  };
  const setup = new Setup(vscode, context, {
    workspaceReady,
    enabled: () => enabled,
    connected: () => connected,
    error: () => '',
    diagnostics: async () => {},
    changed: () => {},
  });
  return {
    setup,
    prompts,
    commands,
    updates,
    context,
    setChoice: (v) => {
      choice = v;
    },
    setConnected: (v) => {
      connected = v;
    },
    opens: () => opens,
    configured: () => value,
  };
}

test('startup detects missing setup without silently changing profile settings', async (t) => {
  const f = fixture(t);
  assert.equal(f.setup.status().code, 'bridge');
  await f.setup.prompt();
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0][0], /VS Code profile/);
  assert.equal(f.updates.length, 0);
  assert.equal(f.opens(), 0);
  await f.setup.prompt();
  assert.equal(f.prompts.length, 1, 'dismissed prompts do not nag');
});
test('first-time setup creates a missing global storage directory', async (t) => {
  const f = fixture(t, { globalStorageExists: false });
  assert.equal(fs.existsSync(f.context.globalStorageUri.fsPath), false);
  assert.equal(await f.setup.ensureBridge(), true);
  assert.ok(fs.statSync(f.configured()).mode & 0o111);
});
test('one setup action configures this window without opening another; repairs preserve the baseline', async (t) => {
  const f = fixture(t, { configured: null });
  f.setChoice('Set Up Activity Colors');
  await f.setup.prompt();
  assert.equal(f.opens(), 0);
  assert.ok(f.commands.some((c) => c[0] === 'chatgpt.openSidebar'));
  assert.ok(!f.commands.some((c) => c[0] === 'vscode.openFolder'));
  assert.equal(f.updates.length, 1);
  assert.ok(fs.statSync(f.configured()).mode & 0o111);
  const original = structuredClone(f.context.globalState.get('bridge'));
  assert.equal(original.had, true);
  assert.equal(original.previous, null);
  fs.writeFileSync(f.configured(), 'outdated launcher');
  f.setup.refresh();
  assert.equal(f.setup.status().code, 'repair');
  await f.setup.ensureBridge();
  assert.deepEqual(f.context.globalState.get('bridge'), original);
  assert.equal(f.setup.status().code, 'waiting');
});
test('custom Codex executables are protected and have a settings recovery action', async (t) => {
  const f = fixture(t, { configured: '/my/custom/codex' });
  assert.equal(f.setup.status().code, 'conflict');
  await assert.rejects(f.setup.ensureBridge(), /will not overwrite/);
  f.setChoice('Open Codex Settings');
  await f.setup.run();
  assert.equal(f.configured(), '/my/custom/codex');
  assert.equal(f.updates.length, 0);
  assert.deepEqual(f.commands[0], ['workbench.action.openSettings', 'chatgpt.cliExecutable']);
});
test('configured windows distinguish a missing connection from active monitoring', async (t) => {
  const f = fixture(t, { workspaceReady: true });
  await f.setup.ensureBridge();
  assert.equal(f.setup.status().code, 'waiting');
  f.setConnected(true);
  assert.equal(f.setup.status().code, 'ready');
  await f.setup.prompt();
  assert.equal(f.prompts.length, 0);
  f.setConnected(false);
  f.setChoice('Reload Window');
  await f.setup.prompt();
  assert.deepEqual(f.commands[0], ['workbench.action.reloadWindow']);
});
test('disabled monitoring stays quiet; missing official Codex provides an install destination', async (t) => {
  const disabled = fixture(t, { enabled: false });
  await disabled.setup.prompt();
  assert.equal(disabled.prompts.length, 0);
  const missing = fixture(t, { installed: false });
  assert.equal(missing.setup.status().code, 'missingCodex');
  await missing.setup.run();
  assert.deepEqual(missing.commands[0], ['workbench.extensions.search', '@id:openai.chatgpt']);
});
test('existing bridge setup is idempotent and a missing launcher is repairable', async (t) => {
  const f = fixture(t);
  assert.equal(await f.setup.ensureBridge(), true);
  assert.equal(await f.setup.ensureBridge(), false);
  assert.equal(f.updates.length, 1);
  fs.unlinkSync(f.configured());
  f.setup.refresh();
  assert.equal(f.setup.status().code, 'repair');
  assert.equal(await f.setup.ensureBridge(), true);
  assert.equal(f.updates.length, 1);
});

test('a connected empty or unsaved window no longer requires appearance settings', async (t) => {
  const f = fixture(t, { workspaceReady: false });
  await f.setup.ensureBridge();
  f.setConnected(true);
  assert.equal(f.setup.status().code, 'ready');
});
