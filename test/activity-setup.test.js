'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

for (const initiallyEnabled of [true, false]) {
  test(`setup stays local when initially ${initiallyEnabled ? 'enabled' : 'disabled'}`, async (t) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-activity-consent-')));
    const extensionPath = path.resolve(__dirname, '..');
    const commands = new Map();
    const memory = new Map();
    const prompts = [];
    const errors = [];
    const executed = [];
    const disposable = { dispose() {} };
    let choice;
    let configuredEnabled = initiallyEnabled;
    let configurationChanged;
    const vscode = {
      version: '1.143.1',
      env: {},
      StatusBarAlignment: { Left: 1 },
      ConfigurationTarget: {},
      workspace: {
        isTrusted: true,
        workspaceFolders: [{ name: 'test', uri: { scheme: 'file', fsPath: root } }],
        getConfiguration: () => ({
          get: (key, fallback) =>
            key === 'nodePath'
              ? process.execPath
              : key === 'enabled'
                ? configuredEnabled
                : fallback,
          update: () => {
            throw new Error('Unexpected preference write');
          },
        }),
        onDidChangeWorkspaceFolders: () => disposable,
        onDidChangeConfiguration: (listener) => {
          configurationChanged = listener;
          return disposable;
        },
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
    let api = await sandbox.module.exports.activate(context);
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
    assert.equal(fs.existsSync(path.join(root, '.vscode')), false);
    assert.equal(memory.has('activityEnabled'), false);
    choice = 'Install Project Hooks';
    await commands.get('codexActivity.installProjectHooks')();
    assert.deepEqual(errors, []);
    assert.equal(api.setupStatus().code, 'installed');
    runtime = api.setupStatus().manifest.root;
    assert.equal(fs.existsSync(path.join(root, '.codex/hooks.json')), true);
    assert.equal(fs.existsSync(path.join(root, '.vscode')), false);
    assert.equal(executed.includes('codexActivity.panel.focus'), false);
    assert.notEqual(api.presentation().title, 'Monitoring off');
    assert.equal(configuredEnabled, initiallyEnabled, 'Setup never changes configuration');
    await sandbox.module.exports.deactivate();
    api = await sandbox.module.exports.activate(context);
    assert.notEqual(api.presentation().title, 'Monitoring off', 'Local enablement survives reload');
    assert.equal(fs.existsSync(path.join(root, '.vscode')), false);
    configuredEnabled = false;
    await configurationChanged({
      affectsConfiguration: (section) =>
        section === 'codexActivity' || section === 'codexActivity.enabled',
    });
    assert.equal(
      api.presentation().title,
      'Monitoring off',
      'A later explicit setting takes effect',
    );
    assert.equal(memory.get('activityEnabled'), undefined);
    choice = 'Remove Project Hooks';
    await commands.get('codexActivity.removeProjectHooks')();
    assert.equal(fs.existsSync(path.join(root, '.codex/hooks.json')), false);
    assert.deepEqual(errors, []);
  });
}
