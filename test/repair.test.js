'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Integration } = require('../src/integration');
const { ProjectHooks } = require('../src/project-hooks');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'activity-repair-')));
  const home = path.join(root, 'codex-home');
  const workspace = path.join(root, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  const memory = new Map();
  const values = new Map();
  const prompts = [];
  let choice;
  let onReview = () => {};
  let available = true;
  const context = {
    globalStorageUri: { fsPath: path.join(root, 'storage') },
    globalState: {
      get: (key) => memory.get(key),
      update: async (key, value) => memory.set(key, value),
    },
    workspaceState: { update: async (key, value) => memory.set(key, value) },
  };
  const vscode = {
    ConfigurationTarget: { Global: 1 },
    extensions: { getExtension: () => ({}) },
    workspace: {
      isTrusted: true,
      getConfiguration: () => ({
        inspect: (key) => ({ globalValue: values.get(key) }),
        update: async (key, value) => values.set(key, value),
      }),
    },
    window: {
      showWarningMessage: async (...args) => {
        prompts.push(args);
        await onReview();
        return choice;
      },
      showInformationMessage: async () => {},
    },
  };
  class LocalIntegration extends Integration {
    constructor(v, c) {
      super(v, c, { codexHome: home });
    }
  }
  const file = path.resolve(__dirname, '../src/repair.js');
  const localRequire = createRequire(file);
  const sandbox = {
    module: { exports: {} },
    require: (id) =>
      id === './integration' ? { Integration: LocalIntegration } : localRequire(id),
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const hooks = new ProjectHooks(workspace, path.resolve(__dirname, '..'), { tmp: root });
  const repair = new sandbox.module.exports.Repair(vscode, context, {
    refresh() {},
    available: () => available,
    chooseProject: async () => ({ name: 'test', hooks }),
    settings: () => ({ nodePath: process.execPath }),
    disposed: () => false,
    openHooks: async () => {},
    stop() {},
    installed: async () => {},
  });
  const integration = new LocalIntegration(vscode, context);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    repair,
    hooks,
    integration,
    memory,
    values,
    prompts,
    vscode,
    choose: (value) => {
      choice = value;
    },
    review: (fn) => {
      onReview = fn;
    },
    noWorkspace: () => {
      available = false;
    },
    legacy: () => {
      fs.writeFileSync(
        integration.config,
        '# BEGIN codex-completion notifier\nnotify = ["old"]\n# END codex-completion notifier\nmodel = "fixture"\n',
      );
      fs.mkdirSync(integration.directory);
      fs.writeFileSync(integration.launcher, 'old helper');
    },
  };
}

test('one consent repairs project hooks and removes legacy configuration and artifacts', async (t) => {
  const f = fixture(t);
  f.legacy();
  const sounds = `\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "/usr/bin/afplay /System/Library/Sounds/Sosumi.aiff"\ntimeout = 3\n\n[[hooks.PermissionRequest]]\n[[hooks.PermissionRequest.hooks]]\ntype = "command"\ncommand = "/usr/bin/afplay /System/Library/Sounds/Ping.aiff"\ntimeout = 3\n\n[hooks.state."config.toml:stop:0:0"]\ntrusted_hash = "keep-stop"\n[hooks.state."config.toml:permission_request:0:0"]\ntrusted_hash = "keep-permission"\n`;
  fs.appendFileSync(f.integration.config, sounds);
  f.choose('Repair and Set Up');
  await f.repair.run();
  assert.equal(f.prompts.length, 1);
  assert.equal(f.hooks.status().code, 'installed');
  assert.equal(f.integration.plan().needed, false);
  assert.equal(fs.readFileSync(f.integration.config, 'utf8'), 'model = "fixture"\n' + sounds);
  assert.equal(f.memory.get('activityEnabled'), true);
  assert.match(f.prompts[0][1].detail, /Codex trust remains a separate review/);
});

test('cancelling combined repair changes neither legacy nor project files', async (t) => {
  const f = fixture(t);
  f.legacy();
  const before = fs.readFileSync(f.integration.config);
  await f.repair.run();
  assert.deepEqual(fs.readFileSync(f.integration.config), before);
  assert.equal(fs.existsSync(f.integration.launcher), true);
  assert.equal(fs.existsSync(f.hooks.codex), false);
  assert.equal(f.memory.size, 0);
});

test('legacy cleanup remains available without a workspace', async (t) => {
  const f = fixture(t);
  f.legacy();
  f.noWorkspace();
  f.choose('Clean Up Legacy Only');
  await f.repair.run();
  assert.equal(f.integration.plan().needed, false);
  assert.equal(fs.existsSync(f.hooks.codex), false);
});

test('project conflicts still allow explicit legacy cleanup and preserve unowned hooks', async (t) => {
  const f = fixture(t);
  f.legacy();
  fs.mkdirSync(f.hooks.codex);
  const custom = '{"hooks":{"Stop":[]}}';
  fs.writeFileSync(f.hooks.hooksFile, custom);
  f.choose('Clean Up Legacy Only');
  await f.repair.run();
  assert.equal(f.prompts[0].includes('Repair and Set Up'), false);
  assert.equal(f.integration.plan().needed, false);
  assert.equal(fs.readFileSync(f.hooks.hooksFile, 'utf8'), custom);
});

test('changed project files abort before legacy cleanup', async (t) => {
  const f = fixture(t);
  f.legacy();
  f.choose('Repair and Set Up');
  f.review(() => {
    fs.mkdirSync(f.hooks.codex);
    fs.writeFileSync(f.hooks.hooksFile, 'user edit');
  });
  await assert.rejects(f.repair.run(), /changed during confirmation/);
  assert.equal(f.integration.plan().needed, true);
  assert.equal(fs.readFileSync(f.hooks.hooksFile, 'utf8'), 'user edit');
});

test('lost workspace trust aborts both parts of a combined repair', async (t) => {
  const f = fixture(t);
  f.legacy();
  f.choose('Repair and Set Up');
  f.review(() => {
    f.vscode.workspace.isTrusted = false;
  });
  await assert.rejects(f.repair.run(), /trust changed/);
  assert.equal(f.integration.plan().needed, true);
  assert.equal(fs.existsSync(f.hooks.codex), false);
});

test('removal from the consolidated action keeps legacy cleanup a separate choice', async (t) => {
  const f = fixture(t);
  f.legacy();
  f.hooks.install(f.hooks.plan(process.execPath));
  f.choose('Remove Project Hooks');
  await f.repair.run();
  assert.equal(fs.existsSync(f.hooks.hooksFile), false);
  assert.equal(f.integration.plan().needed, true);
  assert.equal(fs.existsSync(f.hooks.ignoreFile), true);
});
