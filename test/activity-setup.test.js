'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('setup cancellation writes nothing; consent installs only project integration and removal unregisters it', async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-activity-consent-')));
  const extensionPath = path.resolve(__dirname, '..');
  const commands = new Map();
  const memory = new Map();
  const prompts = [];
  const errors = [];
  const executed = [];
  const disposable = { dispose() {} };
  let choice;
  const vscode = {
    version: '1.143.1',
    env: {},
    StatusBarAlignment: { Left: 1 },
    ConfigurationTarget: {},
    workspace: {
      isTrusted: true,
      workspaceFolders: [{ name: 'test', uri: { scheme: 'file', fsPath: root } }],
      getConfiguration: () => ({
        get: (key, fallback) => (key === 'nodePath' ? process.execPath : fallback),
        update: () => {
          throw new Error('Unexpected preference write');
        },
      }),
      onDidChangeWorkspaceFolders: () => disposable,
      onDidChangeConfiguration: () => disposable,
    },
    window: {
      state: { focused: true },
      createOutputChannel: () => ({ ...disposable, appendLine() {} }),
      createStatusBarItem: () => ({ ...disposable, show() {} }),
      registerWebviewViewProvider: () => disposable,
      onDidChangeWindowState: () => disposable,
      showWarningMessage: async (...args) => {
        prompts.push(args);
        return choice;
      },
      showInformationMessage: async () => undefined,
      showErrorMessage: async (message) => errors.push(message),
    },
    extensions: { getExtension: () => ({}) },
    commands: {
      registerCommand: (id, action) => {
        commands.set(id, action);
        return disposable;
      },
      executeCommand: async (id) => {
        executed.push(id);
      },
    },
  };
  const context = {
    extensionPath,
    extension: { packageJSON: { version: '0.4.0' } },
    subscriptions: [],
    workspaceState: {
      get: (key, fallback) => memory.get(key) ?? fallback,
      update: async (key, value) => memory.set(key, value),
    },
    globalState: {
      update() {
        throw new Error('Unexpected global integration write');
      },
    },
  };
  const file = path.join(extensionPath, 'src/extension.js');
  const localRequire = createRequire(file);
  const sandbox = {
    require: (name) => (name === 'vscode' ? vscode : localRequire(name)),
    module: { exports: {} },
    process,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const api = await sandbox.module.exports.activate(context);
  let runtime;
  t.after(async () => {
    await sandbox.module.exports.deactivate();
    if (runtime) fs.rmSync(runtime, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal(api.setupStatus().code, 'setup');
  await commands.get('codexActivity.installProjectHooks')();
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0][1].modal, true);
  assert.equal(fs.existsSync(path.join(root, '.codex')), false);
  choice = 'Install Project Hooks';
  await commands.get('codexActivity.installProjectHooks')();
  assert.deepEqual(errors, []);
  assert.equal(api.setupStatus().code, 'installed');
  runtime = api.setupStatus().manifest.root;
  assert.equal(fs.existsSync(path.join(root, '.codex/hooks.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.vscode')), false);
  assert.equal(executed.includes('codexActivity.panel.focus'), false);
  choice = 'Remove Project Hooks';
  await commands.get('codexActivity.removeProjectHooks')();
  assert.equal(fs.existsSync(path.join(root, '.codex/hooks.json')), false);
  assert.deepEqual(errors, []);
});
