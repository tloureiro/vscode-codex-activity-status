'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ColorLease, appearanceTarget } = require('../src/color-lease');
const waitFor = async (fn) => {
  for (let i = 0; i < 250; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('Lease change timed out');
};

test('normal single-folder and saved workspace windows use their existing settings file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-target-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const folder = appearanceTarget({
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: dir } }] },
  });
  assert.deepEqual(folder, {
    file: path.join(fs.realpathSync(dir), '.vscode/settings.json'),
    container: 'folder',
  });
  const saved = appearanceTarget({
    workspace: { workspaceFile: { scheme: 'file', fsPath: path.join(dir, 'x.code-workspace') } },
  });
  assert.equal(saved.container, 'workspace');
  assert.equal(appearanceTarget({ workspace: {} }), null);
});
test('sharing a settings file pauses colors for both windows; closing one restores exclusivity', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-colors-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'project', '.vscode', 'settings.json');
  const first = new ColorLease(file, () => {}, root);
  t.after(() => first.dispose());
  assert.equal(first.exclusive, true);
  const second = new ColorLease(file, () => {}, root);
  t.after(() => second.dispose());
  assert.equal(second.exclusive, false);
  await waitFor(() => !first.exclusive);
  second.dispose();
  await waitFor(() => first.exclusive);
});
test('different projects and worktrees remain independent; symlink aliases share ownership', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-color-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const real = path.join(root, 'real');
  fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(root, 'alias'));
  const first = new ColorLease(path.join(real, '.vscode/settings.json'), () => {}, root);
  t.after(() => first.dispose());
  const worktree = new ColorLease(
    path.join(root, 'worktree/.vscode/settings.json'),
    () => {},
    root,
  );
  t.after(() => worktree.dispose());
  assert.equal(first.exclusive, true);
  assert.equal(worktree.exclusive, true);
  const alias = new ColorLease(path.join(root, 'alias/.vscode/settings.json'), () => {}, root);
  t.after(() => alias.dispose());
  await waitFor(() => !first.exclusive);
  assert.equal(alias.exclusive, false);
  assert.equal(worktree.exclusive, true);
});
test('shared ownership restores the first overlay and resumes the survivor', async (t) => {
  const { Appearance } = require('../src/appearance');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-shared-appearance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  let value;
  const c = {
    inspect: () => ({ workspaceValue: value }),
    get: () => value,
    update: async (_, v) => {
      value = v;
    },
  };
  const vscode = {
    workspace: { getConfiguration: () => c },
    ConfigurationTarget: { Workspace: 2 },
  };
  let firstAppearance, secondAppearance;
  const first = new ColorLease(
    file,
    () => {
      if (firstAppearance) void firstAppearance.update('processing', {});
    },
    root,
  );
  t.after(() => first.dispose());
  firstAppearance = new Appearance(vscode, file, {
    owner: first.owner.token,
    journalPath: first.journalPath,
    canHighlight: () => first.exclusive,
    canRestoreOther: () => first.exclusive,
  });
  await firstAppearance.update('processing', {});
  assert.equal(value['statusBar.background'], '#245A91');
  const second = new ColorLease(
    file,
    () => {
      if (secondAppearance) void secondAppearance.update('finished', {});
    },
    root,
  );
  t.after(() => second.dispose());
  secondAppearance = new Appearance(vscode, file, {
    owner: second.owner.token,
    journalPath: second.journalPath,
    canHighlight: () => second.exclusive,
    canRestoreOther: () => second.exclusive,
  });
  await secondAppearance.update('finished', {});
  await waitFor(() => !first.exclusive && !value?.['statusBar.background']);
  assert.equal(second.exclusive, false);
  second.dispose();
  await waitFor(() => first.exclusive && value?.['statusBar.background'] === '#245A91');
  await firstAppearance.dispose();
  assert.equal(value, undefined);
});
